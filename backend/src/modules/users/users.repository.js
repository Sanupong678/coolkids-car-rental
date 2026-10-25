import { pool } from "../../db/pool.js";

const PUBLIC_COLUMNS = `id, email, full_name, avatar_url, age_reported, gender, onboarded_at, phone, locale,
                        status, created_at, last_login_at`;

export async function findById(db, id) {
  const { rows } = await (db ?? pool).query(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function findByIdentity(db, provider, subject) {
  const { rows } = await db.query(
    `SELECT u.id, u.status FROM user_identities i JOIN users u ON u.id = i.user_id
      WHERE i.provider = $1 AND i.provider_subject = $2`,
    [provider, subject],
  );
  return rows[0] ?? null;
}

export async function findLiveByEmail(db, email) {
  const { rows } = await db.query("SELECT id, status FROM users WHERE email = $1 AND deleted_at IS NULL", [email]);
  return rows[0] ?? null;
}

export async function insertUser(db, { email, fullName, avatarUrl }) {
  const { rows } = await db.query(
    `INSERT INTO users (email, full_name, avatar_url, last_login_at) VALUES ($1, $2, $3, now())
     RETURNING ${PUBLIC_COLUMNS}`,
    [email, fullName, avatarUrl],
  );
  return rows[0];
}

export async function insertIdentity(db, { userId, provider, subject, email, emailVerified }) {
  await db.query(
    `INSERT INTO user_identities (user_id, provider, provider_subject, provider_email, email_verified, last_used_at)
     VALUES ($1, $2, $3, $4, $5, now())`,
    [userId, provider, subject, email, emailVerified],
  );
}

/** Refresh profile data that Google owns (name, picture) on each login. */
export async function recordLogin(db, { userId, provider, subject, fullName, avatarUrl }) {
  await db.query(
    "UPDATE users SET last_login_at = now(), full_name = $2, avatar_url = COALESCE($3, avatar_url) WHERE id = $1",
    [userId, fullName, avatarUrl],
  );
  await db.query(
    "UPDATE user_identities SET last_used_at = now() WHERE provider = $1 AND provider_subject = $2",
    [provider, subject],
  );
}

export async function completeOnboarding(db, userId, { age, gender }) {
  const { rows } = await db.query(
    `UPDATE users SET age_reported = $2, gender = $3, age_reported_at = now(), onboarded_at = COALESCE(onboarded_at, now())
      WHERE id = $1 RETURNING ${PUBLIC_COLUMNS}`,
    [userId, age, gender],
  );
  return rows[0];
}

export async function updateProfile(db, userId, patch) {
  const { rows } = await db.query(
    `UPDATE users SET full_name = COALESCE($2, full_name), phone = COALESCE($3, phone), locale = COALESCE($4, locale),
            age_reported = COALESCE($5::int, age_reported), age_reported_at = CASE WHEN $5::int IS NULL THEN age_reported_at ELSE now() END,
            gender = COALESCE($6::text, gender)
      WHERE id = $1 RETURNING ${PUBLIC_COLUMNS}`,
    [userId, patch.fullName ?? null, patch.phone ?? null, patch.locale ?? null, patch.age ?? null, patch.gender ?? null],
  );
  return rows[0];
}

export async function grantRoleByCode(db, userId, roleCode, grantedBy = null) {
  await db.query(
    `INSERT INTO user_roles (user_id, role_id, granted_by)
     SELECT $1, id, $3 FROM roles WHERE code = $2 ON CONFLICT DO NOTHING`,
    [userId, roleCode, grantedBy],
  );
}
