-- 0006 — Customer identification, add-on services, bookings, line items,
--        status state machine + history, promotion redemptions.

-- Sensitive identity documents. Document numbers and address are encrypted by
-- the API (AES-256-GCM, key from env / KMS) before they reach the database.
-- *_last4 and *_hmac allow display and duplicate detection without decryption.
CREATE TABLE customer_identities (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    uuid NOT NULL REFERENCES users(id),
  country_code               char(2) NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  legal_full_name            text NOT NULL,
  date_of_birth              date NOT NULL CHECK (date_of_birth > '1900-01-01'),
  id_document_type           text NOT NULL CHECK (id_document_type IN ('NATIONAL_ID','PASSPORT')),
  id_document_number_enc     bytea NOT NULL,
  id_document_number_last4   text NOT NULL,
  id_document_number_hmac    bytea NOT NULL,
  id_document_expiry         date,
  license_number_enc         bytea NOT NULL,
  license_number_last4       text NOT NULL,
  license_number_hmac        bytea NOT NULL,
  license_country_code       char(2) NOT NULL,
  license_expiry             date NOT NULL,
  license_issued_at          date,
  address_enc                bytea,                 -- encrypted JSON {line1, line2, city, region, postal, country}
  phone                      text NOT NULL,
  id_front_media_id          uuid REFERENCES media(id),   -- private bucket, signed URLs only
  id_back_media_id           uuid REFERENCES media(id),
  license_front_media_id     uuid REFERENCES media(id),
  encryption_key_version     smallint NOT NULL DEFAULT 1,  -- enables key rotation
  verification_status        text NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING','VERIFIED','REJECTED')),
  verified_by                uuid REFERENCES users(id),
  verified_at                timestamptz,
  rejection_reason           text,
  -- Identities are versioned, never edited: a correction inserts a new row and
  -- un-flags the old one, so past bookings keep pointing at what was submitted.
  is_current                 boolean NOT NULL DEFAULT true,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  deleted_at                 timestamptz,
  CHECK (license_expiry > COALESCE(license_issued_at, '1900-01-01'))
);
CREATE UNIQUE INDEX customer_identities_one_current ON customer_identities (user_id) WHERE is_current AND deleted_at IS NULL;
CREATE INDEX customer_identities_license_hmac_idx ON customer_identities (license_number_hmac);

CREATE TABLE add_on_services (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9_]+$'),
  name               text NOT NULL,
  description        text,
  kind               text NOT NULL CHECK (kind IN ('INSURANCE','EQUIPMENT','SERVICE')),
  pricing_unit       text NOT NULL CHECK (pricing_unit IN ('PER_DAY','PER_BOOKING')),
  price_minor        bigint NOT NULL CHECK (price_minor >= 0),
  max_quantity       smallint NOT NULL DEFAULT 1 CHECK (max_quantity >= 1),
  is_taxable         boolean NOT NULL DEFAULT true,
  is_active          boolean NOT NULL DEFAULT true,
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);
CREATE TRIGGER add_on_services_updated_at BEFORE UPDATE ON add_on_services FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE SEQUENCE booking_number_seq;

CREATE TABLE bookings (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_number         text NOT NULL UNIQUE
                         DEFAULT ('BK-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('booking_number_seq')::text, 6, '0')),
  user_id                uuid NOT NULL REFERENCES users(id),
  vehicle_id             uuid NOT NULL REFERENCES vehicles(id),
  customer_identity_id   uuid REFERENCES customer_identities(id),  -- required before CONFIRMED (checked below)
  pickup_location_id     uuid NOT NULL REFERENCES locations(id),
  return_location_id     uuid NOT NULL REFERENCES locations(id),
  fulfillment_type       text NOT NULL DEFAULT 'BRANCH_PICKUP' CHECK (fulfillment_type IN ('BRANCH_PICKUP','DELIVERY')),
  delivery_address       jsonb,          -- {line1, city, lat, lng, notes} when fulfillment_type = DELIVERY
  pickup_at              timestamptz NOT NULL,
  return_at              timestamptz NOT NULL,
  actual_pickup_at       timestamptz,
  actual_return_at       timestamptz,
  status                 text NOT NULL DEFAULT 'PENDING'
                         CHECK (status IN ('PENDING','CONFIRMED','PREPARING','READY','IN_DELIVERY','ACTIVE',
                                           'COMPLETED','CANCELLED','EXPIRED','REFUNDED')),
  -- Payment window for PENDING bookings; an expiry job moves them to EXPIRED.
  hold_expires_at        timestamptz,
  -- Pricing (computed by the backend pricing engine; frontend numbers are display-only)
  currency               char(3) NOT NULL,
  rental_days            integer NOT NULL CHECK (rental_days >= 1),
  extra_hours            integer NOT NULL DEFAULT 0 CHECK (extra_hours BETWEEN 0 AND 23),
  subtotal_minor         bigint NOT NULL CHECK (subtotal_minor >= 0),   -- rental + add-ons + fees, before discount & tax
  discount_minor         bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  tax_minor              bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  total_minor            bigint NOT NULL CHECK (total_minor >= 0),
  deposit_minor          bigint NOT NULL DEFAULT 0 CHECK (deposit_minor >= 0),  -- refundable, not part of total
  pricing_snapshot       jsonb NOT NULL,      -- engine version, rates, tax rate, promotion evaluated → reproducible
  promotion_id           uuid REFERENCES promotions(id),
  -- Mileage per rental (raw readings are also in vehicle_mileage)
  odometer_start_km      integer CHECK (odometer_start_km >= 0),
  odometer_end_km        integer,
  distance_km            integer GENERATED ALWAYS AS (odometer_end_km - odometer_start_km) STORED,
  source                 text NOT NULL DEFAULT 'WEB' CHECK (source IN ('WEB','MOBILE','ADMIN','PHONE')),
  attribution            jsonb NOT NULL DEFAULT '{}'::jsonb,   -- utm_*, referrer, landing promo (no PII)
  customer_notes         text,
  confirmed_at           timestamptz,
  cancelled_at           timestamptz,
  cancelled_by           uuid REFERENCES users(id),
  cancellation_reason    text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz,
  deleted_by             uuid REFERENCES users(id),
  CONSTRAINT bookings_period_valid    CHECK (return_at > pickup_at),
  CONSTRAINT bookings_total_formula   CHECK (total_minor = subtotal_minor - discount_minor + tax_minor),
  CONSTRAINT bookings_discount_le_sub CHECK (discount_minor <= subtotal_minor),
  CONSTRAINT bookings_odometer_order  CHECK (odometer_end_km IS NULL OR odometer_end_km >= odometer_start_km),
  CONSTRAINT bookings_pending_has_hold CHECK (status <> 'PENDING' OR hold_expires_at IS NOT NULL),
  CONSTRAINT bookings_delivery_addr   CHECK (fulfillment_type <> 'DELIVERY' OR delivery_address IS NOT NULL),
  CONSTRAINT bookings_identity_before_confirm CHECK (status IN ('PENDING','CANCELLED','EXPIRED') OR customer_identity_id IS NOT NULL),
  CONSTRAINT bookings_cancel_consistent CHECK ((status IN ('CANCELLED','REFUNDED')) = (cancelled_at IS NOT NULL))
);
CREATE INDEX bookings_user_idx          ON bookings (user_id, pickup_at DESC);
CREATE INDEX bookings_vehicle_idx       ON bookings (vehicle_id, pickup_at);
CREATE INDEX bookings_status_idx        ON bookings (status, pickup_at);
CREATE INDEX bookings_created_idx       ON bookings (created_at);
CREATE INDEX bookings_pickup_loc_idx    ON bookings (pickup_location_id, pickup_at);
CREATE INDEX bookings_promotion_idx     ON bookings (promotion_id) WHERE promotion_id IS NOT NULL;
CREATE INDEX bookings_hold_expiry_idx   ON bookings (hold_expires_at) WHERE status = 'PENDING';
CREATE TRIGGER bookings_updated_at BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER bookings_no_delete  BEFORE DELETE ON bookings FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

ALTER TABLE vehicle_availability_blocks ADD CONSTRAINT vab_booking_fk FOREIGN KEY (booking_id) REFERENCES bookings(id);
ALTER TABLE vehicle_mileage ADD CONSTRAINT vehicle_mileage_booking_fk FOREIGN KEY (booking_id) REFERENCES bookings(id);
ALTER TABLE promotion_events ADD CONSTRAINT promotion_events_booking_fk FOREIGN KEY (booking_id) REFERENCES bookings(id);

-- Itemised price breakdown, exactly as shown on the invoice/contract.
-- Discounts are negative amounts; SUM(amount_minor) = bookings.total_minor.
CREATE TABLE booking_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id         uuid NOT NULL REFERENCES bookings(id),
  item_type          text NOT NULL CHECK (item_type IN ('RENTAL','EXTRA_HOURS','ADD_ON','INSURANCE','PICKUP_FEE',
                                                         'RETURN_FEE','ONE_WAY_FEE','DELIVERY_FEE','DISCOUNT','TAX')),
  description        text NOT NULL,
  add_on_service_id  uuid REFERENCES add_on_services(id),
  promotion_id       uuid REFERENCES promotions(id),
  quantity           numeric(10,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_amount_minor  bigint NOT NULL,
  amount_minor       bigint NOT NULL,
  is_taxable         boolean NOT NULL DEFAULT true,
  sort_order         smallint NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK ((item_type = 'DISCOUNT') = (amount_minor < 0) OR amount_minor = 0),
  CHECK (item_type <> 'DISCOUNT' OR promotion_id IS NOT NULL)
);
CREATE INDEX booking_items_booking_idx ON booking_items (booking_id, sort_order);
CREATE TRIGGER booking_items_append_only BEFORE UPDATE OR DELETE ON booking_items FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

CREATE TABLE promotion_redemptions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id       uuid NOT NULL REFERENCES promotions(id),
  booking_id         uuid NOT NULL UNIQUE REFERENCES bookings(id),
  user_id            uuid NOT NULL REFERENCES users(id),
  discount_minor     bigint NOT NULL CHECK (discount_minor > 0),
  redeemed_at        timestamptz NOT NULL DEFAULT now(),
  released_at        timestamptz          -- set when the booking is cancelled/expired; frees the usage slot
);
CREATE INDEX promotion_redemptions_live_idx ON promotion_redemptions (promotion_id, user_id) WHERE released_at IS NULL;

-- ---------------------------------------------------------------------------
-- Booking state machine, enforced in the database.
-- ---------------------------------------------------------------------------
CREATE TABLE booking_status_transitions (
  from_status        text NOT NULL,
  to_status          text NOT NULL,
  PRIMARY KEY (from_status, to_status)
);
INSERT INTO booking_status_transitions (from_status, to_status) VALUES
  ('PENDING','CONFIRMED'), ('PENDING','CANCELLED'), ('PENDING','EXPIRED'),
  ('CONFIRMED','PREPARING'), ('CONFIRMED','CANCELLED'),
  ('PREPARING','READY'), ('PREPARING','CANCELLED'),
  ('READY','IN_DELIVERY'), ('READY','ACTIVE'), ('READY','CANCELLED'),
  ('IN_DELIVERY','ACTIVE'), ('IN_DELIVERY','READY'),
  ('ACTIVE','COMPLETED'),
  ('CANCELLED','REFUNDED');

CREATE TABLE booking_status_history (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  booking_id         uuid NOT NULL REFERENCES bookings(id),
  from_status        text,
  to_status          text NOT NULL,
  changed_by         uuid REFERENCES users(id),
  reason             text,
  changed_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_status_history_booking_idx ON booking_status_history (booking_id, changed_at);
CREATE TRIGGER booking_status_history_append_only BEFORE UPDATE OR DELETE ON booking_status_history
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

CREATE OR REPLACE FUNCTION bookings_status_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' AND NEW.source = 'WEB' THEN
      RAISE EXCEPTION 'Web bookings must start as PENDING' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by)
    VALUES (NEW.id, NULL, NEW.status, current_actor_id());
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT EXISTS (SELECT 1 FROM booking_status_transitions
                   WHERE from_status = OLD.status AND to_status = NEW.status) THEN
      RAISE EXCEPTION 'Invalid booking status transition % -> %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by, reason)
    VALUES (NEW.id, OLD.status, NEW.status, current_actor_id(),
            NULLIF(current_setting('app.status_reason', true), ''));

    IF NEW.status = 'CONFIRMED' THEN NEW.confirmed_at := COALESCE(NEW.confirmed_at, now()); END IF;
    IF NEW.status <> 'PENDING' THEN NEW.hold_expires_at := NULL; END IF;

    -- Business rule 3: a cancelled/expired booking must not keep the car reserved.
    IF NEW.status IN ('CANCELLED','EXPIRED') THEN
      UPDATE vehicle_availability_blocks
         SET released_at = now(), released_by = current_actor_id()
       WHERE booking_id = NEW.id AND released_at IS NULL;
      UPDATE promotion_redemptions SET released_at = now()
       WHERE booking_id = NEW.id AND released_at IS NULL;
      IF NEW.status = 'CANCELLED' THEN NEW.cancelled_at := COALESCE(NEW.cancelled_at, now()); END IF;
    END IF;

    -- Early return frees the remainder of the block (keeps turnaround buffer).
    IF NEW.status = 'COMPLETED' AND NEW.actual_return_at IS NOT NULL THEN
      UPDATE vehicle_availability_blocks b
         SET during = tstzrange(lower(b.during),
                                GREATEST(lower(b.during) + interval '1 minute',
                                         LEAST(upper(b.during),
                                               NEW.actual_return_at + make_interval(mins => v.turnaround_minutes))))
        FROM vehicles v
       WHERE b.booking_id = NEW.id AND v.id = b.vehicle_id AND b.released_at IS NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bookings_status_guard_ins AFTER INSERT ON bookings FOR EACH ROW EXECUTE FUNCTION bookings_status_guard();
CREATE TRIGGER bookings_status_guard_upd BEFORE UPDATE OF status ON bookings FOR EACH ROW EXECUTE FUNCTION bookings_status_guard();
