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
const commission = require('./lib/commission');
const weather    = require('./lib/weather');
const itinerary  = require('./lib/itinerary');
const qr         = require('./lib/qr');
const chat       = require('./lib/chat');
const email      = require('./lib/email');
const payments   = require('./lib/payments');

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
      (SEED[coll] || []).forEach(obj => insColl.run(coll, obj.id, JSON.stringify(obj), now, now));
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
// POST /api/bookings { activityId, hotelId, guestId, date, time, people }
// Δημιουργεί booking με σωστό commission split και state='chat'
app.post('/api/bookings', (req, res) => {
  const { activityId, hotelId, guestId, date, time, people } = req.body || {};
  if (!activityId || !hotelId || !guestId) return res.status(400).json({ error: 'activityId, hotelId, guestId required' });
  const activity = getOne('activities', activityId);
  if (!activity) return res.status(404).json({ error: 'activity not found' });
  const hotel = getOne('hotels', hotelId);
  if (!hotel) return res.status(404).json({ error: 'hotel not found' });

  const ppl = Math.max(1, Number(people) || 1);
  const totalAmount = Number(activity.price) * ppl;
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
    date: date || new Date().toISOString().slice(0, 10),
    time: time || '10:00',
    people: ppl,
    totalAmount: split.total,
    partnerAmount: split.partnerAmount,
    hotelCommission: split.hotelCommission,
    jmkCommission: split.jmkCommission,
    stripeFee: split.stripeFee,
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

  const detection = chat.detectBypass(text);
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
    readBy: [req.user?.id || fromId || 'anonymous'],
    createdAt: new Date().toISOString()
  };
  saveOne(`messages_${bookingId}`, message);

  if (detection.flagged) {
    saveOne('flaggedMessages', {
      id: genId('fm'),
      bookingId,
      from: message.from,
      fromName: message.fromName,
      text,
      kind: detection.kind,
      createdAt: message.createdAt,
      resolved: false
    });
  }

  res.json(message);
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
  console.log(`[JMK] Email mode:     ${email.MODE}`);
  console.log(`[JMK] Payment mode:   ${payments.MODE}`);
});
