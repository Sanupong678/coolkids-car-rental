import { config } from "../../config/env.js";
import { pool } from "../../db/pool.js";
import { getSettings } from "../../shared/settings.js";
import { recordAudit } from "../audit/audit.service.js";
import { realEmail } from "./email.service.js";

// Who gets the staff e-mail for a new booking (customer details + ID photos).
// By default: every active super admin, and every back-office account that can
// open identity documents (the "ตรวจเอกสาร" page, users:read_sensitive) — the
// people who would approve it anyway. The super admin can switch accounts off
// and add other addresses (setting "notify.booking_email"); ADMIN_NOTIFY_EMAILS
// in .env is always included as a safety net.

const KEY = "notify.booking_email";

const ELIGIBLE = `
  SELECT u.id, u.full_name, u.email, bool_or(r.code = 'super_admin') AS super_admin
    FROM users u
    JOIN user_roles ur ON ur.user_id = u.id
    JOIN roles r ON r.id = ur.role_id
   WHERE u.deleted_at IS NULL AND u.status = 'ACTIVE'
     AND (r.code = 'super_admin' OR EXISTS (
           SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
            WHERE rp.role_id = r.id AND p.code = 'users:read_sensitive'))
   GROUP BY u.id
   ORDER BY bool_or(r.code = 'super_admin') DESC, u.created_at`;

async function current(db = pool) {
  const s = (await getSettings(db))[KEY] ?? {};
  return { muted: Array.isArray(s.muted) ? s.muted : [], extra: Array.isArray(s.extra) ? s.extra : [] };
}

/** The back-office view: each eligible account with its on/off switch, plus the extra addresses. */
export async function staffEmailSettings() {
  const { muted, extra } = await current();
  const { rows } = await pool.query(ELIGIBLE);
  return {
    accounts: rows.map((r) => ({
      id: r.id, fullName: r.full_name, email: realEmail(r.email) ? r.email : null, superAdmin: r.super_admin, on: !muted.includes(r.id),
    })),
    extra,
    fixed: config.adminNotifyEmails,
  };
}

export async function saveStaffEmailSettings(auth, { muted, extra }, ctx) {
  const before = await current();
  const value = { muted: [...new Set(muted)], extra: [...new Set(extra.map((e) => e.trim().toLowerCase()))] };
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_by) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, version = system_settings.version + 1, updated_at = now()`,
    [KEY, JSON.stringify(value), auth.user.id],
  );
  await recordAudit(pool, ctx, { action: "settings.booking_email_updated", entityType: "setting", entityId: KEY, before, after: value });
  return staffEmailSettings();
}

/** Addresses for the staff e-mail right now (deduplicated). */
export async function staffRecipients() {
  const { muted, extra } = await current();
  const { rows } = await pool.query(ELIGIBLE);
  const accounts = rows.filter((r) => !muted.includes(r.id) && realEmail(r.email)).map((r) => r.email.toLowerCase());
  return [...new Set([...accounts, ...extra, ...config.adminNotifyEmails.map((e) => e.toLowerCase())])];
}
