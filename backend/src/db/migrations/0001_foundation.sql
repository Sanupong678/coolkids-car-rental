-- 0001 — Foundation: extensions, shared trigger functions, actor context.
--
-- Conventions used by every migration:
--   * Primary keys are UUID (gen_random_uuid()).
--   * Money is stored as BIGINT minor units (cents) + CHAR(3) currency. Never floats.
--   * Status columns are TEXT + CHECK constraints (cheaper to evolve than PG enums).
--   * Business entities carry created_at / updated_at and, where history matters,
--     deleted_at / deleted_by (soft delete). Hard deletes are blocked by trigger.
--   * The API sets `app.actor_id` per transaction (SET LOCAL) so triggers can
--     attribute automatic history rows to the acting user.

CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- gen_random_uuid(), digest()
CREATE EXTENSION IF NOT EXISTS citext;      -- case-insensitive email
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- exclusion constraints mixing = and &&

-- Keeps updated_at honest without relying on application code.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Returns the acting user id set by the API via SET LOCAL app.actor_id, or NULL.
CREATE OR REPLACE FUNCTION current_actor_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.actor_id', true), '')::uuid
$$;

-- Attach to tables whose rows must never be physically deleted.
CREATE OR REPLACE FUNCTION prevent_hard_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Hard delete is not allowed on %; use soft delete (deleted_at)', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END $$;

-- Attach to append-only tables (audit log, history, ledger).
CREATE OR REPLACE FUNCTION prevent_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END $$;
