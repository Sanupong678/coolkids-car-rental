-- 0017 — Back-office operations board:
--   • booking numbers COOL-YYMMDD-NNN (Bangkok date + running number of that day)
--   • fleet numbers (#1, #2 …) staff use to name cars
--   • vehicle documents with expiry dates (พ.ร.บ., road tax, insurance, lease contract …)
--     so the dashboard can remind staff before they lapse

-- ---------------------------------------------------------------- booking numbers
CREATE TABLE booking_number_counters (
  day   date PRIMARY KEY,
  last  integer NOT NULL CHECK (last > 0)
);

CREATE OR REPLACE FUNCTION next_booking_number() RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  d date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  n integer;
BEGIN
  INSERT INTO booking_number_counters (day, last) VALUES (d, 1)
  ON CONFLICT (day) DO UPDATE SET last = booking_number_counters.last + 1
  RETURNING last INTO n;
  RETURN 'COOL-' || to_char(d, 'YYMMDD') || '-' || lpad(n::text, 3, '0');
END $$;

ALTER TABLE bookings ALTER COLUMN booking_number SET DEFAULT next_booking_number();

-- ---------------------------------------------------------------- fleet numbers
ALTER TABLE vehicles ADD COLUMN fleet_no integer CHECK (fleet_no > 0);
CREATE UNIQUE INDEX vehicles_fleet_no_uq ON vehicles (fleet_no) WHERE fleet_no IS NOT NULL AND deleted_at IS NULL;
UPDATE vehicles v SET fleet_no = x.n
  FROM (SELECT id, row_number() OVER (ORDER BY created_at, slug) AS n FROM vehicles WHERE deleted_at IS NULL) x
 WHERE v.id = x.id;

-- ---------------------------------------------------------------- vehicle documents
CREATE TABLE vehicle_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id    uuid NOT NULL REFERENCES vehicles(id),
  doc_type      text NOT NULL CHECK (doc_type IN ('COMPULSORY_INSURANCE','ROAD_TAX','INSURANCE','LEASE_CONTRACT','REGISTRATION','INSPECTION','OTHER')),
  title         text,                       -- free label for OTHER (or a policy name)
  reference     text,                       -- policy / contract number
  expires_on    date NOT NULL,
  notes         text,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,                -- renewed / replaced documents are soft-deleted
  CHECK (length(title) <= 120 AND length(reference) <= 120 AND length(notes) <= 1000)
);
CREATE INDEX vehicle_documents_due_idx ON vehicle_documents (expires_on) WHERE deleted_at IS NULL;
CREATE TRIGGER vehicle_documents_updated_at BEFORE UPDATE ON vehicle_documents FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER vehicle_documents_no_delete BEFORE DELETE ON vehicle_documents FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();
