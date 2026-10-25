import { pool, withTransaction } from "../../db/pool.js";
import { BadRequest, Conflict, NotFound } from "../../shared/errors.js";
import { getSettings } from "../../shared/settings.js";
import { recordAudit } from "../audit/audit.service.js";
import { BOOKING_SELECT, bookingDto, dueNow, notify } from "../bookings/bookings.service.js";

// Staff check of a LINE booking before the customer pays: details, ID / licence
// photos (both drivers), stay location, reference document and Facebook / IG.
//   approve          → the customer gets the transfer QR for the reservation fee
//   request_changes  → the customer is told what to fix and sends again

const TZ = "Asia/Bangkok";
const bahtText = (minor) => new Intl.NumberFormat("th-TH").format(minor / 100);
const until = (d) => new Date(d).toLocaleString("th-TH", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Bookings waiting for staff (submitted) or for the customer's transfer (approved, unpaid). */
export async function listApprovals() {
  const { rows } = await pool.query(
    `${BOOKING_SELECT}
      WHERE b.deleted_at IS NULL AND b.status = 'PENDING' AND b.hold_expires_at > now()
        AND b.review_status IN ('SUBMITTED','APPROVED','CHANGES_REQUESTED')
      ORDER BY (b.review_status = 'SUBMITTED') DESC, b.submitted_at NULLS LAST
      LIMIT 200`,
  );
  const emails = await pool.query("SELECT id, email FROM users WHERE id = ANY($1::uuid[])", [rows.map((r) => r.user_id)]);
  const emailOf = Object.fromEntries(emails.rows.map((u) => [u.id, u.email]));
  return rows.map((r) => ({ ...bookingDto(r), customerEmail: emailOf[r.user_id] ?? null }));
}

export async function decide(auth, bookingId, { decision, note }, ctx) {
  const settings = await getSettings();
  return withTransaction(
    async (db) => {
      const { rows } = await db.query(`${BOOKING_SELECT} WHERE b.id = $1 AND b.deleted_at IS NULL`, [bookingId]);
      const b = rows[0];
      if (!b) throw NotFound("Booking");
      await db.query("SELECT 1 FROM bookings WHERE id = $1 FOR UPDATE", [b.id]);
      if (b.status !== "PENDING" || new Date(b.hold_expires_at) < new Date()) throw Conflict("BOOKING_NOT_PENDING", "การจองนี้หมดเวลาหรือไม่ได้รอตรวจแล้ว");
      if (b.review_status !== "SUBMITTED") throw Conflict("NOT_SUBMITTED", "ลูกค้ายังไม่ได้ส่งเอกสาร หรือการจองนี้ถูกตรวจไปแล้ว");

      if (decision === "approve") {
        const { rows: h } = await db.query(
          `UPDATE bookings SET review_status = 'APPROVED', approved_at = now(), approved_by = $2, review_note = $3,
                  hold_expires_at = now() + make_interval(hours => $4)
            WHERE id = $1 RETURNING hold_expires_at`,
          [b.id, auth.user.id, note ?? null, Number(settings["booking.payment_hold_hours"])],
        );
        await notify(db, b.user_id, {
          type: "BOOKING_APPROVED", bookingId: b.id,
          title: "เอกสารผ่านการตรวจสอบแล้ว",
          body: `การจอง ${b.booking_number} (${b.brand} ${b.model})\nกรุณาโอนค่าจอง ${bahtText(dueNow(b))} บาท ภายใน ${until(h[0].hold_expires_at)} เพื่อยืนยันการจอง (โอน = จอง)\nกดลิงก์ด้านล่างเพื่อสแกน QR และแนบสลิป`,
        });
      } else {
        if (!note) throw BadRequest("บอกลูกค้าว่าต้องแก้ไขอะไร");
        await db.query("UPDATE bookings SET review_status = 'CHANGES_REQUESTED', review_note = $2 WHERE id = $1", [b.id, note]);
        await notify(db, b.user_id, {
          type: "DOCS_CHANGES_REQUESTED", bookingId: b.id,
          title: "ขอข้อมูล / เอกสารเพิ่มเติม",
          body: `การจอง ${b.booking_number}: ${note}\nกดลิงก์ด้านล่างเพื่อแก้ไขแล้วส่งอีกครั้ง`,
        });
      }
      await db.query(
        "INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload) VALUES ('booking', $1, $2, $3)",
        [b.id, decision === "approve" ? "booking.approved" : "booking.changes_requested", JSON.stringify({ note: note ?? null })],
      );
      await recordAudit(db, ctx, {
        action: decision === "approve" ? "booking.approved" : "booking.changes_requested",
        entityType: "booking", entityId: b.id, after: { note: note ?? null },
      });
      const { rows: out } = await db.query(`${BOOKING_SELECT} WHERE b.id = $1`, [b.id]);
      return bookingDto(out[0]);
    },
    { actorId: auth.user.id },
  );
}
