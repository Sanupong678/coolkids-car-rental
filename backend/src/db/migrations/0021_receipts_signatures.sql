-- 0021 — Booking slip (ใบจอง) and receipts (ใบเสร็จรับเงิน).
--   • every captured payment gets one receipt, numbered RE + YYMMDD + -NNN
--     (Bangkok date, running number of that day)
--   • the slip and receipts can be signed by the shop and by the customer

CREATE TABLE receipt_number_counters (
  day   date PRIMARY KEY,
  last  integer NOT NULL CHECK (last > 0)
);

CREATE OR REPLACE FUNCTION next_receipt_number() RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  d date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  n integer;
BEGIN
  INSERT INTO receipt_number_counters (day, last) VALUES (d, 1)
  ON CONFLICT (day) DO UPDATE SET last = receipt_number_counters.last + 1
  RETURNING last INTO n;
  RETURN 'RE' || to_char(d, 'YYMMDD') || '-' || lpad(n::text, 3, '0');
END $$;

CREATE TABLE receipts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number  text NOT NULL UNIQUE DEFAULT next_receipt_number(),
  booking_id      uuid NOT NULL REFERENCES bookings(id),
  payment_id      uuid NOT NULL UNIQUE REFERENCES payments(id),
  amount_minor    bigint NOT NULL CHECK (amount_minor > 0),
  currency        char(3) NOT NULL,
  issued_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX receipts_booking_idx ON receipts (booking_id, issued_at);
CREATE TRIGGER receipts_no_delete BEFORE DELETE ON receipts FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

CREATE TABLE document_signatures (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings(id),
  doc_kind    text NOT NULL CHECK (doc_kind IN ('BOOKING','RECEIPT')),
  receipt_id  uuid REFERENCES receipts(id),
  party       text NOT NULL CHECK (party IN ('SHOP','CUSTOMER')),
  media_id    uuid NOT NULL REFERENCES media(id),
  signed_by   uuid REFERENCES users(id),
  signed_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((doc_kind = 'RECEIPT') = (receipt_id IS NOT NULL)),
  UNIQUE NULLS NOT DISTINCT (booking_id, doc_kind, receipt_id, party)
);
