import { config } from "../config/env.js";
import { findActiveSession, revokeSession, touchSession } from "../modules/auth/session.repository.js";
import { sha256 } from "../shared/crypto.js";
import { Forbidden, Unauthorized, AppError } from "../shared/errors.js";

export const SESSION_COOKIE = "sid";
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
// Sessions die after this long without activity (a left-open tab or a stolen cookie
// stops working). Back-office accounts get the shorter limit.
export const STAFF_IDLE_MS = config.STAFF_IDLE_HOURS * 60 * 60 * 1000;
export const CUSTOMER_IDLE_MS = config.CUSTOMER_IDLE_HOURS * 60 * 60 * 1000;

/**
 * Resolves the session cookie (if any) into `req.auth`. Never rejects —
 * route-level guards below decide whether auth is required. A cookie that no
 * longer maps to a live session is cleared and flagged so the guards answer
 * SESSION_EXPIRED and the frontend asks the user to sign in again.
 */
export async function authenticate(req, res, next) {
  req.auth = null;
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();
  const expire = () => {
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    req.sessionExpired = true;
    next();
  };
  if (token.length > 128) return expire();

  const row = await findActiveSession(sha256(token));
  if (!row) return expire();

  const { session_id, last_seen_at, roles, permissions, ...user } = row;
  const idleMs = roles.length ? STAFF_IDLE_MS : CUSTOMER_IDLE_MS;
  if (Date.now() - new Date(last_seen_at).getTime() > idleMs) {
    await revokeSession(session_id);
    return expire();
  }
  req.auth = { sessionId: session_id, user, roles, permissions: new Set(permissions) };

  if (Date.now() - new Date(last_seen_at).getTime() > TOUCH_INTERVAL_MS) {
    touchSession(session_id).catch((err) => req.log?.warn({ err }, "session touch failed"));
  }
  next();
}

const unauthenticated = (req) =>
  req.sessionExpired ? new AppError(401, "SESSION_EXPIRED", "Your session has expired, please sign in again") : Unauthorized();

export function requireAuth(req, _res, next) {
  if (!req.auth) throw unauthenticated(req);
  next();
}

/** Blocks customer actions until the mandatory onboarding (age, gender) is done. Staff are exempt. */
export function requireOnboarded(req, _res, next) {
  if (!req.auth) throw unauthenticated(req);
  if (!req.auth.user.onboarded_at && !isStaff(req.auth)) {
    throw new AppError(403, "ONBOARDING_REQUIRED", "Please complete your profile to continue");
  }
  next();
}

/** Route guard: the user must hold every listed permission. */
export const requirePermission = (...required) => (req, _res, next) => {
  if (!req.auth) throw unauthenticated(req);
  if (!required.every((p) => req.auth.permissions.has(p))) throw Forbidden();
  next();
};

/** Route guard: the user must hold at least one of the listed permissions. */
export const requireAnyPermission = (...anyOf) => (req, _res, next) => {
  if (!req.auth) throw unauthenticated(req);
  if (!anyOf.some((p) => req.auth.permissions.has(p))) throw Forbidden();
  next();
};

export const isStaff = (auth) => Boolean(auth?.roles?.length);
