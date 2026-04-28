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
const express              = require('express');
const cors                 = require('cors');
const { DatabaseSync }     = require('node:sqlite');   // built-in (Node ≥ 22)
const bcrypt               = require('bcryptjs');
const jwt                  = require('jsonwebtoken');

const PORT       = process.env.PORT || 3000;
const DB_PATH    = process.env.DB_PATH    || path.join(__dirname, 'jmk.sqlite');
const JWT_SECRET = process.env.JWT_SECRET || 'jmk-dev-secret-change-in-prod';
const STATIC_DIR = path.resolve(__dirname, '..');   // serves the 5 HTML apps

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

// Fallback to index for unknown routes (single-page-style)
app.get('/', (_req, res) => res.redirect('/JMK_App.html'));

app.listen(PORT, () => {
  console.log(`[JMK] backend running on http://localhost:${PORT}`);
  console.log(`[JMK] static apps served from ${STATIC_DIR}`);
  console.log(`[JMK] db at ${DB_PATH}`);
});
