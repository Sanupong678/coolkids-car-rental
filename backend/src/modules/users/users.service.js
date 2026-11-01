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

const decrypt = (buf) => {
  try {
    return buf ? decryptPII(buf) : null;
  } catch {
    return null; // e.g. encrypted under a retired key: the customer types it again
  }
};

/**
 * What the customer typed on their last booking, so the next booking form starts
 * filled in. Full ID / licence numbers go to the signed-in owner only (never cached);
 * a licence that has expired is left out so it gets re-entered.
 */
export async function bookingDefaults(userId, { includeStaff = false } = {}) {
  const [{ rows: ci }, { rows: b }] = await Promise.all([
    pool.query(
      `SELECT legal_full_name, date_of_birth, country_code, id_document_type, id_document_number_enc,
              license_number_enc, license_country_code, license_expiry, address_enc, phone
         FROM customer_identities WHERE user_id = $1 AND deleted_at IS NULL
        ORDER BY is_current DESC, created_at DESC LIMIT 1`,
      [userId],
    ),
    pool.query(
      `SELECT area_of_use, stay_location, social_url, rental_purpose, contact_email
         FROM bookings WHERE user_id = $1 AND deleted_at IS NULL AND ($2 OR created_by_staff IS NULL)
        ORDER BY created_at DESC LIMIT 1`,
      [userId, includeStaff],
    ),
  ]);
  const i = ci[0];
  // pg reads DATE columns as local midnight; toISOString() would shift them a day back in Bangkok.
  const day = (d) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : "");
  let address = "";
  try {
    address = JSON.parse(decrypt(i?.address_enc) ?? "{}").line1 ?? "";
  } catch {
    address = "";
  }
  return {
    customer: i
      ? {
          fullName: i.legal_full_name, phone: i.phone, countryCode: i.country_code, idType: i.id_document_type,
          idNumber: decrypt(i.id_document_number_enc) ?? "", dateOfBirth: day(i.date_of_birth), address,
          licenseNumber: decrypt(i.license_number_enc) ?? "", licenseCountry: i.license_country_code,
          licenseExpiry: new Date(i.license_expiry) > new Date() ? day(i.license_expiry) : "",
        }
      : null,
    rental: b[0]
      ? { areaOfUse: b[0].area_of_use, stayLocation: b[0].stay_location, socialUrl: b[0].social_url,
          rentalPurpose: b[0].rental_purpose, contactEmail: b[0].contact_email }
      : null,
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
