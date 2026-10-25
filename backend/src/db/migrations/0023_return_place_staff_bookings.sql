-- Where the car goes back: the branch (free), the delivery address, or another
-- address the shop drives to and collects it from (priced by distance, like delivery).
ALTER TABLE bookings
  ADD COLUMN return_type text NOT NULL DEFAULT 'BRANCH'
    CHECK (return_type IN ('BRANCH', 'SAME_AS_DELIVERY', 'ADDRESS')),
  ADD COLUMN return_address jsonb,          -- {address, placeId, lat, lng, notes, source} unless BRANCH
  ADD COLUMN return_distance_m integer,
  ADD COLUMN return_duration_s integer,
  ADD CONSTRAINT bookings_return_addr CHECK (return_type = 'BRANCH' OR return_address IS NOT NULL),
  ADD CONSTRAINT bookings_return_same CHECK (return_type <> 'SAME_AS_DELIVERY' OR fulfillment_type = 'DELIVERY');

-- Who keyed the booking in: NULL = the customer; a staff user = booked on the customer's behalf.
ALTER TABLE bookings ADD COLUMN created_by_staff uuid REFERENCES users(id);
