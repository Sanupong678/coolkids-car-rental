import { pool, withTransaction } from "../../db/pool.js";
import { BadRequest, NotFound } from "../../shared/errors.js";
import { getSettings } from "../../shared/settings.js";
import { recordAudit } from "../audit/audit.service.js";
import { bookingDto, notify } from "../bookings/bookings.service.js";

// Back-office dispatch board: today's jobs and the buttons that move a booking
// through preparing documents → car on the way → arrived. Each step also writes
// delivery_assignments / delivery_tracking / staff_activity_logs so delivery
// performance can be analysed later.

const TZ = "Asia/Bangkok";

export const BUCKETS = {
  today: "(b.pickup_at AT TIME ZONE 'Asia/Bangkok')::date = $1::date AND b.status NOT IN ('EXPIRED','PENDING')",
  pending_payment: "b.status = 'PENDING' AND b.hold_expires_at > now()",
  to_deliver: "b.status IN ('CONFIRMED','PREPARING','READY')",
  in_delivery: "b.status = 'IN_DELIVERY'",
  delivered: "b.status IN ('ACTIVE','COMPLETED')",
  cancelled: "b.status IN ('CANCELLED','REFUNDED','EXPIRED')",
};

const LIST_SELECT = `
  SELECT b.*, v.slug AS vehicle_slug, v.brand, v.model, v.trim, v.model_year, v.license_plate, v.fleet_no,
         img.file_url AS image_url, img.variants AS image_variants, ci.legal_full_name, ci.phone AS customer_phone,
         ci.id_document_type, ci.id_front_media_id, ci.id_back_media_id, ci.license_front_media_id,
         u.email AS customer_email, l.name AS branch_name, l.latitude::float AS branch_lat, l.longitude::float AS branch_lng,
         ct.id AS contract_id, ct.contract_number, ct.status AS contract_status, ct.signed_at AS contract_signed_at,
         (SELECT json_build_object('status', p.status, 'provider', p.provider, 'methodType', p.payment_method_type,
                                   'succeededAt', p.succeeded_at, 'amountMinor', p.amount_minor)
            FROM payments p WHERE p.booking_id = b.id AND NOT p.is_balance AND p.parent_payment_id IS NULL
            ORDER BY (p.status = 'SUCCEEDED') DESC, p.created_at DESC LIMIT 1) AS payment,
         (SELECT COALESCE(sum(p.amount_minor), 0) FROM payments p
           WHERE p.booking_id = b.id AND p.purpose = 'RENTAL' AND p.status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED')) AS rent_paid_minor,
         EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id AND p.purpose = 'DEPOSIT'
                  AND p.status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED')) AS deposit_paid,
         (SELECT json_build_object('status', p.status, 'succeededAt', p.succeeded_at, 'methodType', p.payment_method_type)
            FROM payments p WHERE p.booking_id = b.id AND p.is_balance ORDER BY (p.status = 'SUCCEEDED') DESC, p.created_at DESC LIMIT 1) AS balance_payment,
         NULL AS timeline,
         (SELECT json_agg(json_build_object('type', i.item_type, 'description', i.description, 'quantity', i.quantity,
                                            'amountMinor', i.amount_minor) ORDER BY i.sort_order)
            FROM booking_items i WHERE i.booking_id = b.id) AS items,
         -- money for the board: paid online / at the counter, deposit held
         (SELECT COALESCE(sum(p.amount_minor), 0) FROM payments p WHERE p.booking_id = b.id AND p.purpose = 'RENTAL'
             AND p.provider <> 'counter' AND p.status = 'SUCCEEDED') AS paid_online_minor,
         (SELECT COALESCE(sum(p.amount_minor), 0) FROM payments p WHERE p.booking_id = b.id AND p.purpose = 'RENTAL'
             AND p.provider = 'counter' AND p.status = 'SUCCEEDED') AS paid_counter_minor,
         (SELECT COALESCE(sum(p.amount_minor), 0) FROM payments p WHERE p.booking_id = b.id AND p.purpose = 'DEPOSIT'
             AND p.status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED')) AS deposit_collected_minor,
         (SELECT count(*) FROM bookings pb WHERE pb.user_id = b.user_id AND pb.status = 'COMPLETED' AND pb.id <> b.id)::int AS customer_trips
    FROM bookings b
    JOIN vehicles v ON v.id = b.vehicle_id
    LEFT JOIN LATERAL (
      SELECT m.file_url, m.variants FROM vehicle_images vi JOIN media m ON m.id = vi.media_id
       WHERE vi.vehicle_id = v.id AND vi.role = 'PRIMARY' AND vi.deleted_at IS NULL LIMIT 1
    ) img ON true
    JOIN users u ON u.id = b.user_id
    JOIN locations l ON l.id = b.pickup_location_id
    LEFT JOIN customer_identities ci ON ci.id = b.customer_identity_id
    LEFT JOIN contracts ct ON ct.booking_id = b.id AND ct.status IN ('ISSUED','SIGNED')`;

export async function board(date) {
  const day = date ?? new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const counts = {};
  const lists = {};
  for (const [key, where] of Object.entries(BUCKETS)) {
    const order = key === "delivered" || key === "cancelled" ? "b.updated_at DESC" : "b.pickup_at ASC";
    const { rows } = await pool.query(
      `${LIST_SELECT} WHERE b.deleted_at IS NULL AND ${where} ${key === "today" ? "" : "AND $1::date IS NOT NULL"}
        ORDER BY ${order} LIMIT 200`,
      [day],
    );
    lists[key] = rows.map((r) => ({
      ...bookingDto(r),
      customerEmail: r.contact_email ?? r.customer_email,
      ops: {
        customerTrips: r.customer_trips,
        odometerStartKm: r.odometer_start_km, odometerEndKm: r.odometer_end_km,
        paidOnlineMinor: Number(r.paid_online_minor), paidCounterMinor: Number(r.paid_counter_minor),
        depositCollectedMinor: Number(r.deposit_collected_minor), depositReturnedAt: r.deposit_returned_at,
        depositDeductionMinor: r.deposit_deduction_minor == null ? null : Number(r.deposit_deduction_minor),
        // still to collect at hand-over: rent balance + deposit
        dueMinor: Math.max(0, Number(r.total_minor) - Number(r.paid_online_minor) - Number(r.paid_counter_minor))
          + (Number(r.deposit_collected_minor) ? 0 : Number(r.deposit_minor)),
      },
    }));
    counts[key] = rows.length;
  }
  return { date: day, counts, lists };
}

// Which buttons the board shows for each status (the DB trigger is the real gate).
export const NEXT = {
  PENDING: ["CANCELLED"],
  CONFIRMED: ["PREPARING", "CANCELLED"],
  PREPARING: ["IN_DELIVERY", "READY", "CANCELLED"],
  READY: ["ACTIVE", "IN_DELIVERY", "CANCELLED"],
  IN_DELIVERY: ["ACTIVE"],
  ACTIVE: ["COMPLETED"],
};

const MESSAGES = {
  PREPARING: ["กำลังเตรียมเอกสาร", "เจ้าหน้าที่รับงานแล้ว กำลังเตรียมเอกสารและรถของคุณ"],
  READY: ["รถพร้อมให้รับ", "รถพร้อมแล้ว รับได้ที่สาขาตามเวลานัด"],
  IN_DELIVERY: ["กำลังส่งรถ", "รถกำลังเดินทางไปหาคุณ"],
  ACTIVE: ["ถึงที่หมายแล้ว", "ส่งมอบรถเรียบร้อย ขอให้เดินทางปลอดภัย"],
  COMPLETED: ["คืนรถเรียบร้อย", "ขอบคุณที่ใช้บริการ Coolkids"],
  CANCELLED: ["การจองถูกยกเลิก", "เจ้าหน้าที่ยกเลิกการจองของคุณ หากมีข้อสงสัยติดต่อ LINE @Coolkidscar"],
};

const ACTIVITY = { READY: "VEHICLE_MARKED_READY", IN_DELIVERY: "DELIVERY_STARTED", ACTIVE: "VEHICLE_DELIVERED", COMPLETED: "VEHICLE_RECEIVED" };

export async function changeStatus(auth, bookingId, { status, reason }, ctx) {
  const settings = await getSettings();
  return withTransaction(
    async (db) => {
      const { rows } = await db.query("SELECT * FROM bookings WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [bookingId]);
      const b = rows[0];
      if (!b) throw NotFound("Booking");
      if (!(NEXT[b.status] ?? []).includes(status)) throw BadRequest(`Cannot move a ${b.status} booking to ${status}`);
      if (status === "IN_DELIVERY" && b.fulfillment_type !== "DELIVERY") throw BadRequest("This booking is a branch pick-up");

      const { rows: staffRows } = await db.query("SELECT id FROM staff WHERE user_id = $1 AND deleted_at IS NULL", [auth.user.id]);
      const staffId = staffRows[0]?.id ?? null;
      if (reason) await db.query("SELECT set_config('app.status_reason', $1, true)", [reason]);

      const set = ["status = $2"];
      const params = [b.id, status];
      const add = (sql, v) => (params.push(v), set.push(sql.replace("?", `$${params.length}`)));
      let etaAt = null;
      if (status === "IN_DELIVERY") {
        const seconds = b.delivery_duration_s ?? settings["delivery.fallback_minutes"] * 60;
        etaAt = new Date(Date.now() + seconds * 1000);
        add("delivery_eta_at = ?", etaAt);
      }
      if (status === "ACTIVE") {
        set.push("actual_pickup_at = COALESCE(actual_pickup_at, now())");
        if (b.fulfillment_type === "DELIVERY") set.push("delivered_at = now()");
      }
      if (status === "COMPLETED") set.push("actual_return_at = COALESCE(actual_return_at, now())");
      if (status === "CANCELLED") {
        add("cancelled_by = ?", auth.user.id);
        add("cancellation_reason = ?", reason ?? "Cancelled by staff");
      }
      await db.query(`UPDATE bookings SET ${set.join(", ")} WHERE id = $1`, params);

      // Delivery job record + tracking events.
      if (staffId && b.fulfillment_type === "DELIVERY" && ["IN_DELIVERY", "ACTIVE", "CANCELLED"].includes(status)) {
        const { rows: live } = await db.query(
          "SELECT id FROM delivery_assignments WHERE booking_id = $1 AND assignment_type = 'DELIVERY' AND status NOT IN ('FAILED','CANCELLED','DELIVERED')",
          [b.id],
        );
        let assignmentId = live[0]?.id;
        if (status === "IN_DELIVERY" && !assignmentId) {
          const { rows: a } = await db.query(
            `INSERT INTO delivery_assignments (booking_id, staff_id, vehicle_id, assignment_type, status, origin_location_id,
               destination, scheduled_at, eta_at, vehicle_picked_up_at, started_at, assigned_by)
             VALUES ($1, $2, $3, 'DELIVERY', 'EN_ROUTE', $4, $5, $6, $7, now(), now(), $8) RETURNING id`,
            [b.id, staffId, b.vehicle_id, b.pickup_location_id, JSON.stringify(b.delivery_address), b.pickup_at, etaAt, auth.user.id],
          );
          assignmentId = a[0].id;
        } else if (assignmentId && status === "IN_DELIVERY") {
          // Driver picked on the dashboard beforehand: that assignment goes on the road.
          await db.query(
            `UPDATE delivery_assignments SET status = 'EN_ROUTE', eta_at = $2, started_at = now(),
                    vehicle_picked_up_at = COALESCE(vehicle_picked_up_at, now()) WHERE id = $1`,
            [assignmentId, etaAt],
          );
        } else if (assignmentId && status === "ACTIVE") {
          await db.query("UPDATE delivery_assignments SET status = 'DELIVERED', completed_at = now() WHERE id = $1", [assignmentId]);
        } else if (assignmentId && status === "CANCELLED") {
          await db.query("UPDATE delivery_assignments SET status = 'CANCELLED', failure_reason = $2 WHERE id = $1", [assignmentId, reason ?? null]);
        }
        if (assignmentId) {
          await db.query(
            `INSERT INTO delivery_tracking (assignment_id, event_type, status, eta_at, recorded_by) VALUES ($1, 'STATUS', $2, $3, $4)`,
            [assignmentId, status === "ACTIVE" ? "DELIVERED" : status === "CANCELLED" ? "CANCELLED" : "EN_ROUTE", etaAt, staffId],
          );
        }
      }
      if (staffId && ACTIVITY[status]) {
        await db.query(
          `INSERT INTO staff_activity_logs (staff_id, activity_type, vehicle_id, booking_id, location_id) VALUES ($1, $2, $3, $4, $5)`,
          [staffId, ACTIVITY[status], b.vehicle_id, b.id, b.pickup_location_id],
        );
      }

      const [title, body] = MESSAGES[status] ?? [status, ""];
      await notify(db, b.user_id, { type: `BOOKING_${status}`, bookingId: b.id, title, body: `${b.booking_number}: ${body}`, data: { etaAt } });
      await db.query(
        "INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload) VALUES ('booking', $1, 'booking.status_changed', $2)",
        [b.id, JSON.stringify({ from: b.status, to: status, etaAt })],
      );
      await recordAudit(db, ctx, { action: "booking.status_changed", entityType: "booking", entityId: b.id, before: { status: b.status }, after: { status, reason } });
      return { id: b.id, status, etaAt };
    },
    { actorId: auth.user.id },
  );
}

