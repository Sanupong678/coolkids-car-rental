-- Gives the API its own database login that is NOT a superuser (coolkids is the
-- bootstrap superuser and keeps that role for backups / maintenance only).
-- coolkids_app owns the app's schemas, tables, sequences, views, functions and types,
-- so it can still run migrations, but it cannot read server files, run programs,
-- change other roles or bypass permissions. Safe to run again.
--   docker compose -f docker-compose.prod.yml exec -T db psql -U coolkids -d car_rental \
--     -v ON_ERROR_STOP=1 -v app_password="..." -f - < deploy/app-db-role.sql
SELECT format('CREATE ROLE coolkids_app LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS PASSWORD %L', :'app_password')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'coolkids_app') \gexec
SELECT format('ALTER ROLE coolkids_app LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS PASSWORD %L', :'app_password') \gexec

BEGIN;
GRANT CONNECT, CREATE, TEMPORARY ON DATABASE car_rental TO coolkids_app;
GRANT USAGE, CREATE ON SCHEMA public TO coolkids_app;

DO $$
DECLARE r record;
BEGIN
  -- schemas the app made (dw), not public
  FOR r IN SELECT nspname FROM pg_namespace WHERE nspname IN ('dw') LOOP
    EXECUTE format('ALTER SCHEMA %I OWNER TO coolkids_app', r.nspname);
  END LOOP;
  -- tables, partitioned tables, views, materialized views, foreign tables (sequences follow below)
  FOR r IN
    SELECT c.oid::regclass AS obj, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('public', 'dw') AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER %s %s OWNER TO coolkids_app',
      CASE r.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END, r.obj);
  END LOOP;
  -- sequences not owned by a table column (those follow their table)
  FOR r IN
    SELECT c.oid::regclass AS obj FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('public', 'dw') AND c.relkind = 'S'
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('a', 'i', 'e'))
  LOOP
    EXECUTE format('ALTER SEQUENCE %s OWNER TO coolkids_app', r.obj);
  END LOOP;
  -- functions / procedures written by the app (extension functions stay with the extension)
  FOR r IN
    SELECT p.oid::regprocedure AS obj, p.prokind FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname IN ('public', 'dw')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER %s %s OWNER TO coolkids_app', CASE r.prokind WHEN 'p' THEN 'PROCEDURE' WHEN 'a' THEN 'AGGREGATE' ELSE 'FUNCTION' END, r.obj);
  END LOOP;
  -- enums, domains and stand-alone composite types
  FOR r IN
    SELECT t.oid::regtype AS obj, t.typtype FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname IN ('public', 'dw') AND t.typtype IN ('e', 'd', 'c')
       AND (t.typtype <> 'c' OR (SELECT relkind FROM pg_class WHERE oid = t.typrelid) = 'c')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = t.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER %s %s OWNER TO coolkids_app', CASE r.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END, r.obj);
  END LOOP;
END $$;
COMMIT;

-- report: what is still owned by someone else in the app schemas (should be only extension objects)
SELECT 'not moved: ' || count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname IN ('public', 'dw') AND c.relowner <> 'coolkids_app'::regrole
   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('e', 'a', 'i'));
