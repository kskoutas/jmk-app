-- ============================================================
-- JMK · PostgreSQL Schema v1.2 additions
-- ============================================================
-- Τρέξε ΜΕΤΑ το schema.sql (το βασικό schema). Αυτό προσθέτει
-- πίνακες για photos, availability, pricing rules.
--
-- Run:  psql $DATABASE_URL -f schema_v1_2.sql
-- ============================================================

BEGIN;

-- Επεκτάσεις στο activities (αν δεν υπάρχουν ήδη)
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS includes             TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS excludes             TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS languages            TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS rules                TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cancellation_policy  TEXT,
  ADD COLUMN IF NOT EXISTS min_age              INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_advance_hours    INTEGER NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS max_advance_days     INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS season_start         DATE,
  ADD COLUMN IF NOT EXISTS season_end           DATE;

-- ---------- Photos ----------
CREATE TABLE IF NOT EXISTS activity_photos (
  id           TEXT PRIMARY KEY,
  activity_id  TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  thumb_url    TEXT,
  width        INTEGER,
  height       INTEGER,
  bytes        INTEGER,
  mime         TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_cover     BOOLEAN NOT NULL DEFAULT FALSE,
  provider     TEXT,        -- 'cloudinary' | 'local' | 'unsplash' | ...
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_photos_activity ON activity_photos(activity_id, display_order);

-- ---------- Availability — recurring weekly ----------
CREATE TABLE IF NOT EXISTS activity_weekly_availability (
  activity_id  TEXT PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
  monday       BOOLEAN NOT NULL DEFAULT TRUE,
  tuesday      BOOLEAN NOT NULL DEFAULT TRUE,
  wednesday    BOOLEAN NOT NULL DEFAULT TRUE,
  thursday     BOOLEAN NOT NULL DEFAULT TRUE,
  friday       BOOLEAN NOT NULL DEFAULT TRUE,
  saturday     BOOLEAN NOT NULL DEFAULT TRUE,
  sunday       BOOLEAN NOT NULL DEFAULT TRUE
);

-- ---------- Time slots ----------
CREATE TABLE IF NOT EXISTS activity_time_slots (
  id            TEXT PRIMARY KEY,
  activity_id   TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  time          TEXT NOT NULL,                     -- 'HH:MM'
  duration_min  INTEGER NOT NULL DEFAULT 180,
  capacity      INTEGER NOT NULL DEFAULT 8,
  label         TEXT
);
CREATE INDEX IF NOT EXISTS idx_slots_activity ON activity_time_slots(activity_id);

-- ---------- Blocked / extra-open dates ----------
CREATE TABLE IF NOT EXISTS activity_date_overrides (
  activity_id  TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('blocked','open')),
  PRIMARY KEY (activity_id, date)
);

-- ---------- Pricing rules ----------
-- Single row ανά activity. Πιο σύνθετες περιπτώσεις (π.χ. tiered seasons)
-- μπορούν να μοντελοποιηθούν σε ξεχωριστό πίνακα μελλοντικά.
CREATE TABLE IF NOT EXISTS activity_pricing (
  activity_id              TEXT PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
  base                     NUMERIC(10,2) NOT NULL,
  unit                     TEXT NOT NULL DEFAULT 'person' CHECK (unit IN ('person','group')),
  currency                 TEXT NOT NULL DEFAULT 'EUR',
  high_season_start        DATE,
  high_season_end          DATE,
  high_season_multiplier   NUMERIC(4,2) DEFAULT 1.00,
  weekend_multiplier       NUMERIC(4,2) DEFAULT 1.00,
  weekend_days             INTEGER[] DEFAULT '{5,6}'::INTEGER[],     -- 0=Mon..6=Sun
  last_minute_hours        INTEGER DEFAULT 0,
  last_minute_multiplier   NUMERIC(4,2) DEFAULT 1.00,
  early_bird_days          INTEGER DEFAULT 0,
  early_bird_multiplier    NUMERIC(4,2) DEFAULT 1.00,
  group_discounts          JSONB NOT NULL DEFAULT '[]'::jsonb        -- [{minPeople:6, multiplier:0.95}, ...]
);

-- ---------- Update bookings table για slot tracking ----------
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS slot_id              TEXT REFERENCES activity_time_slots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit_price           NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS pricing_breakdown    JSONB;

CREATE INDEX IF NOT EXISTS idx_bookings_slot_date ON bookings(slot_id, date) WHERE status NOT IN ('cancelled');

COMMIT;
