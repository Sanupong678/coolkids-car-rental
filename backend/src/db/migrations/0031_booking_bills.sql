-- "จองเพิ่ม" (owner 2026-11-17): a customer who already booked asks for another car while
-- the first booking is open. The extra car gets its own booking (number, contract, car
-- hold) tied to the first one, so staff see them as one bill with one total.
ALTER TABLE bookings ADD COLUMN bill_booking_id uuid REFERENCES bookings(id);
CREATE INDEX bookings_bill_idx ON bookings (bill_booking_id) WHERE bill_booking_id IS NOT NULL;
