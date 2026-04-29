# JMK · Backend Server (v1.4)

Node.js + Express + SQLite REST API + WebSocket chat + Cloudinary uploads + Auto-prepayment + Anti-bypass v2. Powers cross-device sync για τα 4 JMK apps (Guest, Hotelier, Partner, Admin).

**Τι περιλαμβάνει:**
- REST API (CRUD για όλες τις οντότητες)
- Auth με JWT (register/login/me)
- **Booking flow** με commission split 10/10/80 και state machine (chat → agreed → deposit_paid → paid → completed → reviewed)
- **Real-time chat** μέσω WebSockets
- **Anti-bypass v2** — έξυπνη ανίχνευση ελληνικών φράσεων (πάρε τηλέφωνο, εκτός εφαρμογής, μετρητά κλπ), risk score 0-100, auto-warn/auto-suspend partners
- **Auto 20% deposit** όταν συμφωνηθεί τιμή στο chat — δεν περνάει από το χέρι σου
- **Refund calculation** βάσει cancellation policy
- **Admin moderation panel** — λίστα flagged, partner risk dashboard, manual warn/suspend/reactivate
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
# Πρέπει να δεις: Passed: 66  Failed: 0
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

### Auto Pre-Payment (NEW v1.3)
```
POST   /api/bookings/:id/agree             { agreedAmount?, agreedTime?, agreedSlotId? }
                                           → δημιουργεί Stripe intent για 20% deposit
                                           → status: chat → agreed (deposit pending)
POST   /api/bookings/:id/confirm-deposit   { intentId? }
                                           → marks deposit paid → status: deposit_paid
POST   /api/bookings/:id/refund            { reason? }
                                           → υπολογίζει refund βάσει cancellation policy
```
**Στόχος:** όταν συμφωνηθεί τιμή στο chat, το 20% (= JMK + Hotel commission) χρεώνεται αυτόματα. Δεν περνάει από manual παρέμβαση.

### Anti-Bypass v2 (NEW v1.3)
```
POST   /api/antibypass/check               { text } → { flagged, kind, riskScore, severity, signals }
```
Ανιχνεύει: phone/email/IBAN/cards/social, ελληνικές φράσεις (πάρε με τηλέφωνο, εκτός εφαρμογής, πληρώνεις απευθείας μετρητά κλπ), συγκαλυμμένα νούμερα ("έξι εννιά..."), URLs.

### Restaurants & Delivery (NEW v1.4)
```
GET    /api/restaurants?island=isl-naxos          λίστα εστιατορίων
GET    /api/delivery?island=isl-naxos             λίστα delivery providers
GET    /api/partners/:id/menu                     menu items + partner info
POST   /api/partners/:id/menu                     partner adds menu item
PATCH  /api/menu-items/:id                        update item (price, available)
DELETE /api/menu-items/:id                        delete

POST   /api/orders                                δημιουργία order + auto payment intent
                                                  body: { partnerId, hotelId, guestId, type:'restaurant'|'delivery', items:[{itemId,qty,notes?}], deliveryAddress? }
GET    /api/orders/:id
GET    /api/orders?guestId=|partnerId=|hotelId=|status=
POST   /api/orders/:id/confirm-payment            μετά την πληρωμή
POST   /api/orders/:id/transition                 placed→confirmed→preparing→ready→delivered→reviewed
```
**Διαφορετικό payment flow:**
- `restaurant` (κράτηση τραπεζιού): 20% deposit για no-show protection, υπόλοιπο στο εστιατόριο
- `delivery`: **100% prepayment μέσω app**, ο guest δεν δίνει χρήματα στον driver, η εφαρμογή πληρώνει τον partner στο επόμενο payout cycle

### Admin Moderation Panel (NEW v1.3)
Auth: header `X-Admin-Key: <ADMIN_KEY env>` ή JWT με role='admin'.
```
GET    /api/admin/flagged?status=open|resolved   λίστα flagged messages (sorted by risk)
POST   /api/admin/flagged/:id/resolve            { action: 'ignore'|'warn'|'suspend', reason }
GET    /api/admin/partners/risk                  dashboard με risk score 7d ανά partner
POST   /api/admin/partners/:id/warn              { reason } — manual warning
POST   /api/admin/partners/:id/suspend           { reason } — pause partner + όλα τα activities
POST   /api/admin/partners/:id/reactivate        { reason } — επαναφορά
GET    /api/admin/moderation/thresholds          τα current auto-action thresholds
```
**Auto-actions:** Risk score 7d ≥ 150 ή 3+ flagged → auto-warn. ≥ 300 ή 5+ flagged → auto-suspend.

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

## Client Apps v2 (NEW v1.4)

Έχουν φτιαχτεί **4 νέα HTML apps** που μιλάνε με το πραγματικό backend (αντικαθιστούν τα demo HTML):

| App | URL | Σκοπός |
|---|---|---|
| **Guest v2** | `/JMK_Guest_v2.html?h=<hotelId>` | Persuasive UX με 3 tabs (Δραστηριότητες/Εστιατόρια/Delivery), photo gallery, ratings, social proof, single-click booking με auto 20% deposit |
| **Partner v2** | `/JMK_Partner_v2.html?p=<partnerId>` | Airbnb-style host dashboard: today overview, calendar block/unblock με ένα click, photo upload drag-drop, menu management για restaurants/delivery, incoming bookings/orders με state transitions, real-time chat |
| **Hotelier v2** | `/JMK_Hotelier_v2.html?h=<hotelId>` | Hotel dashboard: today stats, QR generator με print-A4 support (όλα τα δωμάτια σε 1 σελίδα), live booking feed, μηνιαίο statement, top partners, current guests |
| **Admin v2** | `/JMK_Admin_v2.html?key=<adminKey>` | Stats, moderation με 1-click warn/suspend, risk dashboard, pending approvals, hotels, partners, settings |

**Shared lib:** `jmk_v2_shared.js` (CSS theme + UI helpers όπως modal/toast/confirm + HTTP helpers).

**Παλιά HTML** (`JMK_App.html`, `JMK_Guest_App.html`, `JMK_Partner_App.html`, `JMK_Hotelier_App.html`, `JMK_Admin_App.html`) παραμένουν ως έχουν για backwards compat. Τα QR codes πλέον δείχνουν στο **Guest v2**.

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
