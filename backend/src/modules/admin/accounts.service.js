import { randomBytes } from "node:crypto";
import { pool, withTransaction } from "../../db/pool.js";
import { AppError, BadRequest, Conflict, Forbidden, NotFound } from "../../shared/errors.js";
import { hashPassword, passwordProblem } from "../../shared/password.js";
import { recordAudit } from "../audit/audit.service.js";
import { ADMIN_PAGES, PAGE_KEYS, pagesFromPermissions, permissionsFor } from "../rbac/pages.js";

// Back-office accounts, managed by the super admin: sub-admins sign in with a
// username + password and/or their Gmail (Google sign-in links to the account by
// its verified email) and see only the pages they were given. Each sub-admin
// has a role of their own carrying exactly those pages' permissions, so the
// API enforces the same limits the menu shows.

const SUPER = "super_admin";

/** Pages the signed-in staff member may open (for /me and the back-office menu). */
export async function adminPagesFor(auth) {
  if (!auth?.roles?.length) return [];
  if (auth.roles.includes(SUPER)) return [...PAGE_KEYS, "admins"];
  const { rows } = await pool.query("SELECT page FROM admin_page_access WHERE user_id = $1", [auth.user.id]);
  return rows.length ? PAGE_KEYS.filter((k) => rows.some((r) => r.page === k)) : pagesFromPermissions(auth.permissions);
}

const ACCOUNT_SELECT = `
  SELECT u.id, u.email, u.full_name, u.phone, u.status, u.last_login_at, u.created_at, c.login,
         COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles,
         COALESCE((SELECT array_agg(a.page ORDER BY a.page) FROM admin_page_access a WHERE a.user_id = u.id), '{}') AS pages,
         EXISTS (SELECT 1 FROM user_identities i WHERE i.user_id = u.id AND i.provider = 'google') AS google
    FROM users u
    JOIN user_roles ur ON ur.user_id = u.id
    JOIN roles r ON r.id = ur.role_id
    LEFT JOIN user_credentials c ON c.user_id = u.id`;

const accountDto = (r) => ({
  id: r.id, fullName: r.full_name, email: r.email, login: r.login, phone: r.phone, status: r.status,
  roles: r.roles, pages: r.roles.includes(SUPER) ? [...PAGE_KEYS] : r.pages, superAdmin: r.roles.includes(SUPER),
  google: r.google, gmail: r.email.endsWith(STAFF_DOMAIN) ? null : r.email, lastLoginAt: r.last_login_at, createdAt: r.created_at,
});

export async function listAccounts() {
  const { rows } = await pool.query(`${ACCOUNT_SELECT} WHERE u.deleted_at IS NULL GROUP BY u.id, c.login ORDER BY u.created_at`);
  return { accounts: rows.map(accountDto), pages: Object.fromEntries(PAGE_KEYS.map((k) => [k, ADMIN_PAGES[k].label])) };
}

async function getAccount(db, userId) {
  const { rows } = await db.query(`${ACCOUNT_SELECT} WHERE u.id = $1 AND u.deleted_at IS NULL GROUP BY u.id, c.login`, [userId]);
  if (!rows[0]) throw NotFound("Account");
  return rows[0];
}

/** The account's own role (staff_xxxxxxxx) gets exactly the permissions of its pages. */
async function setPages(db, userId, pages, actorId) {
  const { rows: own } = await db.query(
    `SELECT r.id FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = $1 AND r.code LIKE 'staff\\_%' AND NOT r.is_system`,
    [userId],
  );
  let roleId = own[0]?.id;
  if (!roleId) {
    const { rows } = await db.query(
      "INSERT INTO roles (code, name, description, is_system) VALUES ($1, $2, $3, false) RETURNING id",
      [`staff_${randomBytes(4).toString("hex").replace(/\d/g, (d) => "abcdefghij"[d])}`, "แอดมินย่อย", `Pages chosen by the super admin for ${userId}`],
    );
    roleId = rows[0].id;
    await db.query("INSERT INTO user_roles (user_id, role_id, granted_by) VALUES ($1, $2, $3)", [userId, roleId, actorId]);
  }
  await db.query("DELETE FROM role_permissions WHERE role_id = $1", [roleId]);
  await db.query(
    "INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE code = ANY($2::text[])",
    [roleId, permissionsFor(pages)],
  );
  await db.query("DELETE FROM admin_page_access WHERE user_id = $1", [userId]);
  await db.query(
    "INSERT INTO admin_page_access (user_id, page, granted_by) SELECT $1, unnest($2::text[]), $3",
    [userId, pages, actorId],
  );
}

const STAFF_DOMAIN = "@staff.coolkids.local"; // placeholder email of a username-only account
const loginEmail = (login) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(login) ? login.toLowerCase() : `${login.toLowerCase()}${STAFF_DOMAIN}`);

async function assertEmailFree(db, email, exceptUserId = null) {
  const { rows } = await db.query("SELECT 1 FROM users WHERE email = $1 AND deleted_at IS NULL AND id IS DISTINCT FROM $2", [email, exceptUserId]);
  if (rows[0]) throw Conflict("EMAIL_IN_USE", "อีเมลนี้มีบัญชีอยู่ในระบบแล้ว");
}

/** `email` (Gmail) lets the account sign in with Google; login + password is the username sign-in. Either or both. */
export async function createAccount(auth, { fullName, login, password, email, phone, pages }, ctx) {
  const userEmail = email ?? loginEmail(login);
  if (password) {
    const weak = passwordProblem(password, { email: userEmail });
    if (weak) throw new AppError(400, "WEAK_PASSWORD", weak, { password: [weak] });
  }
  if (!pages.length) throw BadRequest("เลือกอย่างน้อย 1 หน้า");
  const hash = password ? await hashPassword(password) : null;
  return withTransaction(
    async (db) => {
      if (login) {
        const { rows: taken } = await db.query(
          "SELECT 1 FROM user_credentials WHERE login = $1 UNION ALL SELECT 1 FROM users WHERE email = $2 AND deleted_at IS NULL",
          [login, loginEmail(login)],
        );
        if (taken[0]) throw Conflict("LOGIN_TAKEN", "ชื่อผู้ใช้นี้ถูกใช้แล้ว");
      }
      await assertEmailFree(db, userEmail);
      const { rows } = await db.query(
        // Staff skip the customer onboarding step (age / gender), so the profile is complete from the start.
        "INSERT INTO users (email, full_name, phone) VALUES ($1, $2, $3) RETURNING id",
        [userEmail, fullName, phone ?? null],
      );
      const userId = rows[0].id;
      if (login) await db.query("INSERT INTO user_credentials (user_id, login, password_hash) VALUES ($1, $2, $3)", [userId, login, hash]);
      // A staff profile lets them record odometers, take delivery jobs and appear on the driver map.
      await db.query(
        `INSERT INTO staff (user_id, employee_code, job_title, phone, status, hired_at)
         VALUES ($1, $2, 'แอดมิน', $3, 'ACTIVE', (now() AT TIME ZONE 'Asia/Bangkok')::date)`,
        [userId, `ADM-${randomBytes(3).toString("hex").toUpperCase()}`, phone ?? null],
      );
      await setPages(db, userId, pages, auth.user.id);
      await recordAudit(db, ctx, { action: "staff.account_created", entityType: "user", entityId: userId, after: { login, email, pages } });
      return accountDto(await getAccount(db, userId));
    },
    { actorId: auth.user.id },
  );
}

export async function updateAccount(auth, userId, { fullName, phone, email, pages, password, active }, ctx) {
  if (userId === auth.user.id) throw Forbidden("แก้ไขสิทธิ์ของบัญชีตัวเองไม่ได้");
  const hash = password ? await hashPassword(password) : null;
  if (password) {
    const weak = passwordProblem(password);
    if (weak) throw new AppError(400, "WEAK_PASSWORD", weak, { password: [weak] });
  }
  return withTransaction(
    async (db) => {
      const before = await getAccount(db, userId);
      if (before.roles.includes(SUPER)) throw Forbidden("แก้ไขบัญชี Super Admin จากหน้านี้ไม่ได้");
      if (fullName !== undefined || phone !== undefined) {
        await db.query("UPDATE users SET full_name = COALESCE($2, full_name), phone = COALESCE($3, phone) WHERE id = $1", [userId, fullName ?? null, phone ?? null]);
      }
      if (email !== undefined && email !== before.email) {
        await assertEmailFree(db, email, userId);
        await db.query("UPDATE users SET email = $2 WHERE id = $1", [userId, email]);
        // The old Google account must not keep signing in; the new Gmail links on its first sign-in.
        await db.query("DELETE FROM user_identities WHERE user_id = $1 AND provider = 'google'", [userId]);
      }
      if (pages) {
        if (!pages.length) throw BadRequest("เลือกอย่างน้อย 1 หน้า");
        await setPages(db, userId, pages, auth.user.id);
      }
      if (hash) {
        const { rowCount } = await db.query(
          "UPDATE user_credentials SET password_hash = $2, password_changed_at = now(), failed_attempts = 0, locked_until = NULL WHERE user_id = $1",
          [userId, hash],
        );
        if (!rowCount) throw BadRequest("บัญชีนี้เข้าสู่ระบบด้วย Google ไม่มีรหัสผ่านให้ตั้ง");
      }
      if (active !== undefined) {
        // Suspended accounts are signed out everywhere on their next request.
        await db.query("UPDATE users SET status = $2 WHERE id = $1", [userId, active ? "ACTIVE" : "SUSPENDED"]);
      }
      if (hash || active === false || (email !== undefined && email !== before.email)) await db.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
      await recordAudit(db, ctx, {
        action: "staff.account_updated", entityType: "user", entityId: userId,
        before: { pages: before.pages, status: before.status, email: before.email }, after: { pages, active, email, passwordReset: Boolean(hash) },
      });
      return accountDto(await getAccount(db, userId));
    },
    { actorId: auth.user.id },
  );
}
