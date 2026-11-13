-- Where customers may book a car (owner 2026-11-14). Some cars come from partner fleets
-- whose free days the shop cannot see, so those are booked through the admin only:
--   web  — customers book it themselves (site / LIFF calendar → form)
--   line — it shows in the LINE OA car carousel
-- LINE only: the site shows the car with a LINE button instead of "จอง", and the LINE
-- card's "จองคันนี้" sends the shop a chat message; staff then key the booking in.
ALTER TABLE vehicles
  ADD COLUMN book_on_web  boolean NOT NULL DEFAULT true,
  ADD COLUMN book_on_line boolean NOT NULL DEFAULT true,
  ADD CONSTRAINT vehicles_booking_channel CHECK (book_on_web OR book_on_line);
