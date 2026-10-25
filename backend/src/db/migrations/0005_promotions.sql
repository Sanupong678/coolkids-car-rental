-- 0005 — Promotions, targeting, funnel events.

CREATE TABLE promotions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                 text NOT NULL CHECK (slug ~ '^[a-z0-9-]+$'),
  name                 text NOT NULL,
  description          text,
  terms                text,
  banner_media_id      uuid REFERENCES media(id),
  -- NULL code = auto-applied when eligible; non-NULL = customer must enter it.
  code                 citext,
  discount_type        text NOT NULL CHECK (discount_type IN ('PERCENT','FIXED_PER_DAY','FIXED_PER_BOOKING')),
  -- PERCENT: basis points (2000 = 20.00%). FIXED_*: minor currency units.
  discount_value       bigint NOT NULL CHECK (discount_value > 0),
  max_discount_minor   bigint CHECK (max_discount_minor > 0),      -- cap for PERCENT promotions
  currency             char(3) NOT NULL DEFAULT 'USD',
  applies_to_all       boolean NOT NULL DEFAULT false,            -- else: promotion_vehicles / promotion_categories
  min_rental_days      smallint CHECK (min_rental_days >= 1),
  max_rental_days      smallint CHECK (max_rental_days >= 1),
  starts_at            timestamptz NOT NULL,                      -- business rule 10: both dates mandatory
  ends_at              timestamptz NOT NULL,
  usage_limit          integer CHECK (usage_limit > 0),           -- total redemptions
  per_user_limit       integer CHECK (per_user_limit > 0),
  priority             integer NOT NULL DEFAULT 0,                -- tie-breaker when several apply
  status               text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','PAUSED','ARCHIVED')),
  is_featured          boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid REFERENCES users(id),
  updated_by           uuid REFERENCES users(id),
  deleted_at           timestamptz,
  deleted_by           uuid REFERENCES users(id),
  CHECK (ends_at > starts_at),
  CHECK (discount_type <> 'PERCENT' OR discount_value <= 10000),
  CHECK (max_rental_days IS NULL OR min_rental_days IS NULL OR max_rental_days >= min_rental_days)
);
CREATE UNIQUE INDEX promotions_slug_live_uq ON promotions (slug) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX promotions_code_live_uq ON promotions (code) WHERE code IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX promotions_active_window_idx ON promotions (starts_at, ends_at) WHERE status = 'ACTIVE' AND deleted_at IS NULL;
CREATE TRIGGER promotions_updated_at BEFORE UPDATE ON promotions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER promotions_no_delete BEFORE DELETE ON promotions FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

CREATE TABLE promotion_vehicles (
  promotion_id       uuid NOT NULL REFERENCES promotions(id),
  vehicle_id         uuid NOT NULL REFERENCES vehicles(id),
  PRIMARY KEY (promotion_id, vehicle_id)
);
CREATE INDEX promotion_vehicles_vehicle_idx ON promotion_vehicles (vehicle_id);

CREATE TABLE promotion_categories (
  promotion_id       uuid NOT NULL REFERENCES promotions(id),
  category_id        uuid NOT NULL REFERENCES vehicle_categories(id),
  PRIMARY KEY (promotion_id, category_id)
);
CREATE INDEX promotion_categories_category_idx ON promotion_categories (category_id);

-- Promotion funnel: IMPRESSION → CLICK → VEHICLE_VIEW → BOOKING_STARTED → APPLIED → BOOKING_COMPLETED.
-- user_id is nullable (anonymous visitors); session_key ties anonymous events together.
-- (booking_id FK is added in 0006.)
CREATE TABLE promotion_events (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  promotion_id       uuid NOT NULL REFERENCES promotions(id),
  event_type         text NOT NULL CHECK (event_type IN ('IMPRESSION','CLICK','VEHICLE_VIEW','BOOKING_STARTED','APPLIED','BOOKING_COMPLETED')),
  user_id            uuid REFERENCES users(id),
  session_key        text,
  vehicle_id         uuid REFERENCES vehicles(id),
  booking_id         uuid,
  occurred_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX promotion_events_promo_type_idx ON promotion_events (promotion_id, event_type, occurred_at);
CREATE INDEX promotion_events_time_brin ON promotion_events USING brin (occurred_at);
