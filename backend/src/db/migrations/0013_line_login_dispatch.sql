-- 0013 — LINE sign-in, live driver positions for the dispatch map.

ALTER TABLE user_identities DROP CONSTRAINT user_identities_provider_check;
ALTER TABLE user_identities ADD CONSTRAINT user_identities_provider_check CHECK (provider IN ('google', 'facebook', 'line'));

-- Latest known position of each staff member (one row, overwritten by the
-- driver's phone/browser). Trip history stays in delivery_tracking.
CREATE TABLE staff_locations (
  staff_id      uuid PRIMARY KEY REFERENCES staff(id),
  latitude      numeric(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude     numeric(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m    integer CHECK (accuracy_m >= 0),
  recorded_at   timestamptz NOT NULL DEFAULT now()
);
