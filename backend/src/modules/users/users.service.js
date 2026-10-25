import { pool, withTransaction } from "../../db/pool.js";
import { decryptPII } from "../../shared/crypto.js";
import { AppError } from "../../shared/errors.js";
import { hashPassword, passwordProblem, verifyPassword } from "../../shared/password.js";
import { recordAudit } from "../audit/audit.service.js";
import * as repo from "./users.repository.js";

/** Shape returned to the client for the signed-in user. Never includes identity documents. */
export function toMeDto(user, auth) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    avatarUrl: user.avatar_url,
    age: user.age_reported,
    gender: user.gender,
    phone: user.phone,
    locale: user.locale,
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
    needsOnboarding: !user.onboarded_at && auth.roles.length === 0, // customer profile step; staff skip it
    roles: auth.roles,
    permissions: [...auth.permissions].sort(),
    isStaff: auth.roles.length > 0,
  };
}

export async function completeOnboarding(ctx, userId, input) {
  return withTransaction(async (db) => {
    const user = await repo.completeOnboarding(db, userId, input);
    await recordAudit(db, ctx, {
      action: "user.onboarded", entityType: "user", entityId: userId, after: { age: input.age, gender: input.gender },
    });
    return user;
  }, { actorId: userId });
}

export async function updateProfile(ctx, userId, patch) {
  return withTransaction(async (db) => {
    const before = await repo.findById(db, userId);
    const user = await repo.updateProfile(db, userId, patch);
    await recordAudit(db, ctx, {
      action: "user.profile_updated", entityType: "user", entityId: userId,
      before: { full_name: before.full_name, phone: before.phone, locale: before.locale, age: before.age_reported, gender: before.gender },
      after: { full_name: user.full_name, phone: user.phone, locale: user.locale, age: user.age_reported, gender: user.gender },
    });
    return user;
  }, { actorId: userId });
}

/**
 * Account settings page: how the user signs in, plus the renter details from
 * their latest booking. ID and licence numbers are only ever shown masked.
 */
export async function accountDetails(userId) {
  const [{ rows: ids }, { rows: cred }, { rows: ci }, { rows: stats }] = await Promise.all([
    pool.query("SELECT provider, provider_email FROM user_identities WHERE user_id = $1 ORDER BY created_at", [userId]),
    pool.query("SELECT login FROM user_credentials WHERE user_id = $1", [userId]),
    pool.query(
      `SELECT legal_full_name, date_of_birth, country_code, id_document_type, id_document_number_last4,
              license_number_last4, license_country_code, license_expiry, address_enc, phone, verification_status, created_at
         FROM customer_identities WHERE user_id = $1 AND deleted_at IS NULL
        ORDER BY is_current DESC, created_at DESC LIMIT 1`,
      [userId],
    ),
    pool.query(
      `SELECT count(*)::int AS bookings, count(*) FILTER (WHERE status IN ('CONFIRMED','ACTIVE','COMPLETED'))::int AS confirmed
         FROM bookings WHERE user_id = $1`,
      [userId],
    ),
  ]);
  const i = ci[0];
  let address = null;
  if (i?.address_enc) {
    try {
      address = JSON.parse(decryptPII(i.address_enc)).line1 ?? null;
    } catch {
      address = null;
    }
  }
  return {
    signIn: {
      methods: ids.map((r) => ({ provider: r.provider, email: r.provider_email })),
      password: cred[0] ? { login: cred[0].login } : null,
    },
    renter: i
      ? {
          legalName: i.legal_full_name,
          dateOfBirth: i.date_of_birth,
          countryCode: i.country_code,
          idType: i.id_document_type,
          idLast4: i.id_document_number_last4,
          licenseLast4: i.license_number_last4,
          licenseCountry: i.license_country_code,
          licenseExpiry: i.license_expiry,
          address,
          phone: i.phone,
          verification: i.verification_status,
          updatedAt: i.created_at,
        }
      : null,
    stats: stats[0],
  };
}

/** Change the password of a username/password account. Other sessions are signed out. */
export async function changePassword(ctx, auth, { currentPassword, newPassword }) {
  const userId = auth.user.id;
  return withTransaction(async (db) => {
    const { rows } = await db.query("SELECT password_hash FROM user_credentials WHERE user_id = $1 FOR UPDATE", [userId]);
    if (!rows[0]) throw new AppError(400, "NO_PASSWORD", "บัญชีนี้เข้าสู่ระบบด้วย Google / LINE จึงไม่มีรหัสผ่านให้เปลี่ยน");
    if (!(await verifyPassword(currentPassword, rows[0].password_hash))) {
      throw new AppError(400, "WRONG_PASSWORD", "รหัสผ่านปัจจุบันไม่ถูกต้อง", { currentPassword: ["รหัสผ่านปัจจุบันไม่ถูกต้อง"] });
    }
    const problem = passwordProblem(newPassword, { email: auth.user.email });
    if (problem) throw new AppError(400, "WEAK_PASSWORD", problem, { newPassword: [problem] });
    await db.query("UPDATE user_credentials SET password_hash = $2, failed_attempts = 0, locked_until = NULL WHERE user_id = $1", [
      userId, await hashPassword(newPassword),
    ]);
    await db.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL AND id <> $2", [userId, auth.sessionId]);
    await recordAudit(db, ctx, { action: "user.password_changed", entityType: "user", entityId: userId });
    return { changed: true };
  }, { actorId: userId });
}
