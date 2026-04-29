/**
 * JMK · Backend Server
 * --------------------
 * Single-file Express + SQLite + REST API. Mirrors the JMK store API so the
 * existing client apps can swap localStorage for this backend transparently.
 *
 * Run locally:
 *   npm install && node server.js
 *
 * Endpoints:
 *   GET    /api/health
 *   GET    /api/collections/:name
 *   GET    /api/collections/:name/:id
 *   POST   /api/collections/:name
 *   PATCH  /api/collections/:name/:id
 *   DELETE /api/collections/:name/:id
 *   GET    /api/settings
 *   PATCH  /api/settings
 *   POST   /api/reset
 *   POST   /api/seed                    (admin only)
 *   POST   /api/auth/login              { email, password, role }
 *   POST   /api/auth/register           { email, password, role, name, ... }
 *   POST   /api/auth/logout
 *   GET    /api/auth/me
 *   GET    /api/changes?since=<ms>      (long-poll for cross-device sync)
 */
'use strict';

const path                 = require('path');
const fs                   = require('fs');
const http                 = require('http');
const express              = require('express');
const cors                 = require('cors');
const { DatabaseSync }     = require('node:sqlite');   // built-in (Node ≥ 22)
const bcrypt               = require('bcryptjs');
const jwt                  = require('jsonwebtoken');

// Feature modules
const commission   = require('./lib/commission');
const weather      = require('./lib/weather');
const itinerary    = require('./lib/itinerary');
const qr           = require('./lib/qr');
const chat         = require('./lib/chat');
const email        = require('./lib/email');
const payments     = require('./lib/payments');
const uploads      = require('./lib/uploads');
const availability = require('./lib/availability');
const pricing      = require('./lib/pricing');
const antibypass   = require('./lib/antibypass');
const moderation   = require('./lib/moderation');
const deposit      = require('./lib/deposit');
const orders       = require('./lib/orders');

const PORT       = process.env.PORT || 3000;
const DB_PATH    = process.env.DB_PATH    || path.join(__dirname, 'jmk.sqlite');
const JWT_SECRET = process.env.JWT_SECRET || 'jmk-dev-secret-change-in-prod';
const STATIC_DIR = path.resolve(__dirname, '..');   // serves the 5 HTML apps
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

// ---------- DB ----------
const db = new DatabaseSync(DB_PATH);
try { db.exec('PRAGMA journal_mode = WAL'); } catch (_) { /* WAL not supported on some filesystems; continue with default journal */ }
db.exec(`
CREATE TABLE IF NOT EXISTS collections (
  collection TEXT NOT NULL,
  id         TEXT NOT NULL,
  data       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (collection, id)
);
CREATE INDEX IF NOT EXISTS idx_collections_name ON collections(collection);
CREATE INDEX IF NOT EXISTS idx_collections_updated ON collections(updated_at);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL,
  data          TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// ---------- Seed ----------
const SEED = require('./seed.js');

function isSeeded() {
  const r = db.prepare('SELECT value FROM meta WHERE key=?').get('seeded');
  return !!r;
}
function withTx(fn) {
  db.exec('BEGIN');
  try { fn(); db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
function seedAll() {
  const insColl = db.prepare('INSERT OR REPLACE INTO collections(collection,id,data,created_at,updated_at) VALUES (?,?,?,?,?)');
  const insSet  = db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)');
  const insMeta = db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)');
  withTx(() => {
    const now = Date.now();
    Object.keys(SEED).forEach(coll => {
      if (coll === 'settings' || coll === '_meta') return;
      if (!Array.isArray(SEED[coll])) return;   // skip non-array exports (e.g. catalog objects)
      SEED[coll].forEach(obj => insColl.run(coll, obj.id, JSON.stringify(obj), now, now));
    });
    if (SEED.settings) Object.keys(SEED.settings).forEach(k => insSet.run(k, JSON.stringify(SEED.settings[k])));
    insMeta.run('seeded', String(now));
  });
}
if (!isSeeded()) {
  console.log('[JMK] First run — seeding database…');
  seedAll();
}

function bumpVersion() {
  const now = Date.now();
  db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)').run('version', String(now));
  return now;
}
function getVersion() {
  const r = db.prepare('SELECT value FROM meta WHERE key=?').get('version');
  return r ? Number(r.value) : 0;
}
bumpVersion();

// ---------- Express ----------
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(STATIC_DIR, { extensions: ['html'] }));

// Helpers
function genId(prefix) { return (prefix || 'id') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function authOptional(req, _res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.cookies && req.cookies.jmk_token);
  if (token) {
    try { req.user = jwt.verify(token, JWT_SECRET); } catch {}
  }
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'admin only' });
  next();
}

app.use(authOptional);

// ---------- Health ----------
app.get('/api/health', (_req, res) => res.json({ ok: true, version: getVersion(), records: Number(db.prepare('SELECT COUNT(*) c FROM collections').get().c) }));

// ---------- Collections ----------
app.get('/api/collections/:name', (req, res) => {
  const rows = db.prepare('SELECT data FROM collections WHERE collection=? ORDER BY updated_at DESC').all(req.params.name);
  res.json(rows.map(r => JSON.parse(r.data)));
});
app.get('/api/collections/:name/:id', (req, res) => {
  const r = db.prepare('SELECT data FROM collections WHERE collection=? AND id=?').get(req.params.name, req.params.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  res.json(JSON.parse(r.data));
});
app.post('/api/collections/:name', (req, res) => {
  const obj = req.body || {};
  obj.id = obj.id || genId(req.params.name.slice(0, 2));
  obj.createdAt = obj.createdAt || new Date().toISOString();
  const now = Date.now();
  db.prepare('INSERT OR REPLACE INTO collections(collection,id,data,created_at,updated_at) VALUES(?,?,?,?,?)').run(req.params.name, obj.id, JSON.stringify(obj), now, now);
  bumpVersion();
  res.json(obj);
});
app.patch('/api/collections/:name/:id', (req, res) => {
  const cur = db.prepare('SELECT data, created_at FROM collections WHERE collection=? AND id=?').get(req.params.name, req.params.id);
  if (!cur) return res.status(404).json({ error: 'not found' });
  const merged = Object.assign({}, JSON.parse(cur.data), req.body || {}, { updatedAt: new Date().toISOString() });
  db.prepare('UPDATE collections SET data=?, updated_at=? WHERE collection=? AND id=?').run(JSON.stringify(merged), Date.now(), req.params.name, req.params.id);
  bumpVersion();
  res.json(merged);
});
app.delete('/api/collections/:name/:id', (req, res) => {
  const info = db.prepare('DELETE FROM collections WHERE collection=? AND id=?').run(req.params.name, req.params.id);
  bumpVersion();
  res.json({ deleted: info.changes > 0 });
});

// ---------- Settings ----------
app.get('/api/settings', (_req, res) => {
  const rows = db.prepare('SELECT key,value FROM settings').all();
  const out = {};
  rows.forEach(r => { out[r.key] = JSON.parse(r.value); });
  res.json(out);
});
app.patch('/api/settings', (req, res) => {
  const patch = req.body || {};
  const ins = db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)');
  withTx(() => Object.keys(patch).forEach(k => ins.run(k, JSON.stringify(patch[k]))));
  bumpVersion();
  const rows = db.prepare('SELECT key,value FROM settings').all();
  const out = {};
  rows.forEach(r => { out[r.key] = JSON.parse(r.value); });
  res.json(out);
});

// ---------- Reset ----------
app.post('/api/reset', (_req, res) => {
  db.exec('DELETE FROM collections; DELETE FROM settings; DELETE FROM meta WHERE key=\'seeded\';');
  seedAll();
  bumpVersion();
  res.json({ ok: true });
});

// ---------- Auth ----------
app.post('/api/auth/register', async (req, res) => {
  const { email, password, role, name } = req.body || {};
  if (!email || !password || !role) return res.status(400).json({ error: 'missing fields' });
  const exists = db.prepare('SELECT 1 FROM users WHERE email=?').get(email);
  if (exists) return res.status(409).json({ error: 'email exists' });
  const hash = await bcrypt.hash(password, 10);
  const id = genId('u');
  const data = JSON.stringify({ name: name || email, email, role });
  db.prepare('INSERT INTO users(id,email,password_hash,role,data,created_at) VALUES(?,?,?,?,?,?)').run(id, email, hash, role, data, Date.now());
  const token = jwt.sign({ id, email, role, name }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id, email, role, name } });
});
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const row = db.prepare('SELECT id,email,password_hash,role,data FROM users WHERE email=?').get(email);
  if (!row) return res.status(401).json({ error: 'bad credentials' });
  const ok = await bcrypt.compare(password || '', row.password_hash);
  if (!ok) return res.status(401).json({ error: 'bad credentials' });
  const meta = JSON.parse(row.data);
  const token = jwt.sign({ id: row.id, email: row.email, role: row.role, name: meta.name }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: row.id, email: row.email, role: row.role, name: meta.name } });
});
app.get('/api/auth/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'not logged in' });
  res.json({ user: req.user });
});

// ---------- Long-poll for cross-device sync ----------
app.get('/api/changes', async (req, res) => {
  const since = Number(req.query.since) || 0;
  const start = Date.now();
  // long-poll up to 25 seconds
  while (Date.now() - start < 25000) {
    const v = getVersion();
    if (v > since) return res.json({ version: v });
    await new Promise(r => setTimeout(r, 750));
  }
  res.json({ version: getVersion() });
});

// ============================================================
// ====================  NEW v1.1 FEATURES  ===================
// ============================================================

// Helper: φέρε ένα record από οποιοδήποτε collection
function getOne(collection, id) {
  const r = db.prepare('SELECT data FROM collections WHERE collection=? AND id=?').get(collection, id);
  return r ? JSON.parse(r.data) : null;
}
function getSettingsObj() {
  const rows = db.prepare('SELECT key,value FROM settings').all();
  const out = {};
  rows.forEach(r => { out[r.key] = JSON.parse(r.value); });
  return out;
}
function saveOne(collection, obj) {
  const now = Date.now();
  db.prepare('INSERT OR REPLACE INTO collections(collection,id,data,created_at,updated_at) VALUES(?,?,?,?,?)')
    .run(collection, obj.id, JSON.stringify(obj), now, now);
  bumpVersion();
}

// ---------- Commission preview ----------
// GET /api/commission/preview?total=110&hotelId=h-naxos-1
// Βοηθητικό: το frontend μπορεί να δείχνει split πριν δημιουργηθεί booking.
app.get('/api/commission/preview', (req, res) => {
  const total = Number(req.query.total) || 0;
  const hotelId = req.query.hotelId;
  const hotel = hotelId ? getOne('hotels', hotelId) : null;
  const split = commission.calc(total, {
    hotelCommissionPct: hotel?.commissionPct,
    settings: getSettingsObj()
  });
  res.json(split);
});

// ---------- Booking flow ----------
// POST /api/bookings { activityId, hotelId, guestId, date, time, slotId?, people }
// Δημιουργεί booking με: dynamic pricing, availability check, commission split, state='chat'
app.post('/api/bookings', (req, res) => {
  const { activityId, hotelId, guestId, date, time, slotId, people } = req.body || {};
  if (!activityId || !hotelId || !guestId) return res.status(400).json({ error: 'activityId, hotelId, guestId required' });
  const activity = getOne('activities', activityId);
  if (!activity) return res.status(404).json({ error: 'activity not found' });
  const hotel = getOne('hotels', hotelId);
  if (!hotel) return res.status(404).json({ error: 'hotel not found' });

  const ppl = Math.max(1, Number(people) || 1);
  const bookingDate = date || new Date().toISOString().slice(0, 10);

  // ---- Availability / inventory check ----
  if (activity.schedule && activity.schedule.timeSlots) {
    const allBookings = db.prepare('SELECT data FROM collections WHERE collection=?').all('bookings').map(r => JSON.parse(r.data));
    const activityBookings = allBookings.filter(b => b.activityId === activityId);
    const targetSlotId = slotId || (time && activity.schedule.timeSlots.find(s => s.time === time)?.id);
    if (targetSlotId) {
      const check = availability.isSlotAvailable(activity, bookingDate, targetSlotId, ppl, activityBookings);
      if (!check.ok) {
        const next = availability.nextAvailableSlots(activity, bookingDate, 5, activityBookings);
        return res.status(409).json({
          error:    'slot_unavailable',
          reason:   check.reason,
          remaining: check.remaining,
          nextAvailable: next
        });
      }
    }
  }

  // ---- Dynamic pricing ----
  const priced = pricing.compute({ activity, date: bookingDate, time: time || '10:00', people: ppl });
  const totalAmount = priced.total;

  const split = commission.calc(totalAmount, {
    hotelCommissionPct: hotel.commissionPct,
    settings: getSettingsObj()
  });

  const booking = {
    id: genId('b'),
    activityId,
    partnerId: activity.partnerId,
    hotelId,
    guestId,
    date: bookingDate,
    time: time || '10:00',
    slotId: slotId || null,
    people: ppl,
    unitPrice: priced.unitPrice,
    totalAmount: split.total,
    partnerAmount: split.partnerAmount,
    hotelCommission: split.hotelCommission,
    jmkCommission: split.jmkCommission,
    stripeFee: split.stripeFee,
    pricingBreakdown: priced.breakdown,
    status: 'chat',
    createdAt: new Date().toISOString(),
    completedAt: null,
    paidAt: null
  };
  saveOne('bookings', booking);

  // Notify partner via email (logs in dev)
  const partner = getOne('partners', booking.partnerId);
  if (partner) email.sendTemplate('bookingRequested', booking, activity, partner).catch(err => console.warn('[email]', err.message));

  res.json(booking);
});

// POST /api/bookings/:id/transition { to: 'agreed'|'paid'|'completed'|'reviewed'|'cancelled', reason? }
app.post('/api/bookings/:id/transition', (req, res) => {
  const booking = getOne('bookings', req.params.id);
  if (!booking) return res.status(404).json({ error: 'not found' });
  const to = req.body.to;
  const from = commission.normalizeState(booking.status);
  if (!commission.canTransition(from, to)) {
    return res.status(400).json({ error: `cannot transition from ${from} to ${to}` });
  }
  booking.status = to;
  if (to === 'paid')      booking.paidAt = new Date().toISOString();
  if (to === 'completed') booking.completedAt = new Date().toISOString();
  if (to === 'cancelled') booking.cancelledAt = new Date().toISOString();
  if (req.body.reason)    booking.cancelReason = req.body.reason;
  saveOne('bookings', booking);
  res.json(booking);
});

// ---------- QR codes ----------
// GET /api/qr/hotel/:id?format=png|svg|dataurl&room=204
app.get('/api/qr/hotel/:id', async (req, res) => {
  const hotel = getOne('hotels', req.params.id);
  if (!hotel) return res.status(404).json({ error: 'hotel not found' });
  if (!qr.available) return res.status(501).json({ error: 'qrcode library not installed — run npm install' });

  const url = qr.buildHotelUrl(PUBLIC_URL, hotel, req.query.room);
  const fmt = (req.query.format || 'png').toLowerCase();
  try {
    if (fmt === 'svg') {
      const svg = await qr.toSvg(url, { size: 512 });
      res.type('image/svg+xml').send(svg);
    } else if (fmt === 'dataurl') {
      const u = await qr.toDataUrl(url, { size: 256 });
      res.json({ url, dataUrl: u });
    } else {
      const buf = await qr.toPng(url, { size: 512 });
      res.type('image/png').send(buf);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/qr/url?text=... — generic
app.get('/api/qr/url', async (req, res) => {
  const txt = req.query.text;
  if (!txt) return res.status(400).json({ error: 'text required' });
  if (!qr.available) return res.status(501).json({ error: 'qrcode library not installed' });
  try {
    const buf = await qr.toPng(String(txt), { size: 512 });
    res.type('image/png').send(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Weather ----------
// GET /api/weather?island=isl-naxos&date=2026-07-19
app.get('/api/weather', async (req, res) => {
  const islandId = req.query.island;
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  if (!islandId) return res.status(400).json({ error: 'island required' });
  try {
    const f = await weather.getForecast(islandId, date);
    res.json(f);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Itinerary generator ----------
// POST /api/itinerary { hotelId, dates: ['2026-07-15', ...], guestId? }
app.post('/api/itinerary', async (req, res) => {
  const { hotelId, dates, guestId } = req.body || {};
  if (!hotelId || !Array.isArray(dates)) return res.status(400).json({ error: 'hotelId and dates[] required' });
  const hotel = getOne('hotels', hotelId);
  if (!hotel) return res.status(404).json({ error: 'hotel not found' });
  const guest = guestId ? getOne('guests', guestId) : null;
  const allRows = db.prepare('SELECT data FROM collections WHERE collection=?').all('activities');
  const allActivities = allRows.map(r => JSON.parse(r.data));

  try {
    const result = await itinerary.generate({
      hotel,
      dates,
      guest,
      allActivities,
      getForecast: weather.getForecast
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Payments ----------
// POST /api/payments/intent { bookingId }
app.post('/api/payments/intent', async (req, res) => {
  const booking = getOne('bookings', req.body?.bookingId);
  if (!booking) return res.status(404).json({ error: 'booking not found' });
  try {
    const intent = await payments.createIntent({ booking });
    res.json(intent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payments/confirm { bookingId, intentId }
// Σε production καλείται από Stripe webhook. Σε dev/stub καλείται απ' το client.
app.post('/api/payments/confirm', async (req, res) => {
  const { bookingId, intentId } = req.body || {};
  const booking = getOne('bookings', bookingId);
  if (!booking) return res.status(404).json({ error: 'booking not found' });

  // Στο stub mode το «επιβεβαιώνουμε» αυτόματα
  if (intentId && intentId.startsWith('pi_stub_')) {
    await payments.confirmStub(intentId);
  }

  if (!commission.canTransition(booking.status, 'paid')) {
    return res.status(400).json({ error: `cannot mark paid from state ${booking.status}` });
  }
  booking.status = 'paid';
  booking.paidAt = new Date().toISOString();
  booking.paymentIntentId = intentId || null;
  saveOne('bookings', booking);

  // Notify partner & guest
  const activity = getOne('activities', booking.activityId);
  const partner  = getOne('partners', booking.partnerId);
  const guest    = getOne('guests', booking.guestId);
  if (activity && partner) email.sendTemplate('paymentReceived', booking, activity, partner).catch(()=>{});
  if (activity && guest)   email.sendTemplate('bookingConfirmed', booking, activity, guest).catch(()=>{});

  res.json(booking);
});

// Stripe webhook (production only)
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(501).json({ error: 'webhook not configured' });
  try {
    const event = payments.verifyWebhook(req.body, sig, secret);
    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object;
      const bookingId = intent.metadata?.bookingId;
      const booking = getOne('bookings', bookingId);
      if (booking && commission.canTransition(booking.status, 'paid')) {
        booking.status = 'paid';
        booking.paidAt = new Date().toISOString();
        booking.paymentIntentId = intent.id;
        saveOne('bookings', booking);
      }
    }
    res.json({ received: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- Chat REST (history / send-without-WS) ----------
// GET /api/bookings/:id/messages
app.get('/api/bookings/:id/messages', (req, res) => {
  const rows = db.prepare("SELECT data FROM collections WHERE collection=? ORDER BY updated_at ASC").all(`messages_${req.params.id}`);
  res.json(rows.map(r => JSON.parse(r.data)));
});

// POST /api/bookings/:id/messages { text, fromId, fromName, fromRole }
// Fallback για clients χωρίς WebSocket support. Κάνει την ίδια anti-bypass detection.
app.post('/api/bookings/:id/messages', (req, res) => {
  const bookingId = req.params.id;
  const booking = getOne('bookings', bookingId);
  if (!booking) return res.status(404).json({ error: 'booking not found' });

  const { text, fromId, fromName, fromRole } = req.body || {};
  if (!text || typeof text !== 'string') return res.status(400).json({ error: 'text required' });

  const detection = antibypass.detect(text);
  const message = {
    id: genId('msg'),
    bookingId,
    from: req.user?.id   || fromId   || 'anonymous',
    fromName: req.user?.name || fromName || 'Άγνωστος',
    fromRole: req.user?.role || fromRole || 'guest',
    text: detection.redactedText,
    originalText: detection.flagged ? text : undefined,
    flagged: detection.flagged,
    flagKind: detection.kind,
    riskScore: detection.riskScore,
    severity: detection.severity,
    readBy: [req.user?.id || fromId || 'anonymous'],
    createdAt: new Date().toISOString()
  };
  saveOne(`messages_${bookingId}`, message);

  let modAction = null;
  if (detection.flagged) {
    const fm = {
      id: genId('fm'),
      bookingId,
      from: message.from,
      fromName: message.fromName,
      fromRole: message.fromRole,
      partnerId: booking.partnerId,
      text,
      redactedText: detection.redactedText,
      kind: detection.kind,
      riskScore: detection.riskScore,
      severity: detection.severity,
      signals: detection.signals,
      createdAt: message.createdAt,
      resolved: false
    };
    saveOne('flaggedMessages', fm);
    // Auto-moderation αν ο partner είναι ο sender
    if (message.fromRole === 'partner') {
      try { modAction = moderation.processFlaggedMessage({ db, genId, bumpVersion }, fm); }
      catch (e) { console.warn('[mod]', e.message); }
    }
  }

  res.json({ message, moderation: modAction });
});

// ---------- Reviews ----------
// POST /api/reviews { bookingId, rating, text, lang }
app.post('/api/reviews', (req, res) => {
  const { bookingId, rating, text, lang } = req.body || {};
  const booking = getOne('bookings', bookingId);
  if (!booking) return res.status(404).json({ error: 'booking not found' });
  if (booking.status !== 'completed' && booking.status !== 'paid') {
    return res.status(400).json({ error: 'booking must be completed before review' });
  }
  const review = {
    id: genId('r'),
    bookingId,
    guestId: booking.guestId,
    activityId: booking.activityId,
    partnerId: booking.partnerId,
    hotelId: booking.hotelId,
    rating: Math.max(1, Math.min(5, Number(rating) || 5)),
    text: String(text || '').slice(0, 1000),
    lang: lang || 'el',
    createdAt: new Date().toISOString()
  };
  saveOne('reviews', review);

  // Mark booking as reviewed
  if (commission.canTransition(booking.status, 'reviewed')) {
    booking.status = 'reviewed';
    saveOne('bookings', booking);
  }
  res.json(review);
});

// ============================================================
// ============  v1.2 — Airbnb-style endpoints  ===============
// ============================================================

// ---------- Photo / Video Uploads ----------
// POST /api/uploads (multipart, field name: 'files', μέχρι 10 αρχεία)
// Body fields: activityId? (για auto-attach στο activity)
if (uploads.uploader) {
  app.post('/api/uploads', uploads.uploader.array('files', 10), async (req, res) => {
    try {
      const results = [];
      for (const file of (req.files || [])) {
        const r = await uploads.saveOne(file, { folder: `jmk/${req.body.activityId || 'misc'}` });
        results.push(r);
      }

      // Αν δίνεται activityId, append στο activity.photos[]
      if (req.body.activityId) {
        const activity = getOne('activities', req.body.activityId);
        if (activity) {
          activity.photos = activity.photos || [];
          const startOrder = activity.photos.length;
          for (let i = 0; i < results.length; i++) {
            activity.photos.push({
              id:       results[i].id,
              url:      results[i].url,
              thumbUrl: results[i].thumbUrl,
              width:    results[i].width,
              height:   results[i].height,
              bytes:    results[i].bytes,
              mime:     results[i].mime,
              order:    startOrder + i,
              isCover:  startOrder === 0 && i === 0,
              provider: results[i].provider,
              uploadedAt: new Date().toISOString()
            });
          }
          saveOne('activities', activity);
        }
      }

      res.json({ uploads: results, mode: uploads.MODE });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // DELETE /api/uploads/:id?activityId=...&resource_type=image
  app.delete('/api/uploads/:id', async (req, res) => {
    try {
      const r = await uploads.deleteOne(decodeURIComponent(req.params.id), { resource_type: req.query.resource_type });
      if (req.query.activityId) {
        const activity = getOne('activities', req.query.activityId);
        if (activity && Array.isArray(activity.photos)) {
          activity.photos = activity.photos.filter(p => p.id !== req.params.id);
          saveOne('activities', activity);
        }
      }
      res.json(r);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Reorder photos: PATCH /api/activities/:id/photos { order: ['photoId1','photoId2',...] }
  app.patch('/api/activities/:id/photos', (req, res) => {
    const activity = getOne('activities', req.params.id);
    if (!activity) return res.status(404).json({ error: 'activity not found' });
    const order = req.body.order;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });
    const map = new Map((activity.photos || []).map(p => [p.id, p]));
    activity.photos = order.map((id, i) => {
      const p = map.get(id);
      if (!p) return null;
      return Object.assign({}, p, { order: i, isCover: i === 0 });
    }).filter(Boolean);
    saveOne('activities', activity);
    res.json(activity.photos);
  });
} else {
  app.post('/api/uploads', (_req, res) => res.status(501).json({ error: 'uploads disabled — run npm install multer' }));
}

// Static serve for local uploads
const localStatic = uploads.staticMiddleware(express);
if (localStatic) app.use('/uploads', localStatic);

// ---------- Availability ----------
// GET /api/activities/:id/availability?from=2026-07-01&to=2026-07-31
app.get('/api/activities/:id/availability', (req, res) => {
  const activity = getOne('activities', req.params.id);
  if (!activity) return res.status(404).json({ error: 'activity not found' });
  const from = req.query.from || new Date().toISOString().slice(0, 10);
  const to   = req.query.to   || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const allBookings = db.prepare('SELECT data FROM collections WHERE collection=?').all('bookings').map(r => JSON.parse(r.data));
  const myBookings = allBookings.filter(b => b.activityId === activity.id);
  const days = availability.getAvailableDates(activity, from, to, myBookings);
  res.json({ activityId: activity.id, from, to, days });
});

// PATCH /api/activities/:id/schedule { weekly?, timeSlots?, blockedDates?, ... }
app.patch('/api/activities/:id/schedule', (req, res) => {
  const activity = getOne('activities', req.params.id);
  if (!activity) return res.status(404).json({ error: 'activity not found' });
  activity.schedule = Object.assign({}, activity.schedule || {}, req.body || {});
  saveOne('activities', activity);
  res.json(activity.schedule);
});

// POST /api/activities/:id/block-dates { dates: ['YYYY-MM-DD', ...] }
app.post('/api/activities/:id/block-dates', (req, res) => {
  const activity = getOne('activities', req.params.id);
  if (!activity) return res.status(404).json({ error: 'activity not found' });
  const dates = Array.isArray(req.body.dates) ? req.body.dates : [];
  activity.schedule = activity.schedule || {};
  const set = new Set([...(activity.schedule.blockedDates || []), ...dates]);
  activity.schedule.blockedDates = Array.from(set).sort();
  saveOne('activities', activity);
  res.json({ blockedDates: activity.schedule.blockedDates });
});

// DELETE /api/activities/:id/block-dates  body: { dates: [...] }  (unblock)
app.post('/api/activities/:id/unblock-dates', (req, res) => {
  const activity = getOne('activities', req.params.id);
  if (!activity) return res.status(404).json({ error: 'activity not found' });
  const remove = new Set(req.body.dates || []);
  activity.schedule = activity.schedule || {};
  activity.schedule.blockedDates = (activity.schedule.blockedDates || []).filter(d => !remove.has(d));
  saveOne('activities', activity);
  res.json({ blockedDates: activity.schedule.blockedDates });
});

// ---------- Pricing preview ----------
// GET /api/activities/:id/price-preview?date=2026-08-01&time=10:00&people=4
app.get('/api/activities/:id/price-preview', (req, res) => {
  const activity = getOne('activities', req.params.id);
  if (!activity) return res.status(404).json({ error: 'activity not found' });
  const result = pricing.compute({
    activity,
    date: req.query.date || new Date().toISOString().slice(0, 10),
    time: req.query.time || '10:00',
    people: Number(req.query.people) || 1
  });
  res.json(result);
});

// PATCH /api/activities/:id/pricing  (update pricing rules)
app.patch('/api/activities/:id/pricing', (req, res) => {
  const activity = getOne('activities', req.params.id);
  if (!activity) return res.status(404).json({ error: 'activity not found' });
  activity.pricing = Object.assign({}, activity.pricing || {}, req.body || {});
  // sync flat price for backwards compat
  if (typeof activity.pricing.base === 'number') activity.price = activity.pricing.base;
  saveOne('activities', activity);
  res.json(activity.pricing);
});

// ---------- Activity rich update (Airbnb-style fields) ----------
// PATCH /api/activities/:id/details — includes, excludes, languages, rules, cancellationPolicy
app.patch('/api/activities/:id/details', (req, res) => {
  const activity = getOne('activities', req.params.id);
  if (!activity) return res.status(404).json({ error: 'activity not found' });
  const allowed = ['title','description','duration','maxPeople','includes','excludes','languages','rules','cancellationPolicy','minAge','minAdvanceHours'];
  for (const k of allowed) {
    if (k in req.body) activity[k] = req.body[k];
  }
  saveOne('activities', activity);
  res.json(activity);
});

// ---------- Cancellation policies catalog ----------
app.get('/api/cancellation-policies', (_req, res) => {
  res.json(SEED.cancellationPolicies || {});
});

// ============================================================
// ============  v1.3 — Auto Pre-Payment & Moderation  ========
// ============================================================

// ---------- Agree on price → auto deposit intent ----------
// POST /api/bookings/:id/agree { agreedAmount?, agreedTime?, agreedSlotId? }
// 1. Updates booking με συμφωνημένη τιμή (αν δοθεί διαφορετική)
// 2. Recompute commission
// 3. Δημιουργεί Stripe intent για το 20% deposit
// 4. Booking status: chat → agreed (deposit pending)
// 5. Επιστρέφει intent + clientSecret για το app να χρεώσει
app.post('/api/bookings/:id/agree', async (req, res) => {
  const booking = getOne('bookings', req.params.id);
  if (!booking) return res.status(404).json({ error: 'booking not found' });
  if (booking.status !== 'chat' && booking.status !== 'pending') {
    return res.status(400).json({ error: `cannot agree from state ${booking.status}` });
  }

  // Αν δίνεται διαφορετική τιμή απ' την αρχική, recompute
  if (typeof req.body?.agreedAmount === 'number' && req.body.agreedAmount > 0) {
    const hotel = getOne('hotels', booking.hotelId);
    const newSplit = commission.calc(req.body.agreedAmount, {
      hotelCommissionPct: hotel?.commissionPct,
      settings: getSettingsObj()
    });
    booking.totalAmount     = newSplit.total;
    booking.partnerAmount   = newSplit.partnerAmount;
    booking.hotelCommission = newSplit.hotelCommission;
    booking.jmkCommission   = newSplit.jmkCommission;
    booking.stripeFee       = newSplit.stripeFee;
  }

  if (req.body?.agreedTime) booking.time = req.body.agreedTime;
  if (req.body?.agreedSlotId) booking.slotId = req.body.agreedSlotId;

  // Calculate deposit (20%)
  const dep = deposit.calcDeposit(booking.totalAmount, getSettingsObj());

  // Create Stripe intent (or stub) για το deposit
  const intent = await payments.createIntent({
    booking: { ...booking, totalAmount: dep.depositAmount }
  });

  booking.deposit = {
    amount:    dep.depositAmount,
    pct:       dep.depositPct,
    status:    'pending',
    intentId:  intent.id,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 3600000).toISOString()
  };
  booking.status   = 'agreed';
  booking.agreedAt = new Date().toISOString();
  saveOne('bookings', booking);

  res.json({
    booking,
    deposit: {
      amount: dep.depositAmount,
      pct: dep.depositPct,
      currency: 'EUR',
      intent
    }
  });
});

// POST /api/bookings/:id/confirm-deposit { intentId }
// Στο stub mode καλείται από το client. Σε production καλείται από Stripe webhook.
app.post('/api/bookings/:id/confirm-deposit', async (req, res) => {
  const booking = getOne('bookings', req.params.id);
  if (!booking) return res.status(404).json({ error: 'booking not found' });
  if (!booking.deposit || booking.deposit.status === 'paid') {
    return res.status(400).json({ error: 'no pending deposit' });
  }

  const intentId = req.body?.intentId || booking.deposit.intentId;
  if (intentId && intentId.startsWith('pi_stub_')) {
    await payments.confirmStub(intentId);
  }

  booking.deposit.status = 'paid';
  booking.deposit.paidAt = new Date().toISOString();
  if (commission.canTransition(booking.status, 'deposit_paid')) {
    booking.status = 'deposit_paid';
  }
  saveOne('bookings', booking);

  // Notify both sides
  const activity = getOne('activities', booking.activityId);
  const partner  = getOne('partners', booking.partnerId);
  const guest    = getOne('guests', booking.guestId);
  if (activity && partner) email.sendTemplate('paymentReceived', booking, activity, partner).catch(()=>{});
  if (activity && guest)   email.sendTemplate('bookingConfirmed', booking, activity, guest).catch(()=>{});

  res.json(booking);
});

// POST /api/bookings/:id/refund — calculates refund based on cancellation policy
app.post('/api/bookings/:id/refund', async (req, res) => {
  const booking = getOne('bookings', req.params.id);
  if (!booking) return res.status(404).json({ error: 'booking not found' });
  const activity = getOne('activities', booking.activityId);

  const refund = deposit.calcRefund(booking, activity);

  booking.cancellation = {
    refundAmount: refund.refundAmount,
    refundPct:    refund.refundPct,
    reason:       req.body?.reason || refund.reason,
    cancelledAt:  new Date().toISOString()
  };
  booking.status = 'cancelled';
  saveOne('bookings', booking);

  res.json({ booking, refund });
});

// ---------- Anti-bypass detection preview (test endpoint) ----------
// POST /api/antibypass/check { text } → δείχνει τι θα ανίχνευε
app.post('/api/antibypass/check', (req, res) => {
  const text = req.body?.text || '';
  res.json(antibypass.detect(text));
});

// ============================================================
// ============  Admin Moderation Panel  ======================
// ============================================================

// Middleware για admin-only (light check)
function adminOnly(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  // Για demo επιτρέπω και χωρίς auth — production θα ήταν αυστηρό
  if (req.headers['x-admin-key'] && req.headers['x-admin-key'] === (process.env.ADMIN_KEY || 'dev-admin-key')) return next();
  return res.status(403).json({ error: 'admin only' });
}

// GET /api/admin/flagged?status=open|resolved&since=ms
app.get('/api/admin/flagged', adminOnly, (req, res) => {
  const rows = db.prepare('SELECT data FROM collections WHERE collection=? ORDER BY updated_at DESC').all('flaggedMessages');
  let items = rows.map(r => JSON.parse(r.data));
  if (req.query.status === 'open') items = items.filter(x => !x.resolved);
  else if (req.query.status === 'resolved') items = items.filter(x => x.resolved);
  if (req.query.since) {
    const since = Number(req.query.since);
    items = items.filter(x => new Date(x.createdAt).getTime() >= since);
  }
  // Sort by riskScore desc
  items.sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0));
  res.json({ count: items.length, items });
});

// POST /api/admin/flagged/:id/resolve { action: 'ignore'|'warn'|'suspend', reason }
app.post('/api/admin/flagged/:id/resolve', adminOnly, (req, res) => {
  const fm = getOne('flaggedMessages', req.params.id);
  if (!fm) return res.status(404).json({ error: 'not found' });
  const action = req.body?.action || 'ignore';
  const reason = req.body?.reason || `Admin action: ${action}`;

  let result = { action, fm };
  const ctx = { db, genId, bumpVersion };

  if (action === 'warn' && fm.partnerId) {
    result.warning = moderation.warnPartner(ctx, fm.partnerId, reason);
  } else if (action === 'suspend' && fm.partnerId) {
    result.suspension = moderation.suspendPartner(ctx, fm.partnerId, reason);
  }

  fm.resolved = true;
  fm.resolvedAt = new Date().toISOString();
  fm.resolvedBy = req.user?.id || 'admin';
  fm.resolvedAction = action;
  fm.resolvedReason = reason;
  saveOne('flaggedMessages', fm);

  res.json(result);
});

// GET /api/admin/partners/risk — partners με τρέχον risk score
app.get('/api/admin/partners/risk', adminOnly, (req, res) => {
  const partners = db.prepare('SELECT data FROM collections WHERE collection=?').all('partners').map(r => JSON.parse(r.data));
  const flagged  = db.prepare('SELECT data FROM collections WHERE collection=?').all('flaggedMessages').map(r => JSON.parse(r.data));

  const enriched = partners.map(p => {
    const risk = moderation.partnerRisk7d(flagged, p.id);
    return {
      id:           p.id,
      name:         p.name,
      businessName: p.businessName,
      status:       p.status,
      warnings:     p.warnings || 0,
      lastWarnedAt: p.lastWarnedAt,
      suspendedAt:  p.suspendedAt,
      risk7d:       risk
    };
  }).sort((a, b) => b.risk7d.totalScore - a.risk7d.totalScore);

  res.json(enriched);
});

// POST /api/admin/partners/:id/warn { reason }
app.post('/api/admin/partners/:id/warn', adminOnly, (req, res) => {
  const result = moderation.warnPartner({ db, genId, bumpVersion }, req.params.id, req.body?.reason || 'Manual admin warning');
  if (!result) return res.status(404).json({ error: 'partner not found' });
  res.json(result);
});

// POST /api/admin/partners/:id/suspend { reason }
app.post('/api/admin/partners/:id/suspend', adminOnly, (req, res) => {
  const result = moderation.suspendPartner({ db, genId, bumpVersion }, req.params.id, req.body?.reason || 'Manual admin suspension');
  if (!result) return res.status(404).json({ error: 'partner not found' });
  res.json(result);
});

// POST /api/admin/partners/:id/reactivate { reason }
app.post('/api/admin/partners/:id/reactivate', adminOnly, (req, res) => {
  const result = moderation.reactivatePartner({ db, genId, bumpVersion }, req.params.id, req.body?.reason || 'Manual admin reactivation');
  if (!result) return res.status(404).json({ error: 'partner not found' });
  res.json(result);
});

// GET /api/admin/moderation/thresholds
app.get('/api/admin/moderation/thresholds', adminOnly, (_req, res) => {
  res.json(moderation.THRESHOLDS);
});

// ============================================================
// ============  v1.4 — Restaurants & Delivery  ===============
// ============================================================

// ---------- Menu items per partner ----------
// GET /api/partners/:id/menu — όλα τα menu items του partner
app.get('/api/partners/:id/menu', (req, res) => {
  const partner = getOne('partners', req.params.id);
  if (!partner) return res.status(404).json({ error: 'partner not found' });
  const all = db.prepare('SELECT data FROM collections WHERE collection=?').all('menuItems').map(r => JSON.parse(r.data));
  const items = all.filter(m => m.partnerId === req.params.id);
  res.json({
    partner: {
      id: partner.id,
      name: partner.businessName || partner.name,
      type: partner.type || partner.category,
      cuisine: partner.cuisine,
      rating: partner.rating,
      reviewCount: partner.reviewCount,
      deliveryFee: partner.deliveryFee,
      eta: partner.eta,
      openHours: partner.openHours,
      islandId: partner.islandId
    },
    items
  });
});

// POST /api/partners/:id/menu — partner adds menu item
app.post('/api/partners/:id/menu', (req, res) => {
  const partner = getOne('partners', req.params.id);
  if (!partner) return res.status(404).json({ error: 'partner not found' });
  const item = Object.assign({}, req.body, {
    id: req.body.id || genId('mi'),
    partnerId: partner.id,
    available: req.body.available !== false,
    createdAt: new Date().toISOString()
  });
  saveOne('menuItems', item);
  res.json(item);
});

// PATCH /api/menu-items/:id
app.patch('/api/menu-items/:id', (req, res) => {
  const item = getOne('menuItems', req.params.id);
  if (!item) return res.status(404).json({ error: 'not found' });
  Object.assign(item, req.body, { updatedAt: new Date().toISOString() });
  saveOne('menuItems', item);
  res.json(item);
});

// DELETE /api/menu-items/:id
app.delete('/api/menu-items/:id', (req, res) => {
  db.prepare('DELETE FROM collections WHERE collection=? AND id=?').run('menuItems', req.params.id);
  bumpVersion();
  res.json({ deleted: true });
});

// GET /api/restaurants?island=isl-naxos — όλα τα restaurants (και delivery αν type=delivery)
app.get('/api/restaurants', (req, res) => {
  const all = db.prepare('SELECT data FROM collections WHERE collection=?').all('partners').map(r => JSON.parse(r.data));
  let items = all.filter(p => (p.type === 'restaurant' || p.category === 'restaurant') && p.status === 'approved');
  if (req.query.island) items = items.filter(p => p.islandId === req.query.island);
  res.json(items);
});

app.get('/api/delivery', (req, res) => {
  const all = db.prepare('SELECT data FROM collections WHERE collection=?').all('partners').map(r => JSON.parse(r.data));
  let items = all.filter(p => (p.type === 'delivery' || p.category === 'delivery') && p.status === 'approved');
  if (req.query.island) items = items.filter(p => p.islandId === req.query.island);
  res.json(items);
});

// ---------- Orders ----------
// POST /api/orders { partnerId, hotelId, guestId, type:'restaurant'|'delivery', items:[{itemId,qty,notes?}], deliveryAddress?, scheduledAt? }
app.post('/api/orders', async (req, res) => {
  try {
    const ctx = { db, getOne, saveOne, genId, getSettings: getSettingsObj };
    const order = orders.createOrder(ctx, req.body || {});

    // Auto-create payment intent (full prepay για delivery, 20% για restaurant)
    const intent = await payments.createIntent({
      booking: { ...order, totalAmount: order.prepay.amount }
    });
    order.prepay.intentId = intent.id;
    order.prepay.createdAt = new Date().toISOString();

    saveOne('orders', order);
    res.json({ order, intent });
  } catch (e) {
    res.status(e.code || 500).json({ error: e.message });
  }
});

// GET /api/orders/:id
app.get('/api/orders/:id', (req, res) => {
  const o = getOne('orders', req.params.id);
  if (!o) return res.status(404).json({ error: 'not found' });
  res.json(o);
});

// GET /api/orders?guestId=...|partnerId=...|hotelId=...
app.get('/api/orders', (req, res) => {
  let all = db.prepare('SELECT data FROM collections WHERE collection=?').all('orders').map(r => JSON.parse(r.data));
  if (req.query.guestId)   all = all.filter(o => o.guestId === req.query.guestId);
  if (req.query.partnerId) all = all.filter(o => o.partnerId === req.query.partnerId);
  if (req.query.hotelId)   all = all.filter(o => o.hotelId === req.query.hotelId);
  if (req.query.status)    all = all.filter(o => o.status === req.query.status);
  all.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(all);
});

// POST /api/orders/:id/confirm-payment { intentId? }
app.post('/api/orders/:id/confirm-payment', async (req, res) => {
  const o = getOne('orders', req.params.id);
  if (!o) return res.status(404).json({ error: 'not found' });
  const intentId = req.body?.intentId || o.prepay?.intentId;
  if (intentId && intentId.startsWith('pi_stub_')) {
    await payments.confirmStub(intentId);
  }
  o.prepay.status = 'paid';
  o.prepay.paidAt = new Date().toISOString();
  o.paidAt = o.prepay.paidAt;
  if (o.status === 'placed') o.status = 'confirmed';
  saveOne('orders', o);
  res.json(o);
});

// POST /api/orders/:id/transition { to }
app.post('/api/orders/:id/transition', (req, res) => {
  const o = getOne('orders', req.params.id);
  if (!o) return res.status(404).json({ error: 'not found' });
  const to = req.body?.to;
  if (!orders.canTransitionOrder(o.status, to)) {
    return res.status(400).json({ error: `cannot transition ${o.status} → ${to}` });
  }
  o.status = to;
  if (to === 'delivered') o.deliveredAt = new Date().toISOString();
  if (to === 'cancelled') o.cancelledAt = new Date().toISOString();
  saveOne('orders', o);
  res.json(o);
});

// Fallback to index for unknown routes (single-page-style)
app.get('/', (_req, res) => res.redirect('/JMK_App.html'));

// ---------- HTTP + WebSocket server ----------
const httpServer = http.createServer(app);
const wss = chat.attach(httpServer, { db, jwtSecret: JWT_SECRET, genId, bumpVersion });

httpServer.listen(PORT, () => {
  console.log(`[JMK] backend running on http://localhost:${PORT}`);
  console.log(`[JMK] static apps served from ${STATIC_DIR}`);
  console.log(`[JMK] db at ${DB_PATH}`);
  console.log(`[JMK] WebSocket chat: ${wss ? 'enabled at ws://localhost:' + PORT + '/ws' : 'DISABLED (run npm install ws)'}`);
  console.log(`[JMK] QR generation:  ${qr.available ? 'enabled' : 'DISABLED (run npm install qrcode)'}`);
  console.log(`[JMK] Photo uploads:  ${uploads.available ? `enabled (${uploads.MODE} mode)` : 'DISABLED (run npm install multer)'}`);
  console.log(`[JMK] Email mode:     ${email.MODE}`);
  console.log(`[JMK] Payment mode:   ${payments.MODE}`);
});
