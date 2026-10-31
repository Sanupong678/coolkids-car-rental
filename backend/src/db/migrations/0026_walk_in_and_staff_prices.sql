-- Owner decision 2026-10-31: urgent bookings (walk-in, phone) start right away, so a
-- booking no longer needs 2 hours' notice (customers and staff alike).
UPDATE system_settings SET value = '0'::jsonb, version = version + 1, updated_at = now()
 WHERE key = 'booking.min_lead_time_hours';

-- Staff may change a booking's prices and details after it is made. booking_items stays
-- append-only: a change is a new ADJUSTMENT line (either sign) saying which line it
-- corrects (`adjusts`); a staff discount ("ส่วนลดจากแอดมิน") adjusts DISCOUNT. What a
-- line comes to = its own rows + the adjustments pointing at it.
ALTER TABLE booking_items ADD COLUMN adjusts text
  CHECK (adjusts IN ('RENTAL','DELIVERY_FEE','RETURN_FEE','DISCOUNT','TAX'));
ALTER TABLE booking_items DROP CONSTRAINT booking_items_item_type_check;
ALTER TABLE booking_items ADD CONSTRAINT booking_items_item_type_check
  CHECK (item_type IN ('RENTAL','EXTRA_HOURS','ADD_ON','INSURANCE','PICKUP_FEE',
                       'RETURN_FEE','ONE_WAY_FEE','DELIVERY_FEE','DISCOUNT','TAX','ADJUSTMENT'));
ALTER TABLE booking_items ADD CONSTRAINT booking_items_adjustment_target
  CHECK ((item_type = 'ADJUSTMENT') = (adjusts IS NOT NULL));
ALTER TABLE booking_items DROP CONSTRAINT booking_items_check;
ALTER TABLE booking_items ADD CONSTRAINT booking_items_check
  CHECK (amount_minor = 0 OR item_type = 'ADJUSTMENT' OR (item_type = 'DISCOUNT') = (amount_minor < 0));
