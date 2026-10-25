-- 0011 — Analytical star schema in its own `dw` schema.
--
-- OLTP tables (public) are normalised for correctness; `dw` is denormalised for
-- BI/ML. An incremental ELT job (Phase 9) loads it from OLTP + outbox using
-- watermarks in dw.etl_runs. Because it is a separate schema with surrogate
-- keys, it can be lifted to BigQuery/Snowflake/ClickHouse without app changes.
-- Dimensions that change over time (vehicle price/category, customer segment)
-- are SCD Type 2 so historical facts keep the attributes valid at the time.

CREATE SCHEMA IF NOT EXISTS dw;

CREATE TABLE dw.etl_runs (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_name           text NOT NULL,
  started_at         timestamptz NOT NULL DEFAULT now(),
  finished_at        timestamptz,
  watermark_from     timestamptz,
  watermark_to       timestamptz,
  rows_loaded        integer,
  status             text NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','SUCCEEDED','FAILED')),
  error              text
);

-- ---------------- Dimensions ----------------
CREATE TABLE dw.dim_date (
  date_key           integer PRIMARY KEY,           -- yyyymmdd
  full_date          date NOT NULL UNIQUE,
  day_of_week        smallint NOT NULL,             -- ISO 1=Mon
  day_name           text NOT NULL,
  is_weekend         boolean NOT NULL,
  week_of_year       smallint NOT NULL,
  month              smallint NOT NULL,
  month_name         text NOT NULL,
  quarter            smallint NOT NULL,
  year               smallint NOT NULL,
  is_holiday         boolean NOT NULL DEFAULT false,
  holiday_name       text
);
INSERT INTO dw.dim_date
SELECT to_char(d, 'YYYYMMDD')::int, d, extract(isodow FROM d), trim(to_char(d, 'Day')),
       extract(isodow FROM d) IN (6,7), extract(week FROM d), extract(month FROM d),
       trim(to_char(d, 'Month')), extract(quarter FROM d), extract(year FROM d), false, NULL
FROM generate_series('2020-01-01'::date, '2040-12-31'::date, interval '1 day') AS g(d);

CREATE TABLE dw.dim_customer (
  customer_key       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id            uuid NOT NULL,
  age_band           text,          -- '18-24','25-34',… — never raw DOB
  gender             text,
  country_code       char(2),
  signup_date_key    integer REFERENCES dw.dim_date(date_key),
  acquisition_channel text,
  segment            text,          -- NEW / RETURNING / HIGH_VALUE / INACTIVE
  valid_from         timestamptz NOT NULL,
  valid_to           timestamptz,
  is_current         boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX dim_customer_current_uq ON dw.dim_customer (user_id) WHERE is_current;

CREATE TABLE dw.dim_category (
  category_key       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category_id        uuid NOT NULL UNIQUE,
  slug               text NOT NULL,
  name               text NOT NULL
);

CREATE TABLE dw.dim_vehicle (
  vehicle_key        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehicle_id         uuid NOT NULL,
  category_key       bigint REFERENCES dw.dim_category(category_key),
  brand              text NOT NULL,
  model              text NOT NULL,
  model_year         smallint NOT NULL,
  transmission       text,
  fuel_type          text,
  drive_type         text,
  seats              smallint,
  daily_rate_minor   bigint,
  acquisition_cost_minor bigint,
  home_location_id   uuid,
  valid_from         timestamptz NOT NULL,
  valid_to           timestamptz,
  is_current         boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX dim_vehicle_current_uq ON dw.dim_vehicle (vehicle_id) WHERE is_current;

CREATE TABLE dw.dim_location (
  location_key       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  location_id        uuid NOT NULL UNIQUE,
  code               text NOT NULL,
  name               text NOT NULL,
  city               text,
  country_code       char(2),
  location_type      text
);

CREATE TABLE dw.dim_promotion (
  promotion_key      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  promotion_id       uuid NOT NULL UNIQUE,
  name               text NOT NULL,
  discount_type      text NOT NULL,
  discount_value     bigint NOT NULL,
  starts_at          timestamptz NOT NULL,
  ends_at            timestamptz NOT NULL
);

CREATE TABLE dw.dim_staff (
  staff_key          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  staff_id           uuid NOT NULL UNIQUE,
  employee_code      text NOT NULL,
  primary_role       text,
  home_location_key  bigint REFERENCES dw.dim_location(location_key)
);

-- ---------------- Facts ----------------
-- Grain: one row per booking (updated as the booking progresses → accumulating snapshot).
CREATE TABLE dw.fact_bookings (
  booking_id             uuid PRIMARY KEY,
  booking_number         text NOT NULL,
  customer_key           bigint REFERENCES dw.dim_customer(customer_key),
  vehicle_key            bigint REFERENCES dw.dim_vehicle(vehicle_key),
  category_key           bigint REFERENCES dw.dim_category(category_key),
  pickup_location_key    bigint REFERENCES dw.dim_location(location_key),
  return_location_key    bigint REFERENCES dw.dim_location(location_key),
  promotion_key          bigint REFERENCES dw.dim_promotion(promotion_key),
  booked_date_key        integer REFERENCES dw.dim_date(date_key),
  pickup_date_key        integer REFERENCES dw.dim_date(date_key),
  return_date_key        integer REFERENCES dw.dim_date(date_key),
  lead_time_days         integer,          -- pickup - booked: demand forecasting feature
  rental_days            integer NOT NULL,
  status                 text NOT NULL,
  is_completed           boolean NOT NULL,
  is_cancelled           boolean NOT NULL,
  is_repeat_customer     boolean,
  subtotal_minor         bigint NOT NULL,
  discount_minor         bigint NOT NULL,
  tax_minor              bigint NOT NULL,
  total_minor            bigint NOT NULL,
  refunded_minor         bigint NOT NULL DEFAULT 0,
  net_revenue_minor      bigint NOT NULL,  -- total - tax - refunds
  distance_km            integer,
  currency               char(3) NOT NULL,
  loaded_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fact_bookings_pickup_date_idx ON dw.fact_bookings (pickup_date_key);
CREATE INDEX fact_bookings_vehicle_idx ON dw.fact_bookings (vehicle_key);

-- Grain: one row per payment transaction.
CREATE TABLE dw.fact_payments (
  payment_transaction_id uuid PRIMARY KEY,
  booking_id             uuid NOT NULL,
  customer_key           bigint REFERENCES dw.dim_customer(customer_key),
  date_key               integer REFERENCES dw.dim_date(date_key),
  provider               text NOT NULL,
  transaction_type       text NOT NULL,
  status                 text NOT NULL,
  amount_minor           bigint NOT NULL,   -- refunds negative
  currency               char(3) NOT NULL
);

-- Grain: one row per vehicle per day — the basis for utilisation.
CREATE TABLE dw.fact_vehicle_usage (
  vehicle_key            bigint NOT NULL REFERENCES dw.dim_vehicle(vehicle_key),
  date_key               integer NOT NULL REFERENCES dw.dim_date(date_key),
  is_in_fleet            boolean NOT NULL,   -- owned & not archived that day
  available_hours        numeric(5,2) NOT NULL,  -- 24 minus maintenance/unavailable hours
  booked_hours           numeric(5,2) NOT NULL,
  maintenance_hours      numeric(5,2) NOT NULL,
  revenue_minor          bigint NOT NULL,        -- booking revenue allocated pro-rata to the day
  distance_km            integer,
  PRIMARY KEY (vehicle_key, date_key)
);

-- Grain: one row per maintenance record.
CREATE TABLE dw.fact_maintenance (
  maintenance_record_id  uuid PRIMARY KEY,
  vehicle_key            bigint REFERENCES dw.dim_vehicle(vehicle_key),
  staff_key              bigint REFERENCES dw.dim_staff(staff_key),
  start_date_key         integer REFERENCES dw.dim_date(date_key),
  maintenance_type       text NOT NULL,
  downtime_hours         numeric(8,2),
  odometer_km            integer,
  labor_cost_minor       bigint NOT NULL,
  parts_cost_minor       bigint NOT NULL,
  total_cost_minor       bigint NOT NULL,
  is_unplanned           boolean NOT NULL
);

-- Grain: promotion funnel per promotion per day per stage.
CREATE TABLE dw.fact_promotion_events (
  promotion_key          bigint NOT NULL REFERENCES dw.dim_promotion(promotion_key),
  date_key               integer NOT NULL REFERENCES dw.dim_date(date_key),
  event_type             text NOT NULL,
  event_count            integer NOT NULL,
  unique_sessions        integer NOT NULL,
  PRIMARY KEY (promotion_key, date_key, event_type)
);

-- Grain: website events aggregated per day / event / page / device.
CREATE TABLE dw.fact_website_events (
  date_key               integer NOT NULL REFERENCES dw.dim_date(date_key),
  event_name             text NOT NULL,
  page_path              text NOT NULL DEFAULT '',
  device_type            text NOT NULL DEFAULT 'other',
  event_count            integer NOT NULL,
  unique_sessions        integer NOT NULL,
  unique_users           integer NOT NULL,
  PRIMARY KEY (date_key, event_name, page_path, device_type)
);
