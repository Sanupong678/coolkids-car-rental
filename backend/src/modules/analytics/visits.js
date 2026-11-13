import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { isStaff } from "../../middleware/auth.js";
import { eventsLimiter } from "../../middleware/security.js";
import { validate } from "../../middleware/validate.js";

// Website visitors for the dashboard's "D/M/Y" counter (owner 2026-11-14). The site sends
// one PAGE_VIEW per browser session with a random first-party id kept in localStorage;
// no IP, name or fingerprint is stored (analytics_events, migration 0010). Staff and the
// back office are not counted. Visitors = distinct ids in the Bangkok day / month / year.

const TZ = "Asia/Bangkok";
const visit = z.object({
  anonymousId: z.uuid(),
  sessionKey: z.uuid(),
  path: z.string().max(300).regex(/^\//).transform((p) => p.split(/[?#]/)[0].slice(0, 200)),
});
const device = (ua = "") => (/iPad|Tablet/i.test(ua) ? "tablet" : /Mobi|Android|iPhone/i.test(ua) ? "mobile" : ua ? "desktop" : "other");

export async function recordVisit(auth, { anonymousId, sessionKey, path }, userAgent) {
  if (isStaff(auth) || path.startsWith("/admin")) return false;
  await pool.query(
    `INSERT INTO analytics_events (event_name, occurred_at, anonymous_id, session_key, user_id, page_path, device_type)
     VALUES ('PAGE_VIEW', now(), $1, $2, $3, $4, $5)`,
    [anonymousId, sessionKey, auth?.user.id ?? null, path, device(userAgent)],
  );
  return true;
}

/** Distinct visitors so far today, this month and this year (Bangkok calendar). */
export async function visitorCounts() {
  const { rows } = await pool.query(
    `WITH t AS (SELECT now() AT TIME ZONE $1 AS local)
     SELECT count(DISTINCT e.anonymous_id) FILTER (WHERE e.occurred_at >= date_trunc('day',   t.local) AT TIME ZONE $1)::int AS day,
            count(DISTINCT e.anonymous_id) FILTER (WHERE e.occurred_at >= date_trunc('month', t.local) AT TIME ZONE $1)::int AS month,
            count(DISTINCT e.anonymous_id)::int AS year
       FROM t LEFT JOIN analytics_events e
         ON e.event_name = 'PAGE_VIEW' AND e.occurred_at >= date_trunc('year', t.local) AT TIME ZONE $1
      GROUP BY t.local`,
    [TZ],
  );
  return rows[0];
}

/** POST /api/v1/visits — public, rate-limited. */
export function visitRoutes() {
  const router = Router();
  router.post("/visits", eventsLimiter, validate({ body: visit }), async (req, res) => {
    await recordVisit(req.auth, req.valid.body, req.get("user-agent"));
    res.status(204).end();
  });
  return router;
}
