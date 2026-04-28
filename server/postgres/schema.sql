-- ============================================================
-- JMK · PostgreSQL Schema (production-ready)
-- ============================================================
-- Όταν αναλάβει developer και θέλει να μεταβεί από SQLite σε
-- PostgreSQL, αυτό είναι το schema. Τυποποιημένα fields με
-- foreign keys, indexes και constraints. Πάνω από αυτό μπορεί
-- να χτιστεί ORM (Prisma/Drizzle) ή να μείνει pg-native.
--
-- Run:  psql $DATABASE_URL -f schema.sql
-- ============================================================

BEGIN;

-- ---------- Reference data ----------
CREATE TABLE IF NOT EXISTS islands (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  region              TEXT,
  status              TEXT NOT NULL DEFAULT 'active', -- active, pending, paused
  allowed_categories  TEXT[] NOT NULL DEFAULT '{}',
  hotel_count         INTEGER NOT NULL DEFAULT 0,
  partner_count       INTEGER NOT NULL DEFAULT 0,
  centroid_lat        NUMERIC(8,4),
  centroid_lon        NUMERIC(8,4),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  icon                TEXT,
  default_duration    TEXT
);

-- ---------- Users / Auth ----------
CREATE TABLE IF NOT EXISTS users (
  id                  TEXT PRIMARY KEY,
  email               TEXT UNIQUE NOT NULL,
  password_hash       TEXT NOT NULL,
  role                TEXT NOT NULL CHECK (role IN ('guest','partner','hotelier','admin')),
  name                TEXT,
  phone               TEXT,
  locale              TEXT DEFAULT 'el',
  email_verified_at   TIMESTAMPTZ,
  last_login_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ---------- Hotels ----------
CREATE TABLE IF NOT EXISTS hotels (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT REFERENCES users(id) ON DELETE SET NULL,
  name                TEXT NOT NULL,
  island_id           TEXT REFERENCES islands(id),
  rooms               INTEGER NOT NULL DEFAULT 0,
  owner_name          TEXT,
  email               TEXT,
  phone               TEXT,
  address             TEXT,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','paused','rejected')),
  qr_short_code       TEXT UNIQUE,
  commission_pct      NUMERIC(5,2) NOT NULL DEFAULT 10.00,  -- hotel cut (10% default)
  joined_at           DATE,
  total_bookings      INTEGER NOT NULL DEFAULT 0,
  total_commission    NUMERIC(12,2) NOT NULL DEFAULT 0,
  iban                TEXT,
  vat                 TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hotels_island ON hotels(island_id);
CREATE INDEX IF NOT EXISTS idx_hotels_status ON hotels(status);

-- ---------- Partners ----------
CREATE TABLE IF NOT EXISTS partners (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT REFERENCES users(id) ON DELETE SET NULL,
  name                TEXT NOT NULL,
  business_name       TEXT,
  island_id           TEXT REFERENCES islands(id),
  category            TEXT REFERENCES categories(id),
  email               TEXT,
  phone               TEXT,
  vat                 TEXT,
  iban                TEXT,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','paused','rejected')),
  rating              NUMERIC(3,2),
  review_count        INTEGER NOT NULL DEFAULT 0,
  total_earnings      NUMERIC(12,2) NOT NULL DEFAULT 0,
  joined_at           DATE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_partners_island ON partners(island_id);
CREATE INDEX IF NOT EXISTS idx_partners_status ON partners(status);

-- ---------- Activities ----------
CREATE TABLE IF NOT EXISTS activities (
  id                  TEXT PRIMARY KEY,
  partner_id          TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  island_id           TEXT REFERENCES islands(id),
  category            TEXT REFERENCES categories(id),
  title               TEXT NOT NULL,
  description         TEXT,
  price               NUMERIC(10,2) NOT NULL,
  duration            TEXT,
  max_people          INTEGER NOT NULL DEFAULT 1,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','rejected','draft')),
  rating              NUMERIC(3,2),
  review_count        INTEGER NOT NULL DEFAULT 0,
  weather_conditions  TEXT[] NOT NULL DEFAULT '{}',
  cover_icon          TEXT,
  cover_image_url     TEXT,
  gallery             JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activities_partner ON activities(partner_id);
CREATE INDEX IF NOT EXISTS idx_activities_island_status ON activities(island_id, status);
CREATE INDEX IF NOT EXISTS idx_activities_category ON activities(category);

-- ---------- Guests ----------
CREATE TABLE IF NOT EXISTS guests (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT REFERENCES users(id) ON DELETE SET NULL,
  name                TEXT,
  email               TEXT,
  phone               TEXT,
  hotel_id            TEXT REFERENCES hotels(id),
  room                TEXT,
  check_in            DATE,
  check_out           DATE,
  traveler            TEXT, -- 'solo','couple','family','group'
  interests           TEXT[] NOT NULL DEFAULT '{}',
  total_spent         NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_guests_hotel ON guests(hotel_id);

-- ---------- Bookings (κεντρικός πίνακας) ----------
CREATE TABLE IF NOT EXISTS bookings (
  id                  TEXT PRIMARY KEY,
  activity_id         TEXT NOT NULL REFERENCES activities(id),
  partner_id          TEXT NOT NULL REFERENCES partners(id),
  hotel_id            TEXT NOT NULL REFERENCES hotels(id),
  guest_id            TEXT NOT NULL REFERENCES guests(id),
  date                DATE NOT NULL,
  time                TEXT NOT NULL,
  people              INTEGER NOT NULL DEFAULT 1 CHECK (people > 0),
  total_amount        NUMERIC(10,2) NOT NULL,
  partner_amount      NUMERIC(10,2) NOT NULL,
  hotel_commission    NUMERIC(10,2) NOT NULL,
  jmk_commission      NUMERIC(10,2) NOT NULL,
  stripe_fee          NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency            TEXT NOT NULL DEFAULT 'EUR',
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','chat','agreed','paid','completed','reviewed','cancelled','disputed')),
  payment_intent_id   TEXT,
  cancel_reason       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at             TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bookings_guest ON bookings(guest_id);
CREATE INDEX IF NOT EXISTS idx_bookings_partner ON bookings(partner_id);
CREATE INDEX IF NOT EXISTS idx_bookings_hotel ON bookings(hotel_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status_date ON bookings(status, date);

-- ---------- Messages (chat) ----------
CREATE TABLE IF NOT EXISTS messages (
  id                  TEXT PRIMARY KEY,
  booking_id          TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  from_user_id        TEXT NOT NULL,
  from_name           TEXT,
  from_role           TEXT,
  text                TEXT NOT NULL,
  original_text       TEXT,           -- αν flagged, εδώ το πλήρες κείμενο
  flagged             BOOLEAN NOT NULL DEFAULT FALSE,
  flag_kind           TEXT,           -- phone | email | social
  read_by             TEXT[] NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_booking ON messages(booking_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_flagged ON messages(flagged) WHERE flagged = TRUE;

-- ---------- Reviews ----------
CREATE TABLE IF NOT EXISTS reviews (
  id                  TEXT PRIMARY KEY,
  booking_id          TEXT NOT NULL UNIQUE REFERENCES bookings(id),
  guest_id            TEXT NOT NULL REFERENCES guests(id),
  activity_id         TEXT NOT NULL REFERENCES activities(id),
  partner_id          TEXT NOT NULL REFERENCES partners(id),
  hotel_id            TEXT NOT NULL REFERENCES hotels(id),
  rating              INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text                TEXT,
  lang                TEXT DEFAULT 'el',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reviews_activity ON reviews(activity_id);

-- ---------- Payouts ----------
CREATE TABLE IF NOT EXISTS payouts (
  id                  TEXT PRIMARY KEY,
  recipient_type      TEXT NOT NULL CHECK (recipient_type IN ('partner','hotel')),
  recipient_id        TEXT NOT NULL,
  amount              NUMERIC(12,2) NOT NULL,
  period              TEXT NOT NULL,           -- e.g. "2026-07-01..15"
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','paid','failed')),
  paid_at             DATE,
  bank_ref            TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payouts_recipient ON payouts(recipient_type, recipient_id);

-- ---------- Notifications ----------
CREATE TABLE IF NOT EXISTS notifications (
  id                  TEXT PRIMARY KEY,
  to_role             TEXT NOT NULL,
  to_id               TEXT NOT NULL,
  type                TEXT NOT NULL,
  title               TEXT NOT NULL,
  body                TEXT,
  read                BOOLEAN NOT NULL DEFAULT FALSE,
  actionable          BOOLEAN NOT NULL DEFAULT FALSE,
  request_id          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_target ON notifications(to_role, to_id, read);

-- ---------- Settings (key-value) ----------
CREATE TABLE IF NOT EXISTS settings (
  key                 TEXT PRIMARY KEY,
  value               JSONB NOT NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- Trigger για updated_at ----------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY['hotels','activities','bookings']) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated ON %1$s', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_updated BEFORE UPDATE ON %1$s FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t);
  END LOOP;
END $$;

COMMIT;
