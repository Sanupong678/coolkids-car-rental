-- Staff get an e-mail 30 minutes before a car is due back (owner 2026-11-01); this
-- marks the booking as reminded so the e-mail goes once. A new return time clears it.
ALTER TABLE bookings ADD COLUMN return_reminded_at timestamptz;
CREATE INDEX bookings_return_due_idx ON bookings (return_at) WHERE status = 'ACTIVE' AND return_reminded_at IS NULL;
