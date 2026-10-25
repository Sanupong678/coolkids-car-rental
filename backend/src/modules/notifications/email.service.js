import { config } from "../../config/env.js";
import { pool, withTransaction } from "../../db/pool.js";
import { logger } from "../../shared/logger.js";
import { sendMail } from "../../shared/mailer.js";
import { bookingLink } from "./line.service.js";
import { RENTAL_RULES } from "../bookings/summary.js";
import { BOOKING_SELECT } from "../bookings/bookings.service.js";
import { attachmentsBox, layout, messageBox, priceSection, rulesBox, STATUS, tripSection } from "./mail-look.js";

// E-mail copies of the booking updates customers wait for, next to the in-app
// and LINE ones. Same pattern as line.service: notify() queues an EMAIL row in
// the caller's transaction, this sender delivers committed rows. The address is
// the booking's contact e-mail, else the account e-mail when it is a real one
// (LINE-only accounts get a placeholder address and are skipped).
// The contract / receipt PDF has its own e-mail (fleetops sendContract), so
// CONTRACT_SENT is not copied here.

export const EMAIL_TYPES = new Set([
  "BOOKING_SUBMITTED", // documents received, waiting for staff
  "BOOKING_APPROVED", // documents OK: transfer the reservation fee
  "DOCS_CHANGES_REQUESTED",
  "SLIP_NEEDS_REVIEW",
  "SLIP_REJECTED",
  "BOOKING_CONFIRMED", // paid
  "BOOKING_PREPARING",
  "BOOKING_READY",
  "BOOKING_IN_DELIVERY",
  "BOOKING_COMPLETED",
  "BOOKING_CANCELLED",
]);

const BATCH = 20;
export const realEmail = (e) => Boolean(e) && !/@(line\.coolkids\.invalid|[a-z.]*coolkids\.local)$/i.test(e);

/** Queues the e-mail copy of a notification (call inside the same transaction as the in-app one). */
export async function queueEmail(db, userId, { type, title, body, bookingId, data }) {
  if (!config.mailConfigured || !EMAIL_TYPES.has(type)) return;
  await db.query(
    `INSERT INTO notifications (user_id, notification_type, channel, title, body, data, entity_type, entity_id)
     VALUES ($1, $2, 'EMAIL', $3, $4, $5, 'booking', $6)`,
    [userId, type, title, body, JSON.stringify(data ?? {}), bookingId],
  );
  kickEmailSender();
}

// What the button says, per update.
const CTA = {
  BOOKING_APPROVED: "โอนค่าจอง / แนบสลิป",
  DOCS_CHANGES_REQUESTED: "แก้ไขข้อมูลและเอกสาร",
  SLIP_REJECTED: "ส่งสลิปใหม่",
  BOOKING_CONFIRMED: "ดูการจองและสัญญาเช่า",
};
// Booking-summary and rules lines that the trip / price sections already show.
const SUMMARY_LINE = /^(เลขที่การจอง|รุ่นรถ|วันที่ เวลา|สถานที่|ค่าเช่า|ส่วนลด|เงินประกัน|ค่าบริการรับส่งรถ|รวม |ชำระค่าจองแล้ว|วันรับรถชำระ|เงินจองจะถูกนำไปหัก)/;
const RULE_LINES = new Set(RENTAL_RULES);
const BOOKING_PREFIX = /^(การจอง\s+)?[A-Z]{2,}-[\w-]+(\s*\([^)]*\))?\s*:?\s*/;

/** The notification text without what the e-mail shows in its own sections. */
function message(body) {
  return String(body ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !SUMMARY_LINE.test(l) && !RULE_LINES.has(l))
    .map((l) => l.replace(BOOKING_PREFIX, ""))
    .filter(Boolean)
    .join("\n");
}

/**
 * Subject, text and HTML of a customer e-mail for a notification row
 * ({ type, title, body, booking_number }) and its booking (BOOKING_SELECT row, optional).
 */
export function renderCustomerMail(n, booking = null, files = []) {
  const link = n.booking_number ? bookingLink(n.booking_number) : config.FRONTEND_URL;
  const subject = `${n.title}${n.booking_number ? ` · ${n.booking_number}` : ""} — Coolkids Car Rental`;
  const text = [n.title, n.body, `ดูสถานะการจอง: ${link}`, "Coolkids Car Rental · 065-365-6514 · LINE @Coolkidscar"].filter(Boolean).join("\n\n");
  const msg = message(n.body);
  const html = layout({
    type: n.type,
    title: n.title,
    lead: STATUS[n.type]?.label ? null : msg,
    booking: booking ?? { booking_number: n.booking_number },
    sections: [
      messageBox(n.type, msg),
      booking && tripSection(booking),
      booking && priceSection(booking),
      attachmentsBox(files.map((f) => f.filename)),
      n.type === "BOOKING_CONFIRMED" && rulesBox(),
    ],
    cta: { label: CTA[n.type] ?? "ดูสถานะการจอง", href: link },
  });
  const attachments = files.map((f) => ({ filename: f.filename, content: f.body, contentType: "application/pdf" }));
  return { subject, text, html, attachments };
}

// PDFs that go with an update: the booking slip (ใบจอง) once it is paid and while the
// car is prepared, plus the rental contract when the booking is confirmed.
const SYSTEM = { user: { id: null }, permissions: new Set(["bookings:read"]), roles: [] };
export const PDF_TYPES = { BOOKING_CONFIRMED: ["booking", "contract"], BOOKING_PREPARING: ["booking"] };

/** Renders the PDFs for one booking update; a document that fails is left out (and logged), never the e-mail. */
export async function pdfsFor(type, booking) {
  const kinds = PDF_TYPES[type];
  if (!kinds || !booking) return [];
  // loaded here, not at the top: these modules import this one
  const [{ documentPdf }, { contractPdf }] = await Promise.all([import("../bookings/documents.service.js"), import("../bookings/bookings.service.js")]);
  const files = [];
  for (const kind of kinds) {
    try {
      if (kind === "booking") {
        const { body, filename } = await documentPdf(booking.id, "booking");
        files.push({ body, filename });
      } else {
        const { body, filename } = await contractPdf(SYSTEM, booking.booking_number);
        files.push({ body, filename: `สัญญาเช่า-${filename}` });
      }
    } catch (err) {
      logger.error({ err, kind, booking: booking.booking_number }, "e-mail PDF failed");
    }
  }
  return files;
}

let timer = null;
/** Sends shortly after the caller's transaction has had time to commit (the interval in server.js retries the rest). */
export function kickEmailSender(delayMs = 1500) {
  if (timer || config.isTest) return;
  timer = setTimeout(() => {
    timer = null;
    sendPendingEmail().catch((err) => logger.error({ err }, "customer e-mail failed"));
  }, delayMs);
  timer.unref?.();
}

/** Delivers queued customer e-mails. Safe to run from several processes (rows are locked, skip-locked). */
export async function sendPendingEmail() {
  if (!config.mailConfigured) return 0;
  await pool.query(
    `UPDATE notifications SET delivery_status = 'FAILED', failure_reason = 'expired'
      WHERE channel = 'EMAIL' AND delivery_status = 'PENDING' AND created_at < now() - interval '1 day'`,
  );
  return withTransaction(async (db) => {
    const { rows } = await db.query(
      `SELECT n.id, n.notification_type AS type, n.title, n.body, b.booking_number, b.contact_email, u.email AS account_email
         FROM notifications n
         JOIN users u ON u.id = n.user_id
         LEFT JOIN bookings b ON n.entity_type = 'booking' AND b.id = n.entity_id
        WHERE n.channel = 'EMAIL' AND n.delivery_status = 'PENDING'
        ORDER BY n.created_at LIMIT ${BATCH}
          FOR UPDATE OF n SKIP LOCKED`,
    );
    let sent = 0;
    for (const n of rows) {
      const to = realEmail(n.contact_email) ? n.contact_email : realEmail(n.account_email) ? n.account_email : null;
      if (!to) {
        await db.query("UPDATE notifications SET delivery_status = 'SKIPPED', failure_reason = 'no e-mail address' WHERE id = $1", [n.id]);
        continue;
      }
      try {
        const { rows: bk } = n.booking_number
          ? await db.query(`${BOOKING_SELECT} WHERE b.booking_number = $1`, [n.booking_number])
          : { rows: [] };
        await sendMail({ to, ...renderCustomerMail(n, bk[0] ?? null, await pdfsFor(n.type, bk[0])) });
        sent += 1;
        await db.query("UPDATE notifications SET delivery_status = 'SENT', sent_at = now(), failure_reason = NULL, data = data || $2 WHERE id = $1", [
          n.id, JSON.stringify({ to }),
        ]);
      } catch (err) {
        // SMTP trouble is usually temporary: keep the row pending, the interval tries again
        await db.query("UPDATE notifications SET failure_reason = $2 WHERE id = $1", [n.id, String(err.message).slice(0, 300)]);
      }
    }
    return sent;
  });
}
