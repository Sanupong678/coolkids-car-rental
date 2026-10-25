import { withTransaction } from "../../db/pool.js";
import { AppError, Conflict } from "../../shared/errors.js";
import { DUMMY_HASH, hashPassword, passwordProblem, verifyPassword } from "../../shared/password.js";
import { recordAudit } from "../audit/audit.service.js";
import * as users from "../users/users.repository.js";
import { openSession } from "./auth.service.js";

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

const invalid = () => new AppError(401, "INVALID_CREDENTIALS", "Incorrect username or password");

/** Username/email + password sign-in with per-account lockout after repeated failures. */
export async function login({ login, password }, ctx) {
  return withTransaction(async (db) => {
    const { rows } = await db.query(
      `SELECT c.user_id, c.password_hash, c.failed_attempts, c.locked_until, u.status
         FROM user_credentials c JOIN users u ON u.id = c.user_id
        WHERE c.login = $1 AND u.deleted_at IS NULL
        FOR UPDATE OF c`,
      [login],
    );
    const cred = rows[0];
    if (!cred) {
      await verifyPassword(password, DUMMY_HASH); // equalise timing
      throw invalid();
    }
    if (cred.locked_until && new Date(cred.locked_until) > new Date()) {
      throw new AppError(429, "ACCOUNT_LOCKED", `Too many attempts. Try again in ${LOCK_MINUTES} minutes.`);
    }
    if (!(await verifyPassword(password, cred.password_hash))) {
      const failed = cred.failed_attempts + 1;
      const lock = failed >= MAX_FAILED;
      await db.query(
        `UPDATE user_credentials SET failed_attempts = $2,
                locked_until = CASE WHEN $3 THEN now() + make_interval(mins => $4) END
          WHERE user_id = $1`,
        [cred.user_id, lock ? 0 : failed, lock, LOCK_MINUTES],
      );
      await recordAudit(db, ctx, {
        action: lock ? "auth.account_locked" : "auth.login_failed", entityType: "user", entityId: cred.user_id, after: { failed },
      });
      // The UPDATE must survive the error, so commit it by returning a marker instead of throwing here.
      return { error: invalid() };
    }
    if (cred.status !== "ACTIVE") throw new AppError(403, "ACCOUNT_DISABLED", "This account is not active");

    await db.query("UPDATE user_credentials SET failed_attempts = 0, locked_until = NULL WHERE user_id = $1", [cred.user_id]);
    await db.query("UPDATE users SET last_login_at = now() WHERE id = $1", [cred.user_id]);
    return openSession(db, { userId: cred.user_id, ctx, provider: "password", isNewUser: false });
  }).then((result) => {
    if (result.error) throw result.error;
    return result;
  });
}

/** Email sign-up. The email doubles as the login. */
export async function register({ fullName, email, phone, password }, ctx) {
  const weak = passwordProblem(password, { email });
  if (weak) throw new AppError(400, "WEAK_PASSWORD", weak, { password: [weak] });
  const passwordHash = await hashPassword(password);
  return withTransaction(async (db) => {
    if (await users.findLiveByEmail(db, email)) {
      throw Conflict("EMAIL_IN_USE", "This email already has an account. Please sign in instead.");
    }
    const user = await users.insertUser(db, { email, fullName, avatarUrl: null });
    if (phone) await db.query("UPDATE users SET phone = $2 WHERE id = $1", [user.id, phone]);
    await db.query("INSERT INTO user_credentials (user_id, login, password_hash) VALUES ($1, $2, $3)", [
      user.id, email, passwordHash,
    ]);
    return openSession(db, { userId: user.id, ctx, provider: "password", isNewUser: true });
  });
}
