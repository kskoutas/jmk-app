/**
 * JMK · SQLite → PostgreSQL Migration
 * -----------------------------------
 * Διαβάζει το SQLite (jmk.sqlite) και κάνει INSERT τα δεδομένα στο Postgres.
 *
 * Run:
 *   DATABASE_URL=postgres://user:pass@host/db node postgres/migrate.js
 *
 * Πριν τρέξει, βεβαιώσου ότι έχεις:
 *   1. εγκαταστήσει το `pg`:           npm install pg
 *   2. δημιουργήσει το schema:         psql $DATABASE_URL -f postgres/schema.sql
 *
 * Idempotent: αν τρέξει ξανά, κάνει UPSERT (ON CONFLICT DO UPDATE).
 */
'use strict';

const path = require('path');
const { DatabaseSync } = require('node:sqlite');

let Pool;
try { Pool = require('pg').Pool; }
catch (e) {
  console.error('ERROR: `pg` library not installed. Run: npm install pg');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL env var required.');
  console.error('Example: DATABASE_URL=postgres://jmk:secret@localhost:5432/jmk node migrate.js');
  process.exit(1);
}

const SQLITE_PATH = process.env.SQLITE_PATH || path.join(__dirname, '..', 'jmk.sqlite');
const sqlite = new DatabaseSync(SQLITE_PATH);
const pg = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Διαβάζει όλα τα records ενός collection από το SQLite.
 */
function readCollection(name) {
  const rows = sqlite.prepare('SELECT data FROM collections WHERE collection=?').all(name);
  return rows.map(r => JSON.parse(r.data));
}

function readSettings() {
  const rows = sqlite.prepare('SELECT key, value FROM settings').all();
  const out = {};
  rows.forEach(r => out[r.key] = JSON.parse(r.value));
  return out;
}

async function upsert(table, columns, rows, pkCol = 'id') {
  if (rows.length === 0) return 0;
  const placeholders = (i) => '(' + columns.map((_, j) => `$${i * columns.length + j + 1}`).join(',') + ')';
  const updateSet = columns.filter(c => c !== pkCol).map(c => `${c}=EXCLUDED.${c}`).join(',');
  const valuesSql = rows.map((_, i) => placeholders(i)).join(',');
  const params = rows.flatMap(r => columns.map(c => r[c] ?? null));
  const sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES ${valuesSql}
               ON CONFLICT (${pkCol}) DO UPDATE SET ${updateSet}`;
  const r = await pg.query(sql, params);
  return r.rowCount;
}

(async () => {
  console.log(`[migrate] SQLite: ${SQLITE_PATH}`);
  console.log(`[migrate] Postgres: ${process.env.DATABASE_URL.replace(/:[^:@]+@/, ':****@')}`);

  // ---- Islands ----
  let n = await upsert('islands', ['id','name','region','status','allowed_categories','hotel_count','partner_count'],
    readCollection('islands').map(i => ({
      id: i.id, name: i.name, region: i.region, status: i.status,
      allowed_categories: i.allowedCategories || [],
      hotel_count: i.hotelCount || 0, partner_count: i.partnerCount || 0
    })));
  console.log(`  ✓ islands: ${n}`);

  // ---- Categories ----
  n = await upsert('categories', ['id','name','icon','default_duration'],
    readCollection('categories').map(c => ({
      id: c.id, name: c.name, icon: c.icon, default_duration: c.defaultDuration
    })));
  console.log(`  ✓ categories: ${n}`);

  // ---- Hotels ----
  n = await upsert('hotels', ['id','name','island_id','rooms','owner_name','email','phone','status','qr_short_code','commission_pct','joined_at','total_bookings','total_commission'],
    readCollection('hotels').map(h => ({
      id: h.id, name: h.name, island_id: h.islandId, rooms: h.rooms,
      owner_name: h.ownerName, email: h.email, phone: h.phone,
      status: h.status, qr_short_code: (h.qrCode || '').replace(/^.*\//, ''),
      commission_pct: h.commissionPct ?? 10, joined_at: h.joinedAt,
      total_bookings: h.totalBookings || 0, total_commission: h.totalCommission || 0
    })));
  console.log(`  ✓ hotels: ${n}`);

  // ---- Partners ----
  n = await upsert('partners', ['id','name','business_name','island_id','category','email','phone','vat','iban','status','rating','review_count','total_earnings','joined_at'],
    readCollection('partners').map(p => ({
      id: p.id, name: p.name, business_name: p.businessName, island_id: p.islandId,
      category: p.category, email: p.email, phone: p.phone, vat: p.vat, iban: p.iban,
      status: p.status, rating: p.rating, review_count: p.reviewCount || 0,
      total_earnings: p.totalEarnings || 0, joined_at: p.joinedAt
    })));
  console.log(`  ✓ partners: ${n}`);

  // ---- Activities ----
  n = await upsert('activities', ['id','partner_id','island_id','category','title','description','price','duration','max_people','status','rating','review_count','weather_conditions','cover_icon'],
    readCollection('activities').map(a => ({
      id: a.id, partner_id: a.partnerId, island_id: a.islandId, category: a.category,
      title: a.title, description: a.description, price: a.price, duration: a.duration,
      max_people: a.maxPeople, status: a.status, rating: a.rating, review_count: a.reviewCount || 0,
      weather_conditions: a.weatherConditions || [], cover_icon: a.coverIcon
    })));
  console.log(`  ✓ activities: ${n}`);

  // ---- Guests ----
  n = await upsert('guests', ['id','name','email','hotel_id','room','check_in','check_out','traveler','interests','total_spent'],
    readCollection('guests').map(g => ({
      id: g.id, name: g.name, email: g.email, hotel_id: g.hotelId, room: g.room,
      check_in: g.checkIn, check_out: g.checkOut, traveler: g.traveler,
      interests: g.interests || [], total_spent: g.totalSpent || 0
    })));
  console.log(`  ✓ guests: ${n}`);

  // ---- Bookings ----
  // SQLite μπορεί να έχει 'confirmed' (alias) — μετατροπή σε 'paid'
  const STATE_ALIAS = { confirmed: 'paid' };
  n = await upsert('bookings', ['id','activity_id','partner_id','hotel_id','guest_id','date','time','people','total_amount','partner_amount','hotel_commission','jmk_commission','stripe_fee','status','created_at','paid_at','completed_at'],
    readCollection('bookings').map(b => ({
      id: b.id, activity_id: b.activityId, partner_id: b.partnerId, hotel_id: b.hotelId,
      guest_id: b.guestId, date: b.date, time: b.time, people: b.people,
      total_amount: b.totalAmount, partner_amount: b.partnerAmount,
      hotel_commission: b.hotelCommission, jmk_commission: b.jmkCommission,
      stripe_fee: b.stripeFee || 0, status: STATE_ALIAS[b.status] || b.status,
      created_at: b.createdAt, paid_at: b.paidAt, completed_at: b.completedAt
    })));
  console.log(`  ✓ bookings: ${n}`);

  // ---- Reviews ----
  n = await upsert('reviews', ['id','booking_id','guest_id','activity_id','partner_id','hotel_id','rating','text','lang','created_at'],
    readCollection('reviews').map(r => ({
      id: r.id, booking_id: r.bookingId, guest_id: r.guestId, activity_id: r.activityId,
      partner_id: r.partnerId, hotel_id: r.hotelId,
      rating: r.rating, text: r.text, lang: r.lang, created_at: r.createdAt
    })));
  console.log(`  ✓ reviews: ${n}`);

  // ---- Payouts ----
  n = await upsert('payouts', ['id','recipient_type','recipient_id','amount','period','status','paid_at'],
    readCollection('payouts').map(p => ({
      id: p.id, recipient_type: p.recipientType, recipient_id: p.recipientId,
      amount: p.amount, period: p.period, status: p.status, paid_at: p.paidAt
    })));
  console.log(`  ✓ payouts: ${n}`);

  // ---- Notifications ----
  n = await upsert('notifications', ['id','to_role','to_id','type','title','body','read','actionable','request_id','created_at'],
    readCollection('notifications').map(x => ({
      id: x.id, to_role: x.toRole, to_id: x.toId, type: x.type, title: x.title,
      body: x.body, read: !!x.read, actionable: !!x.actionable,
      request_id: x.requestId, created_at: x.createdAt
    })));
  console.log(`  ✓ notifications: ${n}`);

  // ---- Messages (από messages_<bookingId> collections) ----
  const allCollections = sqlite.prepare("SELECT DISTINCT collection FROM collections WHERE collection LIKE 'messages_%'").all();
  let totalMsg = 0;
  for (const c of allCollections) {
    const msgs = readCollection(c.collection);
    if (msgs.length === 0) continue;
    totalMsg += await upsert('messages', ['id','booking_id','from_user_id','from_name','from_role','text','original_text','flagged','flag_kind','read_by','created_at'],
      msgs.map(m => ({
        id: m.id, booking_id: m.bookingId, from_user_id: m.from, from_name: m.fromName,
        from_role: m.fromRole, text: m.text, original_text: m.originalText || null,
        flagged: !!m.flagged, flag_kind: m.flagKind || null,
        read_by: m.readBy || [], created_at: m.createdAt
      })));
  }
  console.log(`  ✓ messages: ${totalMsg}`);

  // ---- Settings ----
  const settings = readSettings();
  for (const [k, v] of Object.entries(settings)) {
    await pg.query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()', [k, JSON.stringify(v)]);
  }
  console.log(`  ✓ settings: ${Object.keys(settings).length}`);

  console.log('\n[migrate] Done. Verify with: psql $DATABASE_URL -c "SELECT count(*) FROM bookings"');
  await pg.end();
})().catch(err => {
  console.error('[migrate] FAILED:', err);
  process.exit(1);
});
