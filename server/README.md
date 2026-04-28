# JMK · Backend Server (v1.2)

Node.js + Express + SQLite REST API + WebSocket chat + Cloudinary uploads. Powers cross-device sync για τα 4 JMK apps (Guest, Hotelier, Partner, Admin).

**Τι περιλαμβάνει:**
- REST API (CRUD για όλες τις οντότητες)
- Auth με JWT (register/login/me)
- **Booking flow** με commission split 10/10/80 και state machine
- **Real-time chat** μέσω WebSockets, με anti-bypass detection
- **QR code generation** (PNG/SVG/dataURL)
- **Weather forecast** μέσω Open-Meteo (δωρεάν, χωρίς key)
- **Itinerary generator** (3 weather-aware πλάνα/μέρα)
- **Payment processing** (Stripe ή stub mode)
- **Email notifications** (log/Resend/SendGrid)
- **Photo/video uploads** (Cloudinary ή local) με auto-resize
- **Availability calendar** ανά activity (recurring weekly + blocked dates + time slots με capacity)
- **Dynamic pricing** (high season, weekend, last-minute, group discounts)
- **Inventory check** πριν δημιουργηθεί booking — όχι double-booking
- **Airbnb-style activity fields** (includes/excludes, languages, rules, cancellation policy)
- Long-poll sync για clients χωρίς WebSockets
- PostgreSQL migration script έτοιμο για production scale

---

## Local run

```bash
cd server
npm install
node server.js
```

Άνοιξε `http://localhost:3000/JMK_App.html` στον browser. Ο server σερβίρει και τα HTML apps και το API.

Δοκίμασε ότι όλα δουλεύουν:
```bash
bash tests/e2e.sh
# Πρέπει να δεις: Passed: 46  Failed: 0
```

---

## Deploy σε production (Render)

1. Φτιάξε δωρεάν λογαριασμό στο [github.com](https://github.com) και στο [render.com](https://render.com).
2. Φτιάξε ένα νέο repo στο GitHub με όνομα `jmk-app`. Ανέβασε όλο τον φάκελο `JMK APP (1)`.
3. Στο Render: **New → Blueprint** → επίλεξε το repo. Διαβάζει το `server/render.yaml` και deploy-άρει αυτόματα.
4. Σε ~3 λεπτά παίρνεις URL: `https://jmk-server-xxxx.onrender.com`.
5. Δοκίμασε: `https://jmk-server-xxxx.onrender.com/api/health`.
6. Άνοιξε το `https://jmk-server-xxxx.onrender.com/JMK_App.html` και είσαι έτοιμος.

> **Προσοχή:** Το free tier του Render «κοιμίζει» τον server μετά από 15 λεπτά αδράνειας. Το πρώτο request μετά τον ύπνο παίρνει ~30s. Για παραγωγή θες paid tier ($7/μήνα).

### Environment variables (production)

| Var | Default | Σκοπός |
|---|---|---|
| `PORT` | 3000 | Port |
| `JWT_SECRET` | `jmk-dev-secret-change-in-prod` | **ΑΛΛΑΞΕ ΣΕ PRODUCTION** |
| `DB_PATH` | `./jmk.sqlite` | Path του SQLite file |
| `PUBLIC_URL` | `http://localhost:3000` | Domain για QR URLs |
| `STRIPE_SECRET_KEY` | (none) | Αν δοθεί → real Stripe payments |
| `STRIPE_WEBHOOK_SECRET` | (none) | Για το `/api/payments/webhook` |
| `RESEND_API_KEY` | (none) | Real email μέσω Resend |
| `SENDGRID_API_KEY` | (none) | Real email μέσω SendGrid |
| `EMAIL_FROM` | `JMK <noreply@jmk.app>` | From address |
| `EMAIL_MODE` | auto-detected | `log`, `resend`, ή `sendgrid` |
| `CLOUDINARY_URL` | (none) | Αν δοθεί → photos uploads πάνε σε Cloudinary CDN |
| `CLOUDINARY_CLOUD_NAME`/`API_KEY`/`API_SECRET` | (none) | Εναλλακτικά αντί CLOUDINARY_URL |
| `UPLOAD_DIR` | `./uploads` | Local storage path (αν δεν χρησιμοποιείς Cloudinary) |

---

## Endpoints

### Health & Sync
```
GET    /api/health
GET    /api/changes?since=<ms>      long-poll για cross-device sync
```

### Generic CRUD
```
GET    /api/collections/:name              όλα τα records
GET    /api/collections/:name/:id          ένα record
POST   /api/collections/:name              create
PATCH  /api/collections/:name/:id          partial update
DELETE /api/collections/:name/:id          delete
GET    /api/settings                       όλα τα platform settings
PATCH  /api/settings                       update settings
POST   /api/reset                          wipe + reseed (dev only)
```

Collections: `islands`, `categories`, `hotels`, `partners`, `activities`, `guests`, `bookings`, `payouts`, `flaggedMessages`, `reviews`, `partnerRequests`, `notifications`, `messages_<bookingId>`.

### Auth
```
POST   /api/auth/register     { email, password, role, name }
POST   /api/auth/login        { email, password }   → { token, user }
GET    /api/auth/me           (Bearer token)
```

### Bookings & Commission (NEW v1.1)
```
GET    /api/commission/preview?total=110&hotelId=h-naxos-1
POST   /api/bookings                       δημιουργεί booking με auto commission
POST   /api/bookings/:id/transition        { to: 'agreed'|'paid'|'completed'|... }
GET    /api/bookings/:id/messages          ιστορικό chat
POST   /api/bookings/:id/messages          στείλε μήνυμα (REST fallback)
```

**Commission split** (founder-confirmed): 10% JMK + 10% hotel + ~80% partner − stripe fee (1.4% + 0.25€).

**State machine:**
```
pending → chat → agreed → paid → completed → reviewed
                      ↘ cancelled
```

### QR codes (NEW v1.1)
```
GET    /api/qr/hotel/:id?format=png|svg|dataurl&room=204
GET    /api/qr/url?text=<text>             generic QR encoder
```

### Weather (NEW v1.1)
```
GET    /api/weather?island=isl-naxos&date=2026-07-19
```
Επιστρέφει live forecast από Open-Meteo + computed `suitable` flags για cross-check με `activity.weatherConditions`.

### Itinerary (NEW v1.1)
```
POST   /api/itinerary                      { hotelId, dates: [...], guestId? }
```
Επιστρέφει 3 weather-aware πλάνα/μέρα: Adventure, Relax, Foodie.

### Payments (NEW v1.1)
```
POST   /api/payments/intent                { bookingId } → Stripe intent
POST   /api/payments/confirm               { bookingId, intentId } (dev/stub)
POST   /api/payments/webhook               Stripe webhook handler
```

### Reviews (NEW v1.1)
```
POST   /api/reviews                        { bookingId, rating, text, lang }
```
Auto-transitions booking σε `reviewed` και ενημερώνει partner rating.

### Photo Uploads (NEW v1.2)
```
POST   /api/uploads                        multipart, field 'files', μέχρι 10 αρχεία/request
                                           body: activityId? (auto-attach)
DELETE /api/uploads/:id?activityId=...     διαγραφή
PATCH  /api/activities/:id/photos          { order: ['id1','id2',...] } reorder
GET    /uploads/:filename                  static serve (μόνο σε local mode)
```
Dual-mode: αν `CLOUDINARY_URL` env var → Cloudinary (auto-resize, fast CDN). Αλλιώς local disk.

### Availability & Calendar (NEW v1.2)
```
GET    /api/activities/:id/availability?from=YYYY-MM-DD&to=YYYY-MM-DD
PATCH  /api/activities/:id/schedule        { weekly, timeSlots, blockedDates, ... }
POST   /api/activities/:id/block-dates     { dates: ['YYYY-MM-DD',...] }
POST   /api/activities/:id/unblock-dates   { dates: ['YYYY-MM-DD',...] }
```

### Dynamic Pricing (NEW v1.2)
```
GET    /api/activities/:id/price-preview?date=&time=&people=
PATCH  /api/activities/:id/pricing         { base, highSeason, weekend, lastMinute, groupDiscounts }
```

### Activity Details (NEW v1.2)
```
PATCH  /api/activities/:id/details         { includes, excludes, languages, rules, cancellationPolicy, minAge }
GET    /api/cancellation-policies          catalog (flexible/moderate/strict)
```

### WebSocket Chat (NEW v1.1)
```
WS     /ws
```

Wire protocol (JSON):
```js
// client → server
{ type:'join',    bookingId, token }
{ type:'message', bookingId, text }
{ type:'typing',  bookingId, on:true }
{ type:'read',    bookingId, messageId }

// server → client
{ type:'joined',  bookingId, history, booking }
{ type:'message', bookingId, message }
{ type:'typing',  bookingId, userId, on }
{ type:'read',    bookingId, messageId, by }
{ type:'error',   error }
```

Anti-bypass: μηνύματα με τηλέφωνα/emails/social handles σημαιώνονται αυτόματα και προωθούνται στο admin (collection `flaggedMessages`).

---

## Δομή φακέλων

```
server/
├── server.js              # Express app + όλα τα endpoints
├── seed.js                # Initial data (νησιά, hotels, partners, activities, bookings)
├── package.json
├── render.yaml            # Render deployment config
├── lib/
│   ├── commission.js      # Commission calculator (10/10/80) + state machine
│   ├── chat.js            # WebSocket server + anti-bypass detection
│   ├── itinerary.js       # 3-themes-per-day generator
│   ├── weather.js         # Open-Meteo wrapper με 1h cache
│   ├── qr.js              # QR code generation (qrcode library)
│   ├── email.js           # Email wrapper (log/Resend/SendGrid)
│   ├── payments.js        # Stripe wrapper με stub mode
│   ├── uploads.js         # Photo/video uploads (Cloudinary + local fallback)
│   ├── availability.js    # Calendar, weekly schedule, time slots, blocked dates
│   └── pricing.js         # Dynamic pricing (season/weekend/group/last-minute)
├── postgres/
│   ├── schema.sql         # Production-ready Postgres schema (base)
│   ├── schema_v1_2.sql    # v1.2 additions (photos, availability, pricing)
│   ├── migrate.js         # SQLite → Postgres migration
│   └── README.md          # Πότε & πώς να μετακομίσεις σε Postgres
└── tests/
    └── e2e.sh             # Smoke test 46 assertions
```

---

## Σύνδεση των client apps

**Same-origin** (default — όταν τα HTML σερβίρονται από τον ίδιο server):
Δεν χρειάζεται καμία ρύθμιση. Το `jmk_config.js` αυτο-εντοπίζει το backend.

**Different origin** (π.χ. HTML σε Netlify, server σε Render):
Άνοιξε το `jmk_config.js` και βάλε:
```js
root.JMK_API_URL = 'https://jmk-server-xxxx.onrender.com';
```

---

## Database

Default: SQLite στο `DB_PATH`. Schema:

```sql
collections(collection TEXT, id TEXT, data TEXT, created_at INT, updated_at INT)
settings(key TEXT, value TEXT)
users(id TEXT, email TEXT, password_hash TEXT, role TEXT, data TEXT, created_at INT)
meta(key TEXT, value TEXT)
```

Generic key-value design: κάθε «πίνακας» (`hotels`, `bookings`...) είναι rows στο `collections` table με JSON payload. Απλό, ευέλικτο, αρκετά γρήγορο για ~100k records. Για production scale με concurrent writes → δες `postgres/README.md`.

### Backup
```bash
sqlite3 jmk.sqlite ".backup /tmp/jmk-$(date +%F).sqlite"
```

### Migration σε PostgreSQL (όταν αναλάβει developer)
```bash
export DATABASE_URL='postgres://user:pass@host/db'
npm install pg
psql "$DATABASE_URL" -f postgres/schema.sql
node postgres/migrate.js
```
Πλήρης οδηγός: `postgres/README.md`.

---

## Tests

```bash
npm test    # ή: bash tests/e2e.sh
```

46 assertions: health → reset → seed → commission → weather → itinerary → QR → booking → anti-bypass → state machine → payment → review → auth → photos in seed → schedule → pricing rules → availability → block/unblock dates → double-booking rejection → dynamic pricing → group discount → activity details update → photo upload.

Πριν τρέξει, βεβαιώσου ότι το server τρέχει στο `:3000` (ή set `BASE=http://...`).

---

## Τι μπορεί να κάνει ο developer που θα αναλάβει

Αυτό το backend είναι **production-ready για pilot/MVP**. Τι θα ήθελε να βελτιώσει για scale:

1. **Migration σε PostgreSQL** (4 ώρες) — δες `postgres/`
2. **Real Stripe integration** — εγκατάσταση `npm i stripe`, set `STRIPE_SECRET_KEY`, ρύθμιση webhook στο Stripe Dashboard
3. **Real email** — set `RESEND_API_KEY` (πιο εύκολο) ή `SENDGRID_API_KEY`
4. **File uploads για partner photos/videos** — προτείνεται S3/Cloudflare R2 με pre-signed URLs
5. **Rate limiting** — `npm i express-rate-limit` για auth endpoints
6. **Logging/observability** — Sentry για errors, Logtail για logs
7. **Strict authorization checks** στο `lib/chat.js` (σήμερα είναι «soft» για demo)
8. **App Store / Play Store** για το mobile partner app (PWA wrapper με Capacitor)
9. **i18n** — ήδη υπάρχει η υποδομή (settings.languages), λείπουν translation files
10. **Tests** — προσθήκη unit tests με Vitest για το `lib/commission.js`, `lib/itinerary.js`

Τα παραπάνω εκτιμώνται σε ~2-3 εβδομάδες δουλειάς για έμπειρο dev (αντί για 4 μήνες από το μηδέν).
