/**
 * JMK · Real-Time Chat (WebSockets)
 * ----------------------------------
 * Rooms ανά bookingId. Guest και Partner κάνουν join.
 *
 * Wire protocol (JSON over WS):
 *   client → server:
 *     { type:'join',    bookingId, token }      // authenticate και join room
 *     { type:'message', bookingId, text }       // στείλε μήνυμα
 *     { type:'typing',  bookingId, on:true }    // typing indicator
 *     { type:'read',    bookingId, messageId }  // read receipt
 *
 *   server → client:
 *     { type:'joined', bookingId, history: [...] }
 *     { type:'message', bookingId, message: {id, from, fromName, text, createdAt, flagged} }
 *     { type:'typing', bookingId, userId, on }
 *     { type:'error', error }
 *
 * Anti-bypass: μηνύματα που περιέχουν τηλέφωνο/email/whatsapp/instagram σημαιώνονται
 * (kind: 'phone'|'email'|'social'), αποθηκεύονται με flagged=true και προωθούνται
 * στο admin (collection: flaggedMessages) για review.
 */
'use strict';

let WebSocketServer = null;
try {
  WebSocketServer = require('ws').WebSocketServer;
} catch (e) {
  console.warn('[chat] `ws` library not installed — WebSocket chat disabled. Run `npm install ws`.');
}

const jwt = require('jsonwebtoken');
const antibypass = require('./antibypass');

// ---- v1 API kept for backwards compatibility ----
function detectBypass(text) {
  const r = antibypass.detect(text);
  return {
    flagged: r.flagged,
    kind: r.kind,
    redactedText: r.redactedText,
    riskScore: r.riskScore,
    severity: r.severity,
    signals: r.signals
  };
}

/**
 * Attach WebSocket chat server σε ένα HTTP server.
 * @param {http.Server} httpServer
 * @param {object} ctx - { db, jwtSecret, genId, bumpVersion }
 */
function attach(httpServer, ctx) {
  if (!WebSocketServer) return null;

  const { db, jwtSecret, genId, bumpVersion } = ctx;
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const rooms = new Map(); // bookingId → Set<ws>

  wss.on('connection', (ws, req) => {
    ws.user = null;
    ws.rooms = new Set();
    ws.isAlive = true;

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); }
      catch { return ws.send(JSON.stringify({ type: 'error', error: 'invalid json' })); }

      try {
        switch (msg.type) {
          case 'join': return handleJoin(ws, msg, { db, jwtSecret, rooms });
          case 'message': return handleMessage(ws, msg, { db, rooms, genId, bumpVersion });
          case 'typing': return handleTyping(ws, msg, { rooms });
          case 'read': return handleRead(ws, msg, { db, rooms, bumpVersion });
          default: ws.send(JSON.stringify({ type: 'error', error: 'unknown type' }));
        }
      } catch (err) {
        console.error('[chat] handler error:', err);
        ws.send(JSON.stringify({ type: 'error', error: err.message }));
      }
    });

    ws.on('close', () => {
      for (const bookingId of ws.rooms) {
        const set = rooms.get(bookingId);
        if (set) {
          set.delete(ws);
          if (set.size === 0) rooms.delete(bookingId);
        }
      }
    });
  });

  // Heartbeat — drop stale connections
  const heartbeat = setInterval(() => {
    wss.clients.forEach(ws => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    });
  }, 30000);
  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}

function handleJoin(ws, msg, { db, jwtSecret, rooms }) {
  const { bookingId, token } = msg;
  if (!bookingId) return ws.send(JSON.stringify({ type: 'error', error: 'bookingId required' }));

  if (token) {
    try { ws.user = jwt.verify(token, jwtSecret); } catch { /* anonymous OK */ }
  }

  // Verify booking exists
  const row = db.prepare('SELECT data FROM collections WHERE collection=? AND id=?').get('bookings', bookingId);
  if (!row) return ws.send(JSON.stringify({ type: 'error', error: 'booking not found' }));
  const booking = JSON.parse(row.data);

  // Authorization (light): if user is logged in, check they're guest/partner of this booking or admin
  if (ws.user && ws.user.role !== 'admin') {
    const allowed = booking.guestId === ws.user.id || booking.partnerId === ws.user.id;
    // για demo/dev επιτρέπουμε και χωρίς match — production θα ήταν αυστηρό
    if (!allowed) {
      // ws.send(JSON.stringify({ type: 'error', error: 'not allowed in this booking' }));
      // return;
    }
  }

  // Join room
  if (!rooms.has(bookingId)) rooms.set(bookingId, new Set());
  rooms.get(bookingId).add(ws);
  ws.rooms.add(bookingId);

  // Στείλε ιστορικό
  const histRows = db.prepare(
    "SELECT data FROM collections WHERE collection=? ORDER BY updated_at ASC"
  ).all(`messages_${bookingId}`);
  const history = histRows.map(r => JSON.parse(r.data));

  ws.send(JSON.stringify({ type: 'joined', bookingId, history, booking }));
}

function handleMessage(ws, msg, { db, rooms, genId, bumpVersion }) {
  const { bookingId, text } = msg;
  if (!bookingId || !text) return;
  if (typeof text !== 'string' || text.length > 2000) {
    return ws.send(JSON.stringify({ type: 'error', error: 'invalid text' }));
  }

  const detection = detectBypass(text);
  const fromId   = ws.user?.id   || msg.fromId   || 'anonymous';
  const fromName = ws.user?.name || msg.fromName || 'Άγνωστος';
  const fromRole = ws.user?.role || msg.fromRole || 'guest';

  const message = {
    id: genId('msg'),
    bookingId,
    from: fromId,
    fromName,
    fromRole,
    text: detection.redactedText,
    originalText: detection.flagged ? text : undefined,
    flagged: detection.flagged,
    flagKind: detection.kind,
    riskScore: detection.riskScore,
    severity: detection.severity,
    readBy: [fromId],
    createdAt: new Date().toISOString()
  };

  // Persist στο collection messages_<bookingId>
  const now = Date.now();
  db.prepare('INSERT OR REPLACE INTO collections(collection,id,data,created_at,updated_at) VALUES(?,?,?,?,?)')
    .run(`messages_${bookingId}`, message.id, JSON.stringify(message), now, now);

  // Αν είναι flagged, δημιούργησε record στο flaggedMessages για το admin + trigger moderation
  if (detection.flagged) {
    // Get partnerId from booking για να ξέρει το moderation από ποιον partner ήρθε
    const bookingRow = db.prepare('SELECT data FROM collections WHERE collection=? AND id=?').get('bookings', bookingId);
    const booking = bookingRow ? JSON.parse(bookingRow.data) : null;
    const fm = {
      id: genId('fm'),
      bookingId,
      from: fromId,
      fromName,
      fromRole,
      partnerId: booking?.partnerId || null,
      text: text, // πλήρες κείμενο για admin review
      redactedText: detection.redactedText,
      kind: detection.kind,
      riskScore: detection.riskScore,
      severity: detection.severity,
      signals: detection.signals,
      createdAt: message.createdAt,
      resolved: false
    };
    db.prepare('INSERT OR REPLACE INTO collections(collection,id,data,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run('flaggedMessages', fm.id, JSON.stringify(fm), now, now);

    // Auto-moderation: αν είναι partner που στέλνει ύποπτο μήνυμα, τρέξε risk check
    if (fromRole === 'partner' && booking) {
      try {
        const moderation = require('./moderation');
        moderation.processFlaggedMessage({ db, genId, bumpVersion }, fm);
      } catch (e) { console.warn('[chat] moderation error:', e.message); }
    }
  }

  bumpVersion();

  // Broadcast σε όλους στο room
  const payload = JSON.stringify({ type: 'message', bookingId, message });
  const set = rooms.get(bookingId) || new Set();
  for (const peer of set) {
    if (peer.readyState === 1) peer.send(payload);
  }
}

function handleTyping(ws, msg, { rooms }) {
  const { bookingId, on } = msg;
  if (!bookingId) return;
  const userId = ws.user?.id || 'anon';
  const payload = JSON.stringify({ type: 'typing', bookingId, userId, on: !!on });
  const set = rooms.get(bookingId) || new Set();
  for (const peer of set) {
    if (peer !== ws && peer.readyState === 1) peer.send(payload);
  }
}

function handleRead(ws, msg, { db, rooms, bumpVersion }) {
  const { bookingId, messageId } = msg;
  if (!bookingId || !messageId) return;
  const userId = ws.user?.id || 'anon';
  const row = db.prepare('SELECT data FROM collections WHERE collection=? AND id=?').get(`messages_${bookingId}`, messageId);
  if (!row) return;
  const message = JSON.parse(row.data);
  message.readBy = Array.from(new Set([...(message.readBy || []), userId]));
  db.prepare('UPDATE collections SET data=?, updated_at=? WHERE collection=? AND id=?')
    .run(JSON.stringify(message), Date.now(), `messages_${bookingId}`, messageId);
  bumpVersion();
  const payload = JSON.stringify({ type: 'read', bookingId, messageId, by: userId });
  const set = rooms.get(bookingId) || new Set();
  for (const peer of set) {
    if (peer.readyState === 1) peer.send(payload);
  }
}

module.exports = { attach, detectBypass, available: !!WebSocketServer };
