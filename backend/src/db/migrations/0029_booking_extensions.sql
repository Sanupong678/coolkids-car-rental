-- "ใช้งานต่อ" (owner 2026-11-04): a renter keeps the car longer. The booking keeps its
-- number and simply ends later; each extension is one round here (round 2, 3, …) with
-- its own period, rent and contract, so the earlier rounds stay on record.
CREATE TABLE booking_extensions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid NOT NULL REFERENCES bookings(id),
  round         int  NOT NULL CHECK (round >= 2),
  from_at       timestamptz NOT NULL,
  to_at         timestamptz NOT NULL CHECK (to_at > from_at),
  days          int  NOT NULL CHECK (days > 0),
  rental_minor  bigint NOT NULL CHECK (rental_minor >= 0),
  contract_id   uuid REFERENCES contracts(id),
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, round)
);
