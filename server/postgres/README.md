# PostgreSQL Migration Path

Όταν αναλάβει developer και θέλει να μεταβεί από SQLite σε PostgreSQL για production scale (> 100k bookings, multi-region, concurrent writes).

## Γιατί PostgreSQL αντί SQLite

| | SQLite | PostgreSQL |
|---|---|---|
| Concurrency | μέτρια (single writer) | άριστη |
| Backups | file copy | pg_dump, snapshots, replication |
| Hosting | local/Render disk | Render, Supabase, Neon, AWS RDS |
| Scaling | vertical only | vertical + read replicas |
| JSON queries | OK | άριστα (JSONB + GIN indexes) |
| Cost στην αρχή | $0 | $7-15/μήνα |

## Steps (περίπου 2-4 ώρες δουλειάς)

```bash
# 1. Φτιάξε Postgres database (Neon έχει γενναιόδωρο free tier)
#    https://neon.tech/  →  νέο project  →  copy το connection string

export DATABASE_URL='postgres://user:pass@ep-xxx.region.aws.neon.tech/jmk'

# 2. Εγκατέστησε pg
cd server
npm install pg

# 3. Δημιούργησε το schema
psql "$DATABASE_URL" -f postgres/schema.sql

# 4. Migrate τα δεδομένα από SQLite
node postgres/migrate.js

# 5. Verify
psql "$DATABASE_URL" -c "SELECT count(*) FROM bookings"
```

## Επόμενο βήμα: αλλαγή του server.js

Το `server.js` σήμερα χρησιμοποιεί SQLite μέσω `node:sqlite`. Για να μεταβεί σε PostgreSQL χρειάζονται τρεις αλλαγές:

1. **Αντικατάσταση του DB driver:** `const { DatabaseSync } = require('node:sqlite')` → `const { Pool } = require('pg')`
2. **Async queries:** Όλα τα `db.prepare(...).get()/all()/run()` γίνονται `await pool.query(...)`
3. **Schema-aware queries:** Αντί για generic `collections` table, queries πάνω στους typed πίνακες (`SELECT * FROM bookings WHERE status='paid'` αντί `SELECT data FROM collections WHERE collection='bookings'`).

Κρατήστε το `lib/commission.js`, `lib/itinerary.js`, `lib/weather.js`, `lib/qr.js`, `lib/email.js`, `lib/payments.js` ως έχουν — είναι DB-agnostic.

Το `lib/chat.js` χρειάζεται μικρή αλλαγή στα DB calls του (storage μηνυμάτων).

## Hybrid mode (μεταβατικά)

Μπορείς να τρέξεις PostgreSQL για production και SQLite για dev. Πρόσθεσε flag στο `server.js`:

```js
const DB_DRIVER = process.env.DB_DRIVER || 'sqlite';
const db = DB_DRIVER === 'postgres' ? require('./db/pg') : require('./db/sqlite');
```

και βάλε τα DB-specific queries πίσω από κοινό interface.
