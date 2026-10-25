-- 0009 — Delivery, maintenance, staff activity, notifications, favourites, reviews.

-- ---------------------------------------------------------------------------
-- Delivery / collection
-- ---------------------------------------------------------------------------
CREATE TABLE delivery_assignments (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id             uuid NOT NULL REFERENCES bookings(id),
  staff_id               uuid NOT NULL REFERENCES staff(id),
  vehicle_id             uuid NOT NULL REFERENCES vehicles(id),
  assignment_type        text NOT NULL CHECK (assignment_type IN ('DELIVERY','COLLECTION')),  -- to customer / back from customer
  status                 text NOT NULL DEFAULT 'ASSIGNED'
                         CHECK (status IN ('ASSIGNED','VEHICLE_PICKED_UP','EN_ROUTE','ARRIVING','DELIVERED','FAILED','CANCELLED')),
  origin_location_id     uuid REFERENCES locations(id),
  destination            jsonb NOT NULL,       -- {address, lat, lng} or {location_id}
  scheduled_at           timestamptz NOT NULL,
  eta_at                 timestamptz,
  vehicle_picked_up_at   timestamptz,          -- driver took the car from the branch
  started_at             timestamptz,          -- left for the customer
  completed_at           timestamptz,          -- handed over / received
  returned_at            timestamptz,          -- car back at branch (COLLECTION)
  odometer_start_km      integer CHECK (odometer_start_km >= 0),
  odometer_end_km        integer,
  notes                  text,
  failure_reason         text,
  assigned_by            uuid REFERENCES users(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (odometer_end_km IS NULL OR odometer_end_km >= odometer_start_km),
  CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at),
  CHECK (status <> 'DELIVERED' OR completed_at IS NOT NULL)
);
-- One live assignment of each type per booking (re-assignment cancels the old one first).
CREATE UNIQUE INDEX delivery_assignments_one_live ON delivery_assignments (booking_id, assignment_type)
  WHERE status NOT IN ('FAILED','CANCELLED');
CREATE INDEX delivery_assignments_staff_idx ON delivery_assignments (staff_id, scheduled_at);
CREATE INDEX delivery_assignments_open_idx  ON delivery_assignments (scheduled_at) WHERE status NOT IN ('DELIVERED','FAILED','CANCELLED');
CREATE TRIGGER delivery_assignments_updated_at BEFORE UPDATE ON delivery_assignments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Status changes and GPS pings. High-volume → BRIN on time; partition by month when large.
CREATE TABLE delivery_tracking (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  assignment_id          uuid NOT NULL REFERENCES delivery_assignments(id),
  event_type             text NOT NULL CHECK (event_type IN ('STATUS','LOCATION')),
  status                 text,
  latitude               numeric(9,6) CHECK (latitude BETWEEN -90 AND 90),
  longitude              numeric(9,6) CHECK (longitude BETWEEN -180 AND 180),
  speed_kmh              numeric(5,1),
  heading_deg            smallint CHECK (heading_deg BETWEEN 0 AND 359),
  eta_at                 timestamptz,
  recorded_by            uuid REFERENCES staff(id),
  recorded_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (event_type <> 'STATUS' OR status IS NOT NULL),
  CHECK (event_type <> 'LOCATION' OR (latitude IS NOT NULL AND longitude IS NOT NULL))
);
CREATE INDEX delivery_tracking_assignment_idx ON delivery_tracking (assignment_id, recorded_at DESC);
CREATE INDEX delivery_tracking_time_brin ON delivery_tracking USING brin (recorded_at);
CREATE TRIGGER delivery_tracking_append_only BEFORE UPDATE OR DELETE ON delivery_tracking FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- ---------------------------------------------------------------------------
-- Maintenance
-- ---------------------------------------------------------------------------
-- Recurring maintenance plan per vehicle and type (the "schedule").
CREATE TABLE vehicle_maintenance (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id             uuid NOT NULL REFERENCES vehicles(id),
  maintenance_type       text NOT NULL CHECK (maintenance_type IN ('OIL_CHANGE','BRAKE_SERVICE','TIRE_REPLACEMENT','TIRE_ROTATION',
                                                                   'ENGINE_SERVICE','INSPECTION','CLEANING','BATTERY','REPAIR','OTHER')),
  interval_km            integer CHECK (interval_km > 0),
  interval_days          integer CHECK (interval_days > 0),
  last_performed_at      timestamptz,
  last_performed_km      integer CHECK (last_performed_km >= 0),
  next_due_at            timestamptz,
  next_due_km            integer CHECK (next_due_km >= 0),
  is_active              boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (interval_km IS NOT NULL OR interval_days IS NOT NULL),
  UNIQUE (vehicle_id, maintenance_type)
);
CREATE INDEX vehicle_maintenance_due_idx ON vehicle_maintenance (next_due_at) WHERE is_active;
CREATE TRIGGER vehicle_maintenance_updated_at BEFORE UPDATE ON vehicle_maintenance FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Individual service events (history).
CREATE TABLE maintenance_records (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id             uuid NOT NULL REFERENCES vehicles(id),
  plan_id                uuid REFERENCES vehicle_maintenance(id),
  maintenance_type       text NOT NULL CHECK (maintenance_type IN ('OIL_CHANGE','BRAKE_SERVICE','TIRE_REPLACEMENT','TIRE_ROTATION',
                                                                   'ENGINE_SERVICE','INSPECTION','CLEANING','BATTERY','REPAIR','OTHER')),
  status                 text NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED')),
  scheduled_start        timestamptz NOT NULL,
  scheduled_end          timestamptz NOT NULL,
  started_at             timestamptz,
  completed_at           timestamptz,
  odometer_km            integer CHECK (odometer_km >= 0),
  vendor                 text,
  description            text,
  labor_cost_minor       bigint NOT NULL DEFAULT 0 CHECK (labor_cost_minor >= 0),
  other_cost_minor       bigint NOT NULL DEFAULT 0 CHECK (other_cost_minor >= 0),
  currency               char(3) NOT NULL DEFAULT 'USD',
  caused_by_booking_id   uuid REFERENCES bookings(id),   -- damage repair attributable to a rental
  performed_by           uuid REFERENCES staff(id),
  created_by             uuid REFERENCES users(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz,
  deleted_by             uuid REFERENCES users(id),
  CHECK (scheduled_end > scheduled_start),
  CHECK (status <> 'COMPLETED' OR completed_at IS NOT NULL),
  CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at)
);
CREATE INDEX maintenance_records_vehicle_idx ON maintenance_records (vehicle_id, scheduled_start DESC);
CREATE INDEX maintenance_records_open_idx ON maintenance_records (status, scheduled_start) WHERE status IN ('SCHEDULED','IN_PROGRESS');
CREATE TRIGGER maintenance_records_updated_at BEFORE UPDATE ON maintenance_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER maintenance_records_no_delete BEFORE DELETE ON maintenance_records FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

ALTER TABLE vehicle_availability_blocks
  ADD CONSTRAINT vab_maintenance_fk FOREIGN KEY (maintenance_record_id) REFERENCES maintenance_records(id);

CREATE TABLE maintenance_parts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  maintenance_record_id  uuid NOT NULL REFERENCES maintenance_records(id),
  part_name              text NOT NULL,
  part_number            text,
  supplier               text,
  quantity               numeric(10,2) NOT NULL CHECK (quantity > 0),
  unit_cost_minor        bigint NOT NULL CHECK (unit_cost_minor >= 0),
  total_cost_minor       bigint GENERATED ALWAYS AS (round(quantity * unit_cost_minor)::bigint) STORED,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX maintenance_parts_record_idx ON maintenance_parts (maintenance_record_id);

-- Business rule 2: scheduled or running maintenance blocks the calendar; running
-- maintenance flips the vehicle to MAINTENANCE. Overlap with an existing booking
-- fails on the EXCLUDE constraint, forcing staff to resolve the conflict first.
CREATE OR REPLACE FUNCTION maintenance_sync_availability() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('SCHEDULED','IN_PROGRESS') THEN
    IF EXISTS (SELECT 1 FROM vehicle_availability_blocks WHERE maintenance_record_id = NEW.id) THEN
      UPDATE vehicle_availability_blocks
         SET during = tstzrange(NEW.scheduled_start, NEW.scheduled_end, '[)')
       WHERE maintenance_record_id = NEW.id AND released_at IS NULL;
    ELSE
      INSERT INTO vehicle_availability_blocks (vehicle_id, block_type, during, maintenance_record_id, reason, created_by)
      VALUES (NEW.vehicle_id, 'MAINTENANCE', tstzrange(NEW.scheduled_start, NEW.scheduled_end, '[)'),
              NEW.id, NEW.maintenance_type, current_actor_id());
    END IF;
  ELSE
    UPDATE vehicle_availability_blocks SET released_at = now(), released_by = current_actor_id()
     WHERE maintenance_record_id = NEW.id AND released_at IS NULL;
  END IF;

  IF NEW.status = 'IN_PROGRESS' THEN
    UPDATE vehicles SET status = 'MAINTENANCE' WHERE id = NEW.vehicle_id AND status = 'ACTIVE';
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'IN_PROGRESS' THEN
    UPDATE vehicles SET status = 'ACTIVE'
     WHERE id = NEW.vehicle_id AND status = 'MAINTENANCE'
       AND NOT EXISTS (SELECT 1 FROM maintenance_records m
                       WHERE m.vehicle_id = NEW.vehicle_id AND m.status = 'IN_PROGRESS' AND m.id <> NEW.id);
  END IF;

  IF NEW.status = 'COMPLETED' AND NEW.plan_id IS NOT NULL THEN
    UPDATE vehicle_maintenance p
       SET last_performed_at = NEW.completed_at,
           last_performed_km = NEW.odometer_km,
           next_due_at = CASE WHEN p.interval_days IS NOT NULL THEN NEW.completed_at + make_interval(days => p.interval_days) END,
           next_due_km = CASE WHEN p.interval_km IS NOT NULL AND NEW.odometer_km IS NOT NULL THEN NEW.odometer_km + p.interval_km END
     WHERE p.id = NEW.plan_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER maintenance_records_sync AFTER INSERT OR UPDATE OF status, scheduled_start, scheduled_end ON maintenance_records
  FOR EACH ROW EXECUTE FUNCTION maintenance_sync_availability();

-- ---------------------------------------------------------------------------
-- Staff operational activity ("who handled the car"). Complements audit_logs,
-- which records data changes; this records physical/operational actions.
-- ---------------------------------------------------------------------------
CREATE TABLE staff_activity_logs (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  staff_id               uuid NOT NULL REFERENCES staff(id),
  activity_type          text NOT NULL CHECK (activity_type IN (
                           'VEHICLE_INSPECTED','VEHICLE_CLEANED','VEHICLE_MARKED_READY','VEHICLE_PICKED_UP_FROM_BRANCH',
                           'DELIVERY_STARTED','VEHICLE_DELIVERED','VEHICLE_COLLECTED','VEHICLE_RETURNED_TO_BRANCH',
                           'VEHICLE_RECEIVED','MAINTENANCE_STARTED','MAINTENANCE_COMPLETED','MILEAGE_RECORDED','DAMAGE_REPORTED')),
  vehicle_id             uuid REFERENCES vehicles(id),
  booking_id             uuid REFERENCES bookings(id),
  delivery_assignment_id uuid REFERENCES delivery_assignments(id),
  maintenance_record_id  uuid REFERENCES maintenance_records(id),
  location_id            uuid REFERENCES locations(id),
  latitude               numeric(9,6),
  longitude              numeric(9,6),
  odometer_km            integer CHECK (odometer_km >= 0),
  notes                  text,
  metadata               jsonb NOT NULL DEFAULT '{}'::jsonb,   -- checklist results, photo media ids
  occurred_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_activity_staff_idx   ON staff_activity_logs (staff_id, occurred_at DESC);
CREATE INDEX staff_activity_vehicle_idx ON staff_activity_logs (vehicle_id, occurred_at DESC);
CREATE INDEX staff_activity_booking_idx ON staff_activity_logs (booking_id) WHERE booking_id IS NOT NULL;
CREATE TRIGGER staff_activity_append_only BEFORE UPDATE OR DELETE ON staff_activity_logs FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- ---------------------------------------------------------------------------
-- Customer engagement
-- ---------------------------------------------------------------------------
CREATE TABLE notifications (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL REFERENCES users(id),
  notification_type      text NOT NULL,       -- BOOKING_CONFIRMED, DELIVERY_EN_ROUTE, PAYMENT_FAILED, PROMOTION …
  channel                text NOT NULL DEFAULT 'IN_APP' CHECK (channel IN ('IN_APP','EMAIL','SMS','PUSH')),
  title                  text NOT NULL,
  body                   text NOT NULL,
  data                   jsonb NOT NULL DEFAULT '{}'::jsonb,
  entity_type            text,
  entity_id              uuid,
  delivery_status        text NOT NULL DEFAULT 'PENDING' CHECK (delivery_status IN ('PENDING','SENT','FAILED','SKIPPED')),
  sent_at                timestamptz,
  read_at                timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_unread_idx ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_outbound_idx ON notifications (created_at) WHERE delivery_status = 'PENDING' AND channel <> 'IN_APP';

CREATE TABLE favorites (
  user_id                uuid NOT NULL REFERENCES users(id),
  vehicle_id             uuid NOT NULL REFERENCES vehicles(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, vehicle_id)
);
CREATE INDEX favorites_vehicle_idx ON favorites (vehicle_id);

CREATE TABLE reviews (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id             uuid NOT NULL UNIQUE REFERENCES bookings(id),   -- only real renters can review, once
  user_id                uuid NOT NULL REFERENCES users(id),
  vehicle_id             uuid NOT NULL REFERENCES vehicles(id),
  rating                 smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title                  text,
  body                   text,
  status                 text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PUBLISHED','HIDDEN')),
  moderated_by           uuid REFERENCES users(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz
);
CREATE INDEX reviews_vehicle_idx ON reviews (vehicle_id, created_at DESC) WHERE status = 'PUBLISHED' AND deleted_at IS NULL;
CREATE TRIGGER reviews_updated_at BEFORE UPDATE ON reviews FOR EACH ROW EXECUTE FUNCTION set_updated_at();
