import { rateLimit } from "express-rate-limit";
import { config } from "../config/env.js";
import { Forbidden } from "../shared/errors.js";

/**
 * CSRF defence for cookie-authenticated, state-changing requests.
 * Session cookies are SameSite=Lax; additionally every unsafe method must come
 * from our own frontend origin. Webhooks are exempt (they authenticate by signature).
 */
export function verifyOrigin(req, _res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.path.startsWith("/api/v1/webhooks/")) return next();

  const origin = req.get("origin") ?? originOf(req.get("referer"));
  if (!isAllowedOrigin(origin)) {
    req.log?.warn({ origin: origin ?? null, path: req.path }, "cross-site request blocked");
    throw Forbidden("Cross-site request blocked");
  }
  next();
}

// Private-network hosts a developer may open the dev server on (127.0.0.1, a phone on the same Wi-Fi, …).
const DEV_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;

/**
 * Production: only FRONTEND_URL, APP_URL and ALLOWED_ORIGINS (e.g. the www and bare
 * domain). Development also accepts plain-http loopback / private-network origins.
 */
export function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (config.allowedOrigins.includes(origin)) return true;
  if (config.isProd) return false;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && DEV_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

function originOf(url) {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

const limiterDefaults = {
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: () => config.isTest,
  handler: (_req, res) =>
    res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many requests, please slow down" } }),
};

export const apiLimiter = rateLimit({ ...limiterDefaults, windowMs: 60_000, limit: 300 });
export const authLimiter = rateLimit({ ...limiterDefaults, windowMs: 15 * 60_000, limit: 30 });
export const eventsLimiter = rateLimit({ ...limiterDefaults, windowMs: 60_000, limit: 120 });
// Creating a booking holds a car: cap it so a script cannot lock the whole fleet.
export const bookingCreateLimiter = rateLimit({ ...limiterDefaults, windowMs: 10 * 60_000, limit: 10 });
// Address search / delivery quotes call paid Google APIs.
export const mapsLimiter = rateLimit({ ...limiterDefaults, windowMs: 60_000, limit: 40 });
// Contract signing and checkout: a person does this a handful of times.
export const paymentLimiter = rateLimit({ ...limiterDefaults, windowMs: 10 * 60_000, limit: 20 });
