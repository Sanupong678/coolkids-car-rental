-- Staff may take a booking back one step when a button was pressed by mistake
-- ("ย้อนสถานะ", e.g. ส่งมอบแล้ว → กำลังส่ง). Cancelled / expired bookings stay closed.
INSERT INTO booking_status_transitions (from_status, to_status) VALUES
  ('PREPARING', 'CONFIRMED'),
  ('READY', 'PREPARING'),
  ('IN_DELIVERY', 'PREPARING'),
  ('ACTIVE', 'READY'),
  ('ACTIVE', 'IN_DELIVERY'),
  ('COMPLETED', 'ACTIVE')
ON CONFLICT DO NOTHING;
