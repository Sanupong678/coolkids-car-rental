import { pool } from "../../db/pool.js";

export async function createSession(db, { userId, tokenHash, ip, userAgent, ttlDays }) {
  const { rows } = await db.query(
    `INSERT INTO sessions (user_id, token_hash, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(days => $5))
     RETURNING id, expires_at`,
    [userId, tokenHash, ip, userAgent?.slice(0, 500) ?? null, ttlDays],
  );
  return rows[0];
}

/**
 * Resolve a live session to its user plus effective roles/permissions in one round trip.
 * Suspended/deleted users resolve to nothing, which logs them out everywhere.
 */
export async function findActiveSession(tokenHash) {
  const { rows } = await pool.query(
    `SELECT s.id AS session_id, s.last_seen_at,
            u.id, u.email, u.full_name, u.avatar_url, u.age_reported, u.gender, u.onboarded_at,
            u.phone, u.locale, u.status, u.created_at, u.last_login_at,
            COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles,
            COALESCE(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND u.status = 'ACTIVE'
      GROUP BY s.id, u.id`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

export async function touchSession(sessionId) {
  await pool.query("UPDATE sessions SET last_seen_at = now() WHERE id = $1", [sessionId]);
}

export async function revokeSession(sessionId) {
  await pool.query("UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [sessionId]);
}

export async function revokeAllForUser(db, userId) {
  await db.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
}
