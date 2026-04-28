# JMK · Backend Server

Node.js + Express + SQLite REST API. Powers cross-device sync for the four JMK apps (Guest, Hotelier, Partner, Admin).

## Local run (στον υπολογιστή σου)

```bash
cd server
npm install
node server.js
```

Άνοιξε `http://localhost:3000/JMK_App.html` στον browser. Ο server σερβίρει και τα HTMLs και το API. Όλες οι αλλαγές αποθηκεύονται στο `jmk.sqlite` δίπλα στο `server.js` και επιβιώνουν restarts.

## Deploy σε production (5 λεπτά, δωρεάν, με Render.com)

1. Φτιάξε δωρεάν λογαριασμό στο [github.com](https://github.com) και στο [render.com](https://render.com).
2. Φτιάξε ένα νέο repo στο GitHub με όνομα `jmk-app`. Ανέβασε όλο τον φάκελο `JMK APP (1)` (drag & drop στη web UI του GitHub κάνει τη δουλειά αν δεν ξέρεις git).
3. Στο Render: **New → Blueprint** → επίλεξε το repo. Διαβάζει αυτόματα το `server/render.yaml` και deploy-άρει.
4. Σε ~3 λεπτά παίρνεις ένα URL: `https://jmk-server-xxxx.onrender.com`.
5. Δοκίμασε: `https://jmk-server-xxxx.onrender.com/api/health` — πρέπει να επιστρέψει JSON με `ok:true`.
6. Άνοιξε το `https://jmk-server-xxxx.onrender.com/JMK_App.html` και είσαι έτοιμος. Το ίδιο URL μοιράζεσαι με όποιον θες — όλοι βλέπουν ίδια δεδομένα.

> Το free tier του Render «κοιμίζει» τον server μετά από 15 λεπτά αδράνειας. Το πρώτο request μετά τον ύπνο παίρνει ~30s. Για παραγωγή θες paid tier ($7/μήνα).

## Εναλλακτική: Railway

```bash
npm install -g @railway/cli
railway login
cd server
railway init
railway up
```

## Endpoints

```
GET    /api/health
GET    /api/collections/:name              all items in a collection
GET    /api/collections/:name/:id          single item
POST   /api/collections/:name              create
PATCH  /api/collections/:name/:id          partial update
DELETE /api/collections/:name/:id          delete
GET    /api/settings                       all platform settings
PATCH  /api/settings                       update settings
POST   /api/reset                          wipe + reseed (dev only)
POST   /api/auth/register                  { email, password, role, name }
POST   /api/auth/login                     { email, password } → { token, user }
GET    /api/auth/me                        current user (needs Bearer token)
GET    /api/changes?since=<ms>             long-poll for cross-device sync
```

Collections: `islands`, `categories`, `hotels`, `partners`, `activities`, `guests`, `bookings`, `payouts`, `flaggedMessages`, `reviews`, `partnerRequests`, `notifications`.

## Σύνδεση των client apps με τον server

**Αν τα HTMLs σερβίρονται από τον ίδιο server** (όπως όταν τρέχεις τοπικά ή στο Render), δεν χρειάζεται καμία ρύθμιση — το `jmk_config.js` αυτο-εντοπίζει το backend (probe σε `/api/health`).

**Αν τα HTMLs είναι κάπου αλλού** (π.χ. Netlify) και ο server αλλού: άνοιξε το `jmk_config.js` και βάλε:

```js
root.JMK_API_URL = 'https://jmk-server-xxxx.onrender.com';
```

## Database

Single SQLite file στο `DB_PATH`. Schema:

```sql
collections(collection TEXT, id TEXT, data TEXT, created_at INT, updated_at INT)
settings(key TEXT, value TEXT)
users(id TEXT, email TEXT, password_hash TEXT, role TEXT, data TEXT, created_at INT)
meta(key TEXT, value TEXT)
```

Generic key-value design — κάθε «πίνακας» (islands, hotels, bookings…) είναι rows στο ίδιο `collections` table με JSON payload. Απλό, ευέλικτο, αρκετά γρήγορο για ~100k records. Για production scale χρειάζεσαι μετάβαση σε PostgreSQL με προσεκτικά typed schemas.

## Backup

```bash
sqlite3 jmk.sqlite ".backup /tmp/jmk-$(date +%F).sqlite"
```

Στο Render με persistent disk, κάνε `render disks` για snapshots.

## Migration σε PostgreSQL (όταν πάρεις χρηματοδότηση)

1. Δημιούργησε PostgreSQL DB (Render Postgres, Supabase, Neon).
2. Replace `better-sqlite3` με `pg` και πέρασε το connection string από env.
3. Schema παραμένει ίδια — JSONB column αντί για TEXT.
4. Migration script: dump JSON από SQLite → INSERT σε PG.
