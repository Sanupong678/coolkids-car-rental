-- 0018 — Where to e-mail the rental contract, and default service plans.

-- LINE sign-ins have no real e-mail, so the booking form asks for one (optional).
ALTER TABLE bookings ADD COLUMN contact_email citext CHECK (contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- Every car gets the shop's standard service plan (staff can change intervals later).
-- Starting point: the car's current odometer reading and today.
INSERT INTO vehicle_maintenance (vehicle_id, maintenance_type, interval_km, interval_days, last_performed_at, last_performed_km,
                                 next_due_at, next_due_km)
SELECT v.id, p.type, p.km, p.days, now(), v.current_odometer_km,
       CASE WHEN p.days IS NOT NULL THEN now() + make_interval(days => p.days) END,
       CASE WHEN p.km IS NOT NULL THEN v.current_odometer_km + p.km END
  FROM vehicles v
 CROSS JOIN (VALUES ('OIL_CHANGE', 10000, 180), ('TIRE_ROTATION', 10000, NULL), ('BRAKE_SERVICE', 20000, NULL),
                    ('INSPECTION', NULL, 365)) AS p(type, km, days)
 WHERE v.deleted_at IS NULL
ON CONFLICT (vehicle_id, maintenance_type) DO NOTHING;
