-- 0016 — Delivery fee per vehicle, set by staff on the fleet form.
-- NULL = use the shop default (system_settings delivery.*).

ALTER TABLE vehicles
  ADD COLUMN delivery_free_km        numeric(5,1) CHECK (delivery_free_km >= 0),
  ADD COLUMN delivery_per_km_minor   integer CHECK (delivery_per_km_minor >= 0),
  ADD COLUMN delivery_min_fee_minor  integer CHECK (delivery_min_fee_minor >= 0);
