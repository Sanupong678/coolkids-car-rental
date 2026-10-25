import { config } from "../../config/env.js";
import { pool, withTransaction } from "../../db/pool.js";
import { logger } from "../../shared/logger.js";

// LINE push messages from the Official Account (Messaging API).
//
// notify() writes a LINE-channel notification row next to the in-app one, inside
// the caller's transaction; this sender delivers the committed rows. Each push
// counts against the OA's monthly message quota, so only the moments a customer
// really waits for go out on LINE (LINE_TYPES).
//
// The LINE user id comes from the customer's LINE sign-in. It equals the
// Messaging API user id only when the LINE Login channel and the OA's Messaging
// API channel belong to the same provider in the LINE Developers console, and
// the customer must have added the OA as a friend.

const PUSH = "https://api.line.me/v2/bot/message/push";
const BATCH = 20;

export const LINE_TYPES = new Set([
  "BOOKING_CONFIRMED", // paid (card, or PromptPay slip verified)
  "SLIP_NEEDS_REVIEW", // slip received, a staff member will check it
  "SLIP_REJECTED",
  "BOOKING_APPROVED", // documents OK: transfer the reservation fee
  "DOCS_CHANGES_REQUESTED",
  "CONTRACT_SENT", // staff sent the rental contract PDF link
  "BOOKING_PREPARING", // staff took the job: preparing documents and the car
  "BOOKING_READY", // branch pick-up: car ready
  "BOOKING_IN_DELIVERY", // car left the branch
  "DELIVERY_NEAR",
  "DELIVERY_ARRIVED",
]);

export const bookingLink = (number) =>
  config.LIFF_ID ? `https://liff.line.me/${config.LIFF_ID}/bookings/${number}` : `${config.FRONTEND_URL}/bookings/${number}`;

/** Queues the LINE copy of a notification (call inside the same transaction as the in-app one). */
export async function queueLine(db, userId, { type, title, body, bookingId, data }) {
  if (!config.lineMessagingConfigured || !LINE_TYPES.has(type)) return;
  await db.query(
    `INSERT INTO notifications (user_id, notification_type, channel, title, body, data, entity_type, entity_id)
     VALUES ($1, $2, 'LINE', $3, $4, $5, 'booking', $6)`,
    [userId, type, title, body, JSON.stringify(data ?? {}), bookingId],
  );
  kickLineSender();
}

/** The exact text a customer receives on LINE for a notification row ({ title, body, booking_number }). */
export const lineText = (n) =>
  [n.title, n.body, n.booking_number && `ดูสถานะ: ${bookingLink(n.booking_number)}`].filter(Boolean).join("\n\n");

let timer = null;
/** Sends shortly after the caller's transaction has had time to commit (the interval in server.js retries the rest). */
export function kickLineSender(delayMs = 1500) {
  if (timer || config.isTest) return;
  timer = setTimeout(() => {
    timer = null;
    sendPendingLine().catch((err) => logger.error({ err }, "LINE push failed"));
  }, delayMs);
  timer.unref?.();
}

async function push(to, text, retryKey) {
  const res = await fetch(PUSH, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.LINE_MESSAGING_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      "X-Line-Retry-Key": retryKey, // LINE drops a second push with the same key: retries never double-send
    },
    body: JSON.stringify({ to, messages: [{ type: "text", text: text.slice(0, 5000) }] }),
    signal: AbortSignal.timeout(8000),
  });
  if (res.ok || res.status === 409) return { ok: true }; // 409 = already accepted under this retry key
  const body = await res.json().catch(() => ({}));
  return { ok: false, retry: res.status >= 500 || res.status === 429, reason: `${res.status} ${body.message ?? ""}`.trim() };
}

/** Delivers queued LINE notifications. Safe to run from several processes (rows are locked, skip-locked). */
export async function sendPendingLine() {
  if (!config.lineMessagingConfigured) return 0;
  await pool.query(
    `UPDATE notifications SET delivery_status = 'FAILED', failure_reason = 'expired'
      WHERE channel = 'LINE' AND delivery_status = 'PENDING' AND created_at < now() - interval '1 day'`,
  );
  return withTransaction(async (db) => {
    const { rows } = await db.query(
      `SELECT n.id, n.title, n.body, b.booking_number,
              (SELECT i.provider_subject FROM user_identities i
                WHERE i.user_id = n.user_id AND i.provider = 'line' ORDER BY i.last_used_at DESC NULLS LAST LIMIT 1) AS line_user_id
         FROM notifications n
         LEFT JOIN bookings b ON n.entity_type = 'booking' AND b.id = n.entity_id
        WHERE n.channel = 'LINE' AND n.delivery_status = 'PENDING'
        ORDER BY n.created_at LIMIT ${BATCH}
          FOR UPDATE OF n SKIP LOCKED`,
    );
    let sent = 0;
    for (const n of rows) {
      if (!n.line_user_id) {
        await db.query("UPDATE notifications SET delivery_status = 'SKIPPED', failure_reason = 'no LINE account' WHERE id = $1", [n.id]);
        continue;
      }
      const text = lineText(n);
      let result;
      try {
        result = await push(n.line_user_id, text, n.id);
      } catch (err) {
        result = { ok: false, retry: true, reason: err.message };
      }
      if (result.ok) {
        sent += 1;
        await db.query("UPDATE notifications SET delivery_status = 'SENT', sent_at = now(), failure_reason = NULL WHERE id = $1", [n.id]);
      } else if (result.retry) {
        await db.query("UPDATE notifications SET failure_reason = $2 WHERE id = $1", [n.id, result.reason]);
      } else {
        await db.query("UPDATE notifications SET delivery_status = 'FAILED', failure_reason = $2 WHERE id = $1", [n.id, result.reason]);
      }
    }
    return sent;
  });
}
