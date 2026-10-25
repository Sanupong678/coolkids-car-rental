-- 0002 — Identity, sessions, RBAC, staff.

CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              citext NOT NULL,
  full_name          text NOT NULL,
  avatar_url         text,
  -- Onboarding. Age is self-reported at a point in time, so we keep when it was
  -- reported; current age ≈ age_reported + years since age_reported_at.
  -- The authoritative date of birth is captured later in customer_identities.
  age_reported       smallint CHECK (age_reported BETWEEN 16 AND 120),
  age_reported_at    timestamptz,
  gender             text CHECK (gender IN ('male','female','non_binary','other','prefer_not_to_say')),
  onboarded_at       timestamptz,
  phone              text,
  locale             text NOT NULL DEFAULT 'en',
  status             text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','DELETED')),
  last_login_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  deleted_by         uuid REFERENCES users(id),
  -- Onboarding is all-or-nothing.
  CONSTRAINT users_onboarding_complete CHECK (
    onboarded_at IS NULL OR (age_reported IS NOT NULL AND gender IS NOT NULL AND age_reported_at IS NOT NULL)
  ),
  CONSTRAINT users_deleted_consistent CHECK ((status = 'DELETED') = (deleted_at IS NOT NULL))
);
-- Email unique among live accounts only, so an anonymised/deleted account never blocks re-signup.
CREATE UNIQUE INDEX users_email_live_uq ON users (email) WHERE deleted_at IS NULL;
CREATE INDEX users_created_at_idx ON users (created_at);
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER users_no_delete BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- External identity providers. Google today; Apple/Microsoft/email later without schema change.
CREATE TABLE user_identities (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id),
  provider           text NOT NULL CHECK (provider IN ('google')),
  provider_subject   text NOT NULL,           -- Google "sub" claim (stable account id)
  provider_email     citext,
  email_verified     boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz,
  UNIQUE (provider, provider_subject)
);
CREATE INDEX user_identities_user_idx ON user_identities (user_id);

-- Server-side sessions. Only the SHA-256 of the cookie token is stored, so a DB
-- leak does not yield usable session cookies.
CREATE TABLE sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id),
  token_hash         bytea NOT NULL UNIQUE,
  ip_address         inet,
  user_agent         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX sessions_user_active_idx ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE roles (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z_]*$'),
  name               text NOT NULL,
  description        text,
  is_system          boolean NOT NULL DEFAULT false,  -- seeded roles cannot be removed
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER roles_updated_at BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE permissions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE CHECK (code ~ '^[a-z_]+:[a-z_]+$'),  -- resource:action
  description        text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE role_permissions (
  role_id            uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id      uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
  user_id            uuid NOT NULL REFERENCES users(id),
  role_id            uuid NOT NULL REFERENCES roles(id),
  granted_by         uuid REFERENCES users(id),
  granted_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX user_roles_role_idx ON user_roles (role_id);

-- Staff profile for users who work for the company. Customers have no staff row.
-- Operational tables (deliveries, maintenance) reference staff.id.
-- (home_location_id FK is added in 0004 once locations exists.)
CREATE TABLE staff (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL UNIQUE REFERENCES users(id),
  employee_code      text NOT NULL UNIQUE,
  job_title          text,
  phone              text,
  home_location_id   uuid,
  status             text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ON_LEAVE','TERMINATED')),
  hired_at           date,
  terminated_at      date,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  deleted_by         uuid REFERENCES users(id),
  CHECK (terminated_at IS NULL OR hired_at IS NULL OR terminated_at >= hired_at)
);
CREATE TRIGGER staff_updated_at BEFORE UPDATE ON staff FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER staff_no_delete BEFORE DELETE ON staff FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- Generic idempotency store for unsafe POSTs (booking creation, payment init).
CREATE TABLE idempotency_keys (
  key                text NOT NULL,
  user_id            uuid NOT NULL REFERENCES users(id),
  request_hash       bytea NOT NULL,
  response_status    smallint,
  response_body      jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  PRIMARY KEY (user_id, key)
);
CREATE INDEX idempotency_keys_expires_idx ON idempotency_keys (expires_at);
