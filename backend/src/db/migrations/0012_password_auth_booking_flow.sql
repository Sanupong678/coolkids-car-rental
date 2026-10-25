-- 0012 — Password sign-in, Facebook identities, and the web booking flow
--        (details → contract → payment → delivery tracking).

-- Username/email + password credentials. One per user; OAuth-only users have none.
-- password_hash is a self-describing scrypt string: scrypt$N$r$p$salt$hash (base64url).
CREATE TABLE user_credentials (
  user_id              uuid PRIMARY KEY REFERENCES users(id),
  login                citext NOT NULL UNIQUE CHECK (length(login) BETWEEN 3 AND 254),
  password_hash        text NOT NULL CHECK (password_hash LIKE 'scrypt$%'),
  failed_attempts      integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until         timestamptz,                -- brute-force lockout
  password_changed_at  timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_identities DROP CONSTRAINT user_identities_provider_check;
ALTER TABLE user_identities ADD CONSTRAINT user_identities_provider_check CHECK (provider IN ('google', 'facebook'));

-- Delivery facts captured at booking time (Google Routes or GPS estimate) and
-- the live ETA once the car leaves. Plain columns rather than JSON so analysts
-- can model delivery time / distance directly.
ALTER TABLE bookings
  ADD COLUMN customer_country     char(2) CHECK (customer_country ~ '^[A-Z]{2}$'),  -- nationality; no PII
  ADD COLUMN delivery_distance_m  integer CHECK (delivery_distance_m >= 0),
  ADD COLUMN delivery_duration_s  integer CHECK (delivery_duration_s >= 0),
  ADD COLUMN delivery_eta_at      timestamptz,
  ADD COLUMN delivered_at         timestamptz;
CREATE INDEX bookings_country_idx ON bookings (customer_country) WHERE customer_country IS NOT NULL;

-- Delivery bookings go straight from "preparing documents" to "on the way".
INSERT INTO booking_status_transitions (from_status, to_status) VALUES ('PREPARING', 'IN_DELIVERY')
ON CONFLICT DO NOTHING;
