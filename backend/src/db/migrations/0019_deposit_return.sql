-- 0019 — Security deposit returned after the car is back (possibly minus deductions:
--        fuel, cleaning, fines). Settled deposits leave the "รอคืนมัดจำ" queue.

ALTER TABLE bookings
  ADD COLUMN deposit_returned_at      timestamptz,
  ADD COLUMN deposit_deduction_minor  bigint CHECK (deposit_deduction_minor >= 0),
  ADD COLUMN deposit_note             text CHECK (length(deposit_note) <= 500);
