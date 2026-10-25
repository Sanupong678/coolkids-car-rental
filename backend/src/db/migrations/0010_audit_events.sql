-- 0010 — Immutable audit log, website analytics events, transactional outbox.

CREATE TABLE audit_logs (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id      uuid REFERENCES users(id),     -- NULL = system/job/webhook
  actor_roles        text[] NOT NULL DEFAULT '{}',  -- roles held at the time of the action
  action             text NOT NULL CHECK (action ~ '^[a-z_]+\.[a-z_]+$'),  -- e.g. vehicle.price_changed
  entity_type        text NOT NULL,
  entity_id          text NOT NULL,
  previous_state     jsonb,
  new_state          jsonb,
  ip_address         inet,
  user_agent         text,
  request_id         text,
  occurred_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_logs_actor_idx  ON audit_logs (actor_user_id, occurred_at DESC);
CREATE INDEX audit_logs_time_brin  ON audit_logs USING brin (occurred_at);
-- Immutable: no UPDATE/DELETE, and TRUNCATE is blocked too.
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION prevent_mutation();

-- Clickstream / product analytics. Privacy by design: no names, emails or
-- free-text PII; user_id is kept for joins but anonymised when a user is erased.
-- IP is never stored; country/device are derived at ingest.
CREATE TABLE analytics_events (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_name         text NOT NULL CHECK (event_name IN (
                       'PAGE_VIEW','VEHICLE_VIEW','CATEGORY_VIEW','PROMOTION_VIEW','PROMOTION_CLICK','SEARCH',
                       'BOOKING_STARTED','BOOKING_STEP_COMPLETED','BOOKING_COMPLETED','PAYMENT_COMPLETED',
                       'FAVORITE_VEHICLE','UNFAVORITE_VEHICLE','CONTRACT_VIEW','CONTRACT_DOWNLOAD','SIGN_IN','SIGN_UP')),
  occurred_at        timestamptz NOT NULL,
  received_at        timestamptz NOT NULL DEFAULT now(),
  anonymous_id       text NOT NULL,            -- first-party random id (cookie), not a fingerprint
  session_key        text NOT NULL,
  user_id            uuid REFERENCES users(id),
  page_path          text,
  referrer_host      text,
  utm                jsonb,                    -- {source, medium, campaign}
  device_type        text CHECK (device_type IN ('desktop','tablet','mobile','other')),
  country_code       char(2),
  vehicle_id         uuid,
  category_id        uuid,
  promotion_id       uuid,
  booking_id         uuid,
  properties         jsonb NOT NULL DEFAULT '{}'::jsonb   -- validated per event_name in the API
);
CREATE INDEX analytics_events_time_brin ON analytics_events USING brin (occurred_at);
CREATE INDEX analytics_events_name_time_idx ON analytics_events (event_name, occurred_at);
CREATE INDEX analytics_events_session_idx ON analytics_events (session_key, occurred_at);

-- Transactional outbox: domain events are written in the same transaction as the
-- state change, then relayed to notifications, websockets, the warehouse loader
-- and (later) a message bus. Guarantees no event is lost or emitted for a rolled-back change.
CREATE TABLE outbox_events (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  aggregate_type     text NOT NULL,       -- booking, payment, delivery …
  aggregate_id       uuid NOT NULL,
  event_type         text NOT NULL,       -- booking.confirmed, delivery.status_changed …
  payload            jsonb NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  published_at       timestamptz,
  attempts           integer NOT NULL DEFAULT 0,
  last_error         text
);
CREATE INDEX outbox_unpublished_idx ON outbox_events (id) WHERE published_at IS NULL;
