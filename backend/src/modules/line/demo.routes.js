import { Router } from "express";
import { z } from "zod";
import { config } from "../../config/env.js";
import { pool, withTransaction } from "../../db/pool.js";
import { requireAuth, SESSION_COOKIE } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { BadRequest, NotFound } from "../../shared/errors.js";
import { distanceMeters } from "../../shared/geo.js";
import { auditContext } from "../audit/audit.service.js";
import { openSession } from "../auth/auth.service.js";
import * as dispatch from "../admin/dispatch.service.js";
import * as operations from "../admin/operations.service.js";
import * as review from "../admin/review.service.js";
import { LINE_TYPES, lineText } from "../notifications/line.service.js";
import * as slips from "../payments/slips.service.js";
import { repliesFor } from "./bot.service.js";

// /api/v1/dev/line — powers the LINE look-alike demo page (/line-demo) on a
// developer machine, before a real LINE Official Account is connected:
//   • the chat bot's real replies to the rich-menu keywords (no LINE API call);
//   • the messages the customer would receive on LINE (same text as the push);
//   • a demo customer "signed in with LINE" the way LIFF would do it;
//   • staff actions (approve, confirm the slip, statuses, car near / arrived)
//     run as the seeded admin, so one browser can play both sides.
// Never mounted in production (see app.js).

const DEMO_EMAIL = "line-demo@coolkids.local";
const DEMO_LINE_ID = "Udemo000000000000000000000000000";

const cookie = (expires) => ({ httpOnly: true, secure: false, sameSite: "lax", path: "/", expires });

/** The seeded back-office admin, as an `auth` object the services accept. */
async function adminAuth() {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.full_name,
            COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles,
            COALESCE(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
       FROM user_credentials c JOIN users u ON u.id = c.user_id
       LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id LEFT JOIN permissions p ON p.id = rp.permission_id
      WHERE c.login = $1 GROUP BY u.id`,
    [process.env.ADMIN_LOGIN || "admin"],
  );
  if (!rows[0]) throw BadRequest("Run `npm run db:seed:admin` first: the demo plays staff with that account");
  const { roles, permissions, ...user } = rows[0];
  return { user, roles, permissions: new Set(permissions) };
}

async function latestBooking(userId) {
  const { rows } = await pool.query(
    `SELECT b.id, b.booking_number, b.status, b.review_status, b.fulfillment_type, b.delivery_address,
            (SELECT s.id FROM payment_slips s WHERE s.booking_id = b.id AND s.status = 'NEEDS_REVIEW' LIMIT 1) AS slip_id
       FROM bookings b WHERE b.user_id = $1 AND b.deleted_at IS NULL AND b.status NOT IN ('EXPIRED','CANCELLED')
      ORDER BY b.created_at DESC LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

/** What the staff panel can do next for this booking. */
function actionsFor(b) {
  if (!b) return [];
  if (b.status === "PENDING") {
    if (b.review_status === "SUBMITTED") return ["approve", "request_changes"];
    if (b.slip_id) return ["confirm_slip"];
    return [];
  }
  const next = (operations.NEXT[b.status] ?? []).filter((s) => s !== "CANCELLED")
    .filter((s) => (b.fulfillment_type === "DELIVERY" ? s !== "READY" : s !== "IN_DELIVERY"));
  const extra = b.status === "IN_DELIVERY" && b.delivery_address?.lat != null ? ["near", "arrived"] : [];
  return [...extra, ...next.map((s) => `status:${s}`)];
}

export function lineDemoRoutes() {
  const router = Router();
  router.use((_req, res, next) => (res.set("Cache-Control", "no-store"), next()));

  // "Open the LIFF app": sign in as the demo LINE customer (already onboarded).
  router.post("/login", async (req, res) => {
    const session = await withTransaction(async (db) => {
      let { rows } = await db.query("SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL", [DEMO_EMAIL]);
      let isNewUser = false;
      if (!rows[0]) {
        ({ rows } = await db.query(
          `INSERT INTO users (email, full_name, age_reported, age_reported_at, gender, onboarded_at)
           VALUES ($1, 'ลูกค้าทดสอบ LINE', 30, now(), 'prefer_not_to_say', now()) RETURNING id`,
          [DEMO_EMAIL],
        ));
        await db.query(
          `INSERT INTO user_identities (user_id, provider, provider_subject, provider_email, email_verified, last_used_at)
           VALUES ($1, 'line', $2, $3, false, now())`,
          [rows[0].id, DEMO_LINE_ID, DEMO_EMAIL],
        );
        isNewUser = true;
      }
      return openSession(db, { userId: rows[0].id, ctx: auditContext(req), provider: "line", isNewUser });
    });
    res.cookie(SESSION_COOKIE, session.token, cookie(new Date(session.expiresAt)));
    res.status(204).end();
  });

  // A message typed in the chat or sent by a rich-menu button → the bot's real reply.
  router.post("/message", validate({ body: z.object({ text: z.string().trim().min(1).max(300) }) }), async (req, res) => {
    const replies = await repliesFor({ type: "message", message: { type: "text", text: req.valid.body.text } });
    res.json({ data: { replies: replies ?? [] } });
  });

  // What the customer would have received on LINE (pushes), oldest first.
  router.get("/inbox", requireAuth, async (req, res) => {
    const { rows } = await pool.query(
      `SELECT n.id, n.notification_type, n.title, n.body, n.created_at, b.booking_number
         FROM notifications n LEFT JOIN bookings b ON n.entity_type = 'booking' AND b.id = n.entity_id
        WHERE n.user_id = $1 AND n.channel = 'IN_APP' AND n.notification_type = ANY($2::text[])
        ORDER BY n.created_at LIMIT 100`,
      [req.auth.user.id, [...LINE_TYPES]],
    );
    const booking = await latestBooking(req.auth.user.id);
    res.json({
      data: {
        me: { name: req.auth.user.full_name },
        messages: rows.map((n) => ({ id: n.id, type: n.notification_type, at: n.created_at, text: lineText(n), bookingNumber: n.booking_number })),
        booking: booking && { id: booking.id, number: booking.booking_number, status: booking.status, review: booking.review_status, actions: actionsFor(booking) },
      },
    });
  });

  // Staff side of the demo, on the customer's latest booking.
  router.post(
    "/staff",
    requireAuth,
    validate({ body: z.object({ action: z.string().regex(/^(approve|request_changes|confirm_slip|near|arrived|status:[A-Z_]+)$/), note: z.string().max(300).optional() }) }),
    async (req, res) => {
      const b = await latestBooking(req.auth.user.id);
      if (!b) throw NotFound("Booking");
      const { action, note } = req.valid.body;
      if (!actionsFor(b).includes(action)) throw BadRequest(`"${action}" is not possible now`);
      const staff = await adminAuth();
      const ctx = { ...auditContext(req), actorUserId: staff.user.id, actorRoles: staff.roles };

      if (action === "approve" || action === "request_changes") {
        await review.decide(staff, b.id, { decision: action, note: action === "request_changes" ? note || "รูปใบขับขี่ไม่ชัด กรุณาถ่ายใหม่" : undefined }, ctx);
      } else if (action === "confirm_slip") {
        await slips.reviewSlip(staff, b.slip_id, { decision: "approve" }, ctx);
      } else if (action.startsWith("status:")) {
        await operations.changeStatus(staff, b.id, { status: action.slice(7) }, ctx);
      } else {
        // Drive the admin's phone towards the drop-off: ~1.1 km away ("near") or at the door ("arrived").
        const dest = b.delivery_address;
        const lat = dest.lat + (action === "near" ? 0.01 : 0.0003);
        await dispatch.updateMyLocation(staff, { lat, lng: dest.lng, accuracy: 10, speed: 8 });
        if (action === "arrived" && distanceMeters({ lat, lng: dest.lng }, dest) > dispatch.ARRIVED_M) {
          await dispatch.markArrived(staff, b.id, ctx);
        }
      }
      res.json({ data: { ok: true } });
    },
  );

  return router;
}
