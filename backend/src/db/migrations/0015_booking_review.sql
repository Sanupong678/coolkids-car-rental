-- 0015 — LINE booking flow: the customer sends details and documents, staff
--        review them, and only then is the reservation fee (โอน = จอง) paid.
--   DRAFT → SUBMITTED → APPROVED (pay) | CHANGES_REQUESTED → SUBMITTED …
-- The booking status stays PENDING (car held) until the fee is paid.

ALTER TABLE bookings
  ADD COLUMN review_status          text CHECK (review_status IN ('DRAFT','SUBMITTED','CHANGES_REQUESTED','APPROVED')),
  ADD COLUMN review_note            text,
  ADD COLUMN submitted_at           timestamptz,
  ADD COLUMN approved_at            timestamptz,
  ADD COLUMN approved_by            uuid REFERENCES users(id),
  ADD COLUMN amount_due_now_minor   bigint CHECK (amount_due_now_minor > 0),   -- reservation fee; the rest is paid at pick-up
  ADD COLUMN area_of_use            text CHECK (length(area_of_use) <= 120),   -- สถานที่ใช้รถ
  ADD COLUMN stay_location          text CHECK (length(stay_location) <= 300), -- ที่พักปัจจุบัน / โลเคชั่น
  ADD COLUMN social_url             text CHECK (length(social_url) <= 300),    -- Facebook / Instagram
  ADD COLUMN rental_purpose         text CHECK (rental_purpose IN ('TRAVEL','REPLACEMENT'));
CREATE INDEX bookings_review_idx ON bookings (submitted_at) WHERE status = 'PENDING' AND review_status = 'SUBMITTED';

-- Extra photos that are not part of the renter's identity record: the second
-- driver's ID and licence, and a reference (flight ticket, hotel booking,
-- repair order …). One live photo per kind; replaced photos are soft-deleted.
CREATE TABLE booking_attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   uuid NOT NULL REFERENCES bookings(id),
  kind         text NOT NULL CHECK (kind IN ('driver2_id','driver2_license','reference')),
  media_id     uuid NOT NULL REFERENCES media(id),
  uploaded_by  uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE UNIQUE INDEX booking_attachments_live_uq ON booking_attachments (booking_id, kind) WHERE deleted_at IS NULL;
CREATE TRIGGER booking_attachments_no_delete BEFORE DELETE ON booking_attachments FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();
