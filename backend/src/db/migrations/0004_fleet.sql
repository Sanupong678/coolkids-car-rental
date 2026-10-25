-- 0004 — Locations, categories, vehicles, vehicle media, features, mileage,
--        and the availability ledger that prevents double booking.

CREATE TABLE locations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]{2,20}$'),
  name               text NOT NULL,
  location_type      text NOT NULL CHECK (location_type IN ('HEADQUARTERS','BRANCH','AIRPORT','PICKUP_POINT')),
  address_line1      text NOT NULL,
  address_line2      text,
  city               text NOT NULL,
  region             text,
  postal_code        text,
  country_code       char(2) NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  latitude           numeric(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude          numeric(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  timezone           text NOT NULL DEFAULT 'UTC',   -- IANA zone; rental days/hours are computed in it
  phone              text,
  email              citext,
  -- {"mon":[["08:00","20:00"]], ..., "holidays":[{"date":"2026-12-25","closed":true}]}
  opening_hours      jsonb NOT NULL DEFAULT '{}'::jsonb,
  services           text[] NOT NULL DEFAULT '{}',  -- PICKUP, RETURN, DELIVERY, AFTER_HOURS_DROP, EV_CHARGING
  pickup_fee_minor   bigint NOT NULL DEFAULT 0 CHECK (pickup_fee_minor >= 0),
  return_fee_minor   bigint NOT NULL DEFAULT 0 CHECK (return_fee_minor >= 0),
  is_active          boolean NOT NULL DEFAULT true,
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  deleted_by         uuid REFERENCES users(id)
);
CREATE TRIGGER locations_updated_at BEFORE UPDATE ON locations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER locations_no_delete BEFORE DELETE ON locations FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

ALTER TABLE staff ADD CONSTRAINT staff_home_location_fk FOREIGN KEY (home_location_id) REFERENCES locations(id);

CREATE TABLE vehicle_categories (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug               text NOT NULL CHECK (slug ~ '^[a-z0-9-]+$'),
  name               text NOT NULL,
  description        text,
  image_media_id     uuid REFERENCES media(id),
  sort_order         integer NOT NULL DEFAULT 0,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  deleted_by         uuid REFERENCES users(id)
);
CREATE UNIQUE INDEX vehicle_categories_slug_live_uq ON vehicle_categories (slug) WHERE deleted_at IS NULL;
CREATE TRIGGER vehicle_categories_updated_at BEFORE UPDATE ON vehicle_categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER vehicle_categories_no_delete BEFORE DELETE ON vehicle_categories FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

CREATE TABLE vehicles (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id              uuid NOT NULL REFERENCES vehicle_categories(id),
  slug                     text NOT NULL CHECK (slug ~ '^[a-z0-9-]+$'),
  brand                    text NOT NULL,
  model                    text NOT NULL,
  trim                     text,
  model_year               smallint NOT NULL CHECK (model_year BETWEEN 1950 AND 2100),
  vin                      text CHECK (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  license_plate            text NOT NULL,
  color                    text,
  description              text,
  -- Specs
  transmission             text NOT NULL CHECK (transmission IN ('AUTOMATIC','MANUAL')),
  fuel_type                text NOT NULL CHECK (fuel_type IN ('PETROL','DIESEL','HYBRID','PLUG_IN_HYBRID','ELECTRIC')),
  drive_type               text NOT NULL CHECK (drive_type IN ('FWD','RWD','AWD','4WD')),
  seats                    smallint NOT NULL CHECK (seats BETWEEN 1 AND 20),
  doors                    smallint CHECK (doors BETWEEN 1 AND 6),
  luggage_liters           integer CHECK (luggage_liters >= 0),
  engine_displacement_cc   integer CHECK (engine_displacement_cc > 0),
  power_hp                 integer CHECK (power_hp > 0),
  torque_nm                integer CHECK (torque_nm > 0),
  battery_kwh              numeric(6,2) CHECK (battery_kwh > 0),
  range_km                 integer CHECK (range_km > 0),
  fuel_economy_l_100km     numeric(4,1) CHECK (fuel_economy_l_100km > 0),
  length_mm                integer CHECK (length_mm > 0),
  width_mm                 integer CHECK (width_mm > 0),
  height_mm                integer CHECK (height_mm > 0),
  wheelbase_mm             integer CHECK (wheelbase_mm > 0),
  -- Pricing (base; promotions are applied by the pricing engine)
  currency                 char(3) NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  daily_rate_minor         bigint NOT NULL CHECK (daily_rate_minor > 0),
  hourly_rate_minor        bigint CHECK (hourly_rate_minor > 0),  -- for partial extra hours; NULL → charge a day
  deposit_minor            bigint NOT NULL DEFAULT 0 CHECK (deposit_minor >= 0),
  min_rental_days          smallint NOT NULL DEFAULT 1 CHECK (min_rental_days >= 1),
  max_rental_days          smallint CHECK (max_rental_days IS NULL OR max_rental_days >= min_rental_days),
  min_driver_age           smallint NOT NULL DEFAULT 21 CHECK (min_driver_age BETWEEN 16 AND 99),
  turnaround_minutes       integer NOT NULL DEFAULT 120 CHECK (turnaround_minutes >= 0), -- cleaning/inspection gap after each rental
  -- Operations
  home_location_id         uuid NOT NULL REFERENCES locations(id),
  current_location_id      uuid REFERENCES locations(id),
  current_odometer_km      integer NOT NULL DEFAULT 0 CHECK (current_odometer_km >= 0),
  service_interval_km      integer CHECK (service_interval_km > 0),
  service_interval_days    integer CHECK (service_interval_days > 0),
  -- Coarse operational state. Date-level availability lives in vehicle_availability_blocks.
  status                   text NOT NULL DEFAULT 'DRAFT'
                           CHECK (status IN ('DRAFT','ACTIVE','MAINTENANCE','OUT_OF_SERVICE','ARCHIVED')),
  is_featured              boolean NOT NULL DEFAULT false,
  -- Finance (ROI analytics)
  acquisition_cost_minor   bigint CHECK (acquisition_cost_minor >= 0),
  acquired_at              date,
  disposed_at              date,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid REFERENCES users(id),
  updated_by               uuid REFERENCES users(id),
  deleted_at               timestamptz,
  deleted_by               uuid REFERENCES users(id),
  CONSTRAINT vehicles_archived_consistent CHECK (deleted_at IS NULL OR status = 'ARCHIVED')
);
CREATE UNIQUE INDEX vehicles_slug_live_uq  ON vehicles (slug) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX vehicles_plate_live_uq ON vehicles (upper(license_plate)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX vehicles_vin_uq        ON vehicles (vin) WHERE vin IS NOT NULL;
-- Listing filters: category + status are almost always present; the rest are selective enough via bitmap scans.
CREATE INDEX vehicles_listing_idx  ON vehicles (category_id, daily_rate_minor) WHERE status = 'ACTIVE' AND deleted_at IS NULL;
CREATE INDEX vehicles_brand_model_idx ON vehicles (lower(brand), lower(model)) WHERE deleted_at IS NULL;
CREATE INDEX vehicles_location_idx ON vehicles (home_location_id) WHERE deleted_at IS NULL;
CREATE TRIGGER vehicles_updated_at BEFORE UPDATE ON vehicles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER vehicles_no_delete BEFORE DELETE ON vehicles FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- Price history is first-class data for dynamic pricing / elasticity analysis,
-- so it is captured by trigger rather than reconstructed from audit JSON.
CREATE TABLE vehicle_price_history (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehicle_id         uuid NOT NULL REFERENCES vehicles(id),
  daily_rate_minor   bigint NOT NULL,
  hourly_rate_minor  bigint,
  deposit_minor      bigint NOT NULL,
  currency           char(3) NOT NULL,
  effective_from     timestamptz NOT NULL DEFAULT now(),
  changed_by         uuid REFERENCES users(id)
);
CREATE INDEX vehicle_price_history_vehicle_idx ON vehicle_price_history (vehicle_id, effective_from DESC);
CREATE TRIGGER vehicle_price_history_append_only BEFORE UPDATE OR DELETE ON vehicle_price_history
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

CREATE OR REPLACE FUNCTION record_vehicle_price() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.daily_rate_minor IS DISTINCT FROM OLD.daily_rate_minor
     OR NEW.hourly_rate_minor IS DISTINCT FROM OLD.hourly_rate_minor
     OR NEW.deposit_minor IS DISTINCT FROM OLD.deposit_minor THEN
    INSERT INTO vehicle_price_history (vehicle_id, daily_rate_minor, hourly_rate_minor, deposit_minor, currency, changed_by)
    VALUES (NEW.id, NEW.daily_rate_minor, NEW.hourly_rate_minor, NEW.deposit_minor, NEW.currency, current_actor_id());
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vehicles_price_history AFTER INSERT OR UPDATE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION record_vehicle_price();

CREATE TABLE vehicle_images (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id         uuid NOT NULL REFERENCES vehicles(id),
  media_id           uuid NOT NULL REFERENCES media(id),
  role               text NOT NULL DEFAULT 'GALLERY' CHECK (role IN ('PRIMARY','GALLERY','SPIN_FRAME','INTERIOR','DETAIL')),
  spin_frame_index   smallint CHECK (spin_frame_index >= 0),   -- for image-sequence 360° viewers
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  CHECK ((role = 'SPIN_FRAME') = (spin_frame_index IS NOT NULL)),
  UNIQUE (vehicle_id, media_id)
);
CREATE UNIQUE INDEX vehicle_images_one_primary ON vehicle_images (vehicle_id) WHERE role = 'PRIMARY' AND deleted_at IS NULL;
CREATE INDEX vehicle_images_vehicle_idx ON vehicle_images (vehicle_id, role, sort_order) WHERE deleted_at IS NULL;

CREATE TABLE vehicle_3d_assets (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id         uuid NOT NULL REFERENCES vehicles(id),
  media_id           uuid NOT NULL REFERENCES media(id),
  format             text NOT NULL CHECK (format IN ('GLB','GLTF','USDZ')),
  poster_media_id    uuid REFERENCES media(id),   -- shown until the model has streamed in
  draco_compressed   boolean NOT NULL DEFAULT true,
  triangle_count     integer CHECK (triangle_count > 0),
  is_default         boolean NOT NULL DEFAULT false,
  viewer_config      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- camera orbit, exposure, environment map
  created_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);
CREATE UNIQUE INDEX vehicle_3d_one_default ON vehicle_3d_assets (vehicle_id) WHERE is_default AND deleted_at IS NULL;

-- Feature catalogue + assignment, so features are filterable and consistent.
CREATE TABLE features (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9_]+$'),
  name               text NOT NULL,
  feature_group      text NOT NULL CHECK (feature_group IN ('SAFETY','INTERIOR','EXTERIOR','TECHNOLOGY','COMFORT','PERFORMANCE')),
  icon               text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vehicle_features (
  vehicle_id         uuid NOT NULL REFERENCES vehicles(id),
  feature_id         uuid NOT NULL REFERENCES features(id),
  detail             text,                       -- e.g. "12.3-inch", "Harman Kardon"
  PRIMARY KEY (vehicle_id, feature_id)
);
CREATE INDEX vehicle_features_feature_idx ON vehicle_features (feature_id);

-- Odometer log. Every pickup/return/service/manual reading is a row.
-- (booking_id FK is added in 0006.)
CREATE TABLE vehicle_mileage (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id         uuid NOT NULL REFERENCES vehicles(id),
  booking_id         uuid,
  reading_km         integer NOT NULL CHECK (reading_km >= 0),
  reading_type       text NOT NULL CHECK (reading_type IN ('PICKUP','RETURN','SERVICE','INSPECTION','MANUAL','CORRECTION')),
  recorded_by        uuid REFERENCES staff(id),
  recorded_at        timestamptz NOT NULL DEFAULT now(),
  notes              text
);
CREATE INDEX vehicle_mileage_vehicle_idx ON vehicle_mileage (vehicle_id, recorded_at DESC);
CREATE INDEX vehicle_mileage_booking_idx ON vehicle_mileage (booking_id) WHERE booking_id IS NOT NULL;

-- Odometers only go up. A CORRECTION reading may go down (typo fix) and is audited.
CREATE OR REPLACE FUNCTION apply_mileage_reading() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE current_km integer;
BEGIN
  SELECT current_odometer_km INTO current_km FROM vehicles WHERE id = NEW.vehicle_id FOR UPDATE;
  IF NEW.reading_type <> 'CORRECTION' AND NEW.reading_km < current_km THEN
    RAISE EXCEPTION 'Odometer reading % km is below current % km', NEW.reading_km, current_km
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE vehicles SET current_odometer_km = NEW.reading_km WHERE id = NEW.vehicle_id;
  RETURN NEW;
END $$;
CREATE TRIGGER vehicle_mileage_apply BEFORE INSERT ON vehicle_mileage FOR EACH ROW EXECUTE FUNCTION apply_mileage_reading();
CREATE TRIGGER vehicle_mileage_append_only BEFORE UPDATE OR DELETE ON vehicle_mileage FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- ---------------------------------------------------------------------------
-- Availability ledger — the single source of truth for "is this car free?"
--
-- Every reason a vehicle is unavailable (booking, maintenance, admin hold) is a
-- row here with a time range. The EXCLUDE constraint makes it physically
-- impossible for two live blocks on the same vehicle to overlap, regardless of
-- how many API instances race. Booking ranges include the turnaround buffer.
-- Released blocks (cancelled/expired bookings, finished maintenance) stay for history.
-- ---------------------------------------------------------------------------
CREATE TABLE vehicle_availability_blocks (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id             uuid NOT NULL REFERENCES vehicles(id),
  block_type             text NOT NULL CHECK (block_type IN ('BOOKING','MAINTENANCE','UNAVAILABLE')),
  during                 tstzrange NOT NULL CHECK (NOT isempty(during) AND lower_inc(during) AND NOT upper_inc(during)
                                                   AND NOT lower_inf(during) AND NOT upper_inf(during)),
  booking_id             uuid UNIQUE,     -- FK added in 0006
  maintenance_record_id  uuid UNIQUE,     -- FK added in 0009
  reason                 text,
  created_by             uuid REFERENCES users(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  released_at            timestamptz,
  released_by            uuid REFERENCES users(id),
  CHECK ((block_type = 'BOOKING') = (booking_id IS NOT NULL)),
  CHECK ((block_type = 'MAINTENANCE') = (maintenance_record_id IS NOT NULL)),
  CONSTRAINT vehicle_availability_no_overlap
    EXCLUDE USING gist (vehicle_id WITH =, during WITH &&) WHERE (released_at IS NULL)
);
-- (The EXCLUDE constraint's GiST index also serves availability range lookups.)
CREATE TRIGGER vehicle_availability_no_delete BEFORE DELETE ON vehicle_availability_blocks
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();
