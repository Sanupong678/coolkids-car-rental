import { randomUUID } from "node:crypto";
import { config } from "../../config/env.js";
import { pool, withTransaction } from "../../db/pool.js";
import { sha256 } from "../../shared/crypto.js";
import { AppError, BadRequest, Conflict, Forbidden, NotFound } from "../../shared/errors.js";
import { maskedAccountConfirms, maskedAccountMatches, maskPromptpayId, promptpayQr } from "../../shared/promptpay.js";
import * as storage from "../../shared/storage.js";
import { recordAudit } from "../audit/audit.service.js";
import { assertPayable, confirmPaymentTx, dueNow, getBooking, loadBooking, notify } from "../bookings/bookings.service.js";
import { verifySlip } from "./slipok.js";

// PromptPay transfer, paid by slip:
//   1. the customer scans a QR that carries the exact amount due (the reservation fee);
//   2. uploads the bank slip;
//   3. SlipOK reads the slip's QR with the bank → amount, receiver, transaction ref;
//   4. our own checks (amount, date, receiver, ref never used before) → the booking
//      is confirmed on the spot ("ตัดยอด"). Anything the bank could not answer goes
//      to the back office, where a staff member approves or rejects the slip.

const SLIP_TOO_OLD_MS = 10 * 60_000; // a transfer made before the booking existed cannot be for it
const REVIEW_HOLD = "6 hours"; // keeps the car while a slip waits for a staff member

function assertPromptpay(b) {
  if (!config.promptpayConfigured) throw new AppError(503, "PROMPTPAY_DISABLED", "PromptPay is not available");
  if (b.currency !== "THB") throw BadRequest("PromptPay accepts Thai baht only");
}

/** The QR for the booking total, plus the name and masked id customers check in their banking app. */
export async function promptpayInfo(auth, number) {
  const b = await loadBooking(pool, number, auth);
  if (b.user_id !== auth.user.id) throw Forbidden();
  assertPayable(b);
  assertPromptpay(b);
  return {
    qr: await promptpayQr(config.PROMPTPAY_ID, dueNow(b)),
    amountMinor: dueNow(b),
    currency: b.currency,
    accountName: config.PROMPTPAY_NAME || null,
    accountId: maskPromptpayId(config.PROMPTPAY_ID),
    holdExpiresAt: b.hold_expires_at,
    autoCheck: config.slipokConfigured,
  };
}

/** Applies SlipOK's answer and our own rules → { status, code, reason }. */
function judge(result, b) {
  if (result.outcome === "REJECTED") return { status: "REJECTED", code: result.code, reason: result.message };
  if (result.outcome !== "VERIFIED") return { status: "NEEDS_REVIEW", code: result.code, reason: null };
  const s = result.slip;
  if (s.amountMinor !== dueNow(b)) return { status: "REJECTED", code: "AMOUNT", reason: "ยอดเงินในสลิปไม่ตรงกับยอดที่ต้องชำระ" };
  if (s.transferredAt && s.transferredAt < new Date(new Date(b.created_at).getTime() - SLIP_TOO_OLD_MS)) {
    return { status: "REJECTED", code: "OLD_SLIP", reason: "สลิปนี้เป็นการโอนก่อนทำการจอง" };
  }
  if (s.receiverProxy && !maskedAccountMatches(s.receiverProxy, config.PROMPTPAY_ID)) {
    return { status: "REJECTED", code: "RECEIVER", reason: "บัญชีผู้รับในสลิปไม่ใช่บัญชีของร้าน" };
  }
  if (!s.transRef) return { status: "NEEDS_REVIEW", code: "NO_REF", reason: null };
  // A real slip of the right amount paid to someone else's account must not confirm a booking:
  // auto-confirm only when the slip shows our PromptPay id or our bank account; otherwise staff look.
  const ours = maskedAccountConfirms(s.receiverProxy, config.PROMPTPAY_ID) ||
    (config.PROMPTPAY_BANK_ACCOUNT && maskedAccountConfirms(s.receiverAccount, config.PROMPTPAY_BANK_ACCOUNT));
  if (!ours) return { status: "NEEDS_REVIEW", code: "RECEIVER_UNCONFIRMED", reason: null };
  return { status: "VERIFIED", code: null, reason: null };
}

export async function submitSlip(auth, number, { body, ext, contentType }, ctx) {
  const imageHash = sha256(body);

  // 1. Cheap checks first (no SlipOK quota spent on a slip we would refuse anyway).
  const { booking, payment } = await withTransaction(
    async (db) => {
      const b = await loadBooking(db, number, auth, { lock: true });
      if (b.user_id !== auth.user.id) throw Forbidden("Only the renter can pay this booking");
      assertPayable(b);
      assertPromptpay(b);

      const { rows: used } = await db.query("SELECT 1 FROM payment_slips WHERE image_sha256 = $1 AND status <> 'REJECTED'", [imageHash]);
      if (used[0]) throw Conflict("SLIP_ALREADY_USED", "สลิปนี้ถูกส่งเข้ามาแล้ว");
      const { rows: waiting } = await db.query("SELECT 1 FROM payment_slips WHERE booking_id = $1 AND status = 'NEEDS_REVIEW'", [b.id]);
      if (waiting[0]) throw Conflict("SLIP_IN_REVIEW", "สลิปก่อนหน้ากำลังรอเจ้าหน้าที่ตรวจสอบ");

      const { rows: open } = await db.query(
        `SELECT * FROM payments WHERE booking_id = $1 AND provider = 'promptpay' AND status IN ('INITIATED','REQUIRES_ACTION')
          ORDER BY created_at DESC LIMIT 1`,
        [b.id],
      );
      let p = open[0];
      if (!p) {
        const { rows } = await db.query(
          `INSERT INTO payments (booking_id, user_id, purpose, provider, provider_payment_id, amount_minor, currency, status, idempotency_key)
           VALUES ($1, $2, 'RENTAL', 'promptpay', $3, $4, $5, 'REQUIRES_ACTION', $6) RETURNING *`,
          [b.id, auth.user.id, `pp_${randomUUID()}`, dueNow(b), b.currency, randomUUID()],
        );
        p = rows[0];
        await db.query(
          `INSERT INTO payment_transactions (payment_id, transaction_type, status, amount_minor, currency, provider_transaction_id)
           VALUES ($1, 'INITIALIZE', 'PENDING', $2, $3, $4)`,
          [p.id, p.amount_minor, p.currency, p.provider_payment_id],
        );
      }
      return { booking: b, payment: p };
    },
    { actorId: auth.user.id },
  );

  // 2. Network calls outside any transaction: keep the image, ask the bank via SlipOK.
  const key = `slips/${booking.id}/${imageHash.toString("hex").slice(0, 32)}.${ext}`;
  const storedOn = await storage.put("private", key, body, contentType);
  const result = await verifySlip({ image: body, contentType, amountMinor: dueNow(booking) });
  let verdict = judge(result, booking);
  const s = result.slip ?? {};

  // 3. Record the slip and, when it passed, confirm the booking in the same transaction.
  const outcome = await withTransaction(
    async (db) => {
      await db.query("SELECT 1 FROM bookings WHERE id = $1 FOR UPDATE", [booking.id]);
      if (verdict.status === "VERIFIED") {
        const { rows: dup } = await db.query("SELECT 1 FROM payment_slips WHERE trans_ref = $1 AND status <> 'REJECTED'", [s.transRef]);
        if (dup[0]) verdict = { status: "REJECTED", code: "DUPLICATE", reason: "สลิปนี้เคยถูกใช้แล้ว" };
      }
      const { rows: media } = await db.query(
        `INSERT INTO media (media_type, storage_provider, storage_key, mime_type, file_size_bytes, checksum_sha256, is_private, uploaded_by)
         VALUES ('IMAGE', $1, $2, $3, $4, $5, true, $6)
         ON CONFLICT (storage_key) DO UPDATE SET deleted_at = NULL RETURNING id`,
        [storedOn, key, contentType, body.length, imageHash, auth.user.id],
      );
      const { rows: slipRows } = await db.query(
        `INSERT INTO payment_slips (payment_id, booking_id, uploaded_by, media_id, image_sha256, status, trans_ref, amount_minor,
           transferred_at, sender_name, sender_bank, receiver_name, receiver_account, reject_code, reject_reason, provider, provider_response)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
        [
          payment.id, booking.id, auth.user.id, media[0].id, imageHash, verdict.status, s.transRef ?? null, s.amountMinor ?? null,
          s.transferredAt ?? null, s.senderName ?? null, s.senderBank ?? null, s.receiverName ?? null,
          s.receiverAccount ?? s.receiverProxy ?? null, verdict.code, verdict.reason,
          config.slipokConfigured ? "slipok" : "manual", result.raw ? JSON.stringify(result.raw) : null,
        ],
      );

      if (verdict.status === "VERIFIED") {
        await confirmPaymentTx(db, payment.id, {
          methodType: "promptpay",
          providerPaymentId: payment.provider_payment_id,
          amountMinor: s.amountMinor,
          currency: "THB",
          raw: { slipId: slipRows[0].id, transRef: s.transRef, checkedBy: "slipok" },
        });
      } else if (verdict.status === "NEEDS_REVIEW") {
        await db.query(
          `UPDATE bookings SET hold_expires_at = GREATEST(hold_expires_at, now() + interval '${REVIEW_HOLD}') WHERE id = $1 AND status = 'PENDING'`,
          [booking.id],
        );
        await db.query(
          "INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload) VALUES ('booking', $1, 'payment.slip_review', $2)",
          [booking.id, JSON.stringify({ slipId: slipRows[0].id, reason: verdict.code })],
        );
        await notify(db, booking.user_id, {
          type: "SLIP_NEEDS_REVIEW", bookingId: booking.id,
          title: "ได้รับสลิปแล้ว",
          body: `การจอง ${booking.booking_number}: เจ้าหน้าที่กำลังตรวจสอบสลิป เราล็อกรถไว้ให้ระหว่างนี้`,
        });
      }
      await recordAudit(db, ctx, {
        action: `payment.slip_${verdict.status.toLowerCase()}`, entityType: "payment", entityId: payment.id,
        after: { slipId: slipRows[0].id, code: verdict.code, amount: s.amountMinor ?? null },
      });
      return verdict;
    },
    { actorId: auth.user.id },
  );

  return { status: outcome.status, reason: outcome.reason, booking: await getBooking(auth, number) };
}

// ---------------------------------------------------------------- back office

const SLIP_SELECT = `
  SELECT s.*, b.booking_number, b.status AS booking_status, COALESCE(b.amount_due_now_minor, b.total_minor) AS expected_minor, b.currency, b.hold_expires_at,
         b.created_at AS booking_created_at, ci.legal_full_name, ci.phone AS customer_phone, v.brand, v.model, v.license_plate,
         ru.full_name AS reviewer_name
    FROM payment_slips s
    JOIN bookings b ON b.id = s.booking_id
    JOIN vehicles v ON v.id = b.vehicle_id
    LEFT JOIN customer_identities ci ON ci.id = b.customer_identity_id
    LEFT JOIN users ru ON ru.id = s.reviewed_by`;

const slipDto = (r) => ({
  id: r.id,
  status: r.status,
  createdAt: r.created_at,
  booking: {
    id: r.booking_id, number: r.booking_number, status: r.booking_status, expectedMinor: Number(r.expected_minor), currency: r.currency,
    holdExpiresAt: r.hold_expires_at, createdAt: r.booking_created_at, vehicle: `${r.brand} ${r.model} · ${r.license_plate}`,
  },
  customer: { fullName: r.legal_full_name, phone: r.customer_phone },
  slip: {
    transRef: r.trans_ref, amountMinor: r.amount_minor == null ? null : Number(r.amount_minor), transferredAt: r.transferred_at,
    senderName: r.sender_name, senderBank: r.sender_bank, receiverName: r.receiver_name, receiverAccount: r.receiver_account,
  },
  provider: r.provider,
  rejectCode: r.reject_code,
  rejectReason: r.reject_reason,
  reviewedBy: r.reviewer_name,
  reviewedAt: r.reviewed_at,
});

export async function listSlips(status) {
  const { rows } = await pool.query(
    `${SLIP_SELECT} WHERE ($1::text IS NULL OR s.status = $1) ORDER BY (s.status = 'NEEDS_REVIEW') DESC, s.created_at DESC LIMIT 100`,
    [status ?? null],
  );
  return rows.map(slipDto);
}

export async function readSlipImage(id) {
  const { rows } = await pool.query(
    `SELECT m.storage_provider, m.storage_key, m.mime_type FROM payment_slips s JOIN media m ON m.id = s.media_id WHERE s.id = $1`,
    [id],
  );
  if (!rows[0]) throw NotFound("Slip");
  const file = await storage.get("private", rows[0].storage_key, rows[0].storage_provider);
  if (!file) throw NotFound("Slip");
  return { body: file.body, contentType: rows[0].mime_type };
}

/** A staff member's decision on a slip the bank check could not settle. */
export async function reviewSlip(auth, id, { decision, reason, transRef }, ctx) {
  return withTransaction(
    async (db) => {
      const { rows } = await db.query(`${SLIP_SELECT} WHERE s.id = $1`, [id]);
      const r = rows[0];
      if (!r) throw NotFound("Slip");
      await db.query("SELECT 1 FROM bookings WHERE id = $1 FOR UPDATE", [r.booking_id]);
      const { rows: lock } = await db.query("SELECT status FROM payment_slips WHERE id = $1 FOR UPDATE", [id]);
      if (lock[0].status !== "NEEDS_REVIEW") throw Conflict("SLIP_ALREADY_REVIEWED", "สลิปนี้ถูกตรวจแล้ว");

      if (decision === "approve") {
        const ref = r.trans_ref ?? transRef ?? null;
        if (ref) {
          const { rows: dup } = await db.query("SELECT 1 FROM payment_slips WHERE trans_ref = $1 AND status <> 'REJECTED' AND id <> $2", [ref, id]);
          if (dup[0]) throw Conflict("SLIP_ALREADY_USED", "เลขอ้างอิงนี้ถูกใช้กับสลิปอื่นแล้ว");
        }
        await db.query(
          `UPDATE payment_slips SET status = 'VERIFIED', trans_ref = $2, amount_minor = COALESCE(amount_minor, $3),
                  reviewed_by = $4, reviewed_at = now() WHERE id = $1`,
          [id, ref, r.expected_minor, auth.user.id],
        );
        const { rows: p } = await db.query("SELECT provider_payment_id FROM payments WHERE id = $1", [r.payment_id]);
        await confirmPaymentTx(db, r.payment_id, {
          methodType: "promptpay",
          providerPaymentId: p[0].provider_payment_id,
          currency: "THB",
          raw: { slipId: id, transRef: ref, checkedBy: "staff", reviewedBy: auth.user.id },
        });
      } else {
        await db.query(
          `UPDATE payment_slips SET status = 'REJECTED', reject_code = 'STAFF', reject_reason = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $1`,
          [id, reason ?? "สลิปไม่ถูกต้อง", auth.user.id],
        );
        const { rows: b } = await db.query("SELECT user_id FROM bookings WHERE id = $1", [r.booking_id]);
        await notify(db, b[0].user_id, {
          type: "SLIP_REJECTED", bookingId: r.booking_id,
          title: "สลิปไม่ผ่านการตรวจสอบ",
          body: `การจอง ${r.booking_number}: ${reason ?? "สลิปไม่ถูกต้อง"} กรุณาส่งสลิปใหม่ หรือติดต่อ LINE @Coolkidscar`,
        });
      }
      await recordAudit(db, ctx, { action: decision === "approve" ? "payment.slip_approved" : "payment.slip_rejected", entityType: "payment", entityId: r.payment_id, after: { slipId: id, reason } });
      const { rows: out } = await db.query(`${SLIP_SELECT} WHERE s.id = $1`, [id]);
      return slipDto(out[0]);
    },
    { actorId: auth.user.id },
  );
}
