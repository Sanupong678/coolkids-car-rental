import { randomUUID } from "node:crypto";
import { config } from "../../config/env.js";
import { pool, withTransaction } from "../../db/pool.js";
import { AppError, BadRequest, Conflict, NotFound } from "../../shared/errors.js";
import { sendMail } from "../../shared/mailer.js";
import { recordAudit } from "../audit/audit.service.js";
import { bookingLink } from "../notifications/line.service.js";
import { bookingSummaryText } from "../bookings/summary.js";
import { BOOKING_SELECT, contractPdf, notify } from "../bookings/bookings.service.js";

// Day-to-day work on a booking from the operations board, plus the fleet views:
//   • money collected at pick-up (rent balance + security deposit) and the deposit returned
//   • odometer readings at hand-over and return (they feed the service reminders)
//   • the rental contract PDF sent to the customer by LINE or e-mail
//   • the booking timeline (cars × days) and service / document reminders

const TZ = "Asia/Bangkok";
const HANDED_OVER = ["CONFIRMED", "PREPARING", "READY", "IN_DELIVERY", "ACTIVE", "COMPLETED"];

async function staffIdOf(db, auth) {
  const { rows } = await db.query("SELECT id FROM staff WHERE user_id = $1 AND deleted_at IS NULL", [auth.user.id]);
  return rows[0]?.id ?? null;
}

async function lockBooking(db, bookingId) {
  const { rows } = await db.query("SELECT * FROM bookings WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [bookingId]);
  if (!rows[0]) throw NotFound("Booking");
  return rows[0];
}

/** Money on a booking: what was paid online, collected at the counter, held as deposit and given back. */
export async function ledger(bookingId, db = pool) {
  const { rows: b } = await db.query(
    "SELECT total_minor, deposit_minor, currency, deposit_returned_at, deposit_deduction_minor, deposit_note FROM bookings WHERE id = $1",
    [bookingId],
  );
  if (!b[0]) throw NotFound("Booking");
  const { rows: payments } = await db.query(
    `SELECT id, purpose, provider, amount_minor, amount_refunded_minor, payment_method_type, status, succeeded_at
       FROM payments WHERE booking_id = $1 AND status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED') ORDER BY succeeded_at`,
    [bookingId],
  );
  const sum = (f) => payments.filter(f).reduce((t, p) => t + Number(p.amount_minor), 0);
  const rentPaid = sum((p) => p.purpose === "RENTAL");
  const deposit = payments.find((p) => p.purpose === "DEPOSIT");
  return {
    currency: b[0].currency,
    totalMinor: Number(b[0].total_minor),
    depositMinor: Number(b[0].deposit_minor),
    paidOnlineMinor: sum((p) => p.purpose === "RENTAL" && p.provider !== "counter"),
    paidCounterMinor: sum((p) => p.purpose === "RENTAL" && p.provider === "counter"),
    rentDueMinor: Math.max(0, Number(b[0].total_minor) - rentPaid),
    depositHeldMinor: deposit ? Number(deposit.amount_minor) - Number(deposit.amount_refunded_minor) : 0,
    depositCollected: Boolean(deposit),
    depositReturnedAt: b[0].deposit_returned_at,
    depositDeductionMinor: b[0].deposit_deduction_minor == null ? null : Number(b[0].deposit_deduction_minor),
    depositNote: b[0].deposit_note,
    payments: payments.map((p) => ({
      id: p.id, purpose: p.purpose, channel: p.provider === "counter" ? "counter" : "online", method: p.payment_method_type,
      amountMinor: Number(p.amount_minor), refundedMinor: Number(p.amount_refunded_minor), at: p.succeeded_at,
    })),
  };
}

async function counterPayment(db, b, auth, purpose, amountMinor, method) {
  const { rows } = await db.query(
    `INSERT INTO payments (booking_id, user_id, purpose, provider, provider_payment_id, amount_minor, currency, status,
                           succeeded_at, payment_method_type, idempotency_key)
     VALUES ($1, $2, $3, 'counter', $4, $5, $6, 'SUCCEEDED', now(), $7, $8) RETURNING id`,
    [b.id, b.user_id, purpose, `counter_${randomUUID()}`, amountMinor, b.currency, method, randomUUID()],
  );
  await db.query(
    `INSERT INTO payment_transactions (payment_id, transaction_type, status, amount_minor, currency, provider_response)
     VALUES ($1, 'CAPTURE', 'SUCCEEDED', $2, $3, $4)`,
    [rows[0].id, amountMinor, b.currency, JSON.stringify({ collectedBy: auth.user.id, method })],
  );
}

/** "รับเงินค่าเช่าและมัดจำแล้ว": the rent balance and the security deposit, collected at hand-over. */
export async function collectPayment(auth, bookingId, { method, rentMinor, depositMinor }, ctx) {
  return withTransaction(
    async (db) => {
      const b = await lockBooking(db, bookingId);
      if (!HANDED_OVER.includes(b.status)) throw Conflict("NOT_CONFIRMED", "รับเงินได้หลังยืนยันการจองแล้วเท่านั้น");
      const before = await ledger(b.id, db);
      if (before.paidCounterMinor > 0 || before.depositCollected) throw Conflict("ALREADY_COLLECTED", "บันทึกการรับเงินของการจองนี้ไปแล้ว");
      const rent = rentMinor ?? before.rentDueMinor;
      const deposit = depositMinor ?? Number(b.deposit_minor);
      if (rent > 0) await counterPayment(db, b, auth, "RENTAL", rent, method);
      if (deposit > 0) await counterPayment(db, b, auth, "DEPOSIT", deposit, method);
      await recordAudit(db, ctx, { action: "payment.collected", entityType: "booking", entityId: b.id, after: { rent, deposit, method } });
      return ledger(b.id, db);
    },
    { actorId: auth.user.id },
  );
}

/** Deposit back to the customer, minus deductions (fuel, cleaning, fines …). */
export async function returnDeposit(auth, bookingId, { refundMinor, note }, ctx) {
  return withTransaction(
    async (db) => {
      const b = await lockBooking(db, bookingId);
      if (b.deposit_returned_at) throw Conflict("DEPOSIT_SETTLED", "คืนมัดจำการจองนี้ไปแล้ว");
      const { rows } = await db.query(
        "SELECT * FROM payments WHERE booking_id = $1 AND purpose = 'DEPOSIT' AND status = 'SUCCEEDED' FOR UPDATE",
        [b.id],
      );
      const dep = rows[0];
      if (!dep) throw Conflict("NO_DEPOSIT", "ยังไม่ได้บันทึกการรับเงินมัดจำ");
      const held = Number(dep.amount_minor);
      if (refundMinor > held) throw BadRequest("ยอดคืนมากกว่าเงินมัดจำที่รับไว้");
      if (refundMinor < held && !note) throw BadRequest("ระบุเหตุผลที่หักเงินมัดจำ");
      if (refundMinor > 0) {
        await db.query(
          `INSERT INTO refunds (payment_id, booking_id, amount_minor, currency, reason, notes, status, provider_refund_id,
                                requested_by, approved_by, completed_at)
           VALUES ($1, $2, $3, $4, 'DEPOSIT_RETURN', $5, 'SUCCEEDED', $6, $7, $7, now())`,
          [dep.id, b.id, refundMinor, b.currency, note ?? null, `counter_${randomUUID()}`, auth.user.id],
        );
        await db.query(
          `UPDATE payments SET amount_refunded_minor = $2, status = CASE WHEN $2 >= amount_minor THEN 'REFUNDED' ELSE 'PARTIALLY_REFUNDED' END
            WHERE id = $1`,
          [dep.id, refundMinor],
        );
      }
      await db.query(
        "UPDATE bookings SET deposit_returned_at = now(), deposit_deduction_minor = $2, deposit_note = $3 WHERE id = $1",
        [b.id, held - refundMinor, note ?? null],
      );
      await recordAudit(db, ctx, { action: "payment.deposit_returned", entityType: "booking", entityId: b.id, after: { refundMinor, deducted: held - refundMinor, note } });
      return ledger(b.id, db);
    },
    { actorId: auth.user.id },
  );
}

/** Odometer at hand-over ("ไมล์ส่งรถ") or return ("ไมล์รับคืน"); it also becomes the car's current reading. */
export async function recordMileage(auth, bookingId, { kind, km }, ctx) {
  return withTransaction(
    async (db) => {
      const b = await lockBooking(db, bookingId);
      if (!HANDED_OVER.includes(b.status)) throw Conflict("NOT_CONFIRMED", "บันทึกไมล์ได้หลังยืนยันการจองแล้ว");
      if (kind === "RETURN" && b.odometer_start_km != null && km < b.odometer_start_km) {
        throw BadRequest(`ไมล์รับคืนต้องไม่น้อยกว่าไมล์ส่งรถ (${b.odometer_start_km.toLocaleString()} กม.)`);
      }
      const { rows: v } = await db.query("SELECT current_odometer_km FROM vehicles WHERE id = $1", [b.vehicle_id]);
      if (km < v[0].current_odometer_km) {
        throw BadRequest(`เลขไมล์ต่ำกว่าไมล์ปัจจุบันของรถ (${v[0].current_odometer_km.toLocaleString()} กม.) กรุณาตรวจสอบ`);
      }
      await db.query(
        "INSERT INTO vehicle_mileage (vehicle_id, booking_id, reading_km, reading_type, recorded_by) VALUES ($1, $2, $3, $4, $5)",
        [b.vehicle_id, b.id, km, kind, await staffIdOf(db, auth)],
      );
      await db.query(`UPDATE bookings SET ${kind === "PICKUP" ? "odometer_start_km" : "odometer_end_km"} = $2 WHERE id = $1`, [b.id, km]);
      await recordAudit(db, ctx, { action: "vehicle.mileage_recorded", entityType: "booking", entityId: b.id, after: { kind, km } });
      const { rows } = await db.query("SELECT odometer_start_km, odometer_end_km, distance_km FROM bookings WHERE id = $1", [b.id]);
      return { startKm: rows[0].odometer_start_km, endKm: rows[0].odometer_end_km, distanceKm: rows[0].distance_km };
    },
    { actorId: auth.user.id },
  );
}

const realEmail = (e) => e && !/@(line\.coolkids\.invalid|coolkids\.local)$/i.test(e);

/** The filled-in rental contract to the customer: a LINE message with the PDF link, or the PDF by e-mail. */
export async function sendContract(auth, bookingId, { via, email }, ctx) {
  const { rows } = await pool.query(`${BOOKING_SELECT} WHERE b.id = $1 AND b.deleted_at IS NULL`, [bookingId]);
  const b = rows[0];
  if (!b) throw NotFound("Booking");
  if (!b.contract_id) throw Conflict("NO_CONTRACT", "การจองนี้ยังไม่มีสัญญา");

  if (via === "line") {
    const { rows: line } = await pool.query("SELECT 1 FROM user_identities WHERE user_id = $1 AND provider = 'line'", [b.user_id]);
    if (!line[0]) throw Conflict("NO_LINE", "ลูกค้าคนนี้ไม่ได้จองผ่าน LINE · ส่งทางอีเมลแทน");
    await withTransaction(async (db) => {
      await notify(db, b.user_id, {
        type: "CONTRACT_SENT", bookingId: b.id,
        title: "สัญญาเช่ารถของคุณ",
        body: `การจอง ${b.booking_number} · สัญญาเลขที่ ${b.contract_number}\nเปิดลิงก์ด้านล่างเพื่ออ่านและดาวน์โหลดสัญญา (PDF)`,
      });
      await recordAudit(db, ctx, { action: "contract.sent", entityType: "booking", entityId: b.id, after: { via } });
    });
    return { sent: true, via, to: "LINE", delivered: config.lineMessagingConfigured };
  }

  if (!config.mailConfigured) throw new AppError(503, "MAIL_NOT_CONFIGURED", "ยังไม่ได้ตั้งค่าอีเมลของร้าน (SMTP_* ใน .env) · ส่งทาง LINE หรือดาวน์โหลด PDF แทน");
  const { rows: u } = await pool.query("SELECT email FROM users WHERE id = $1", [b.user_id]);
  const to = email || b.contact_email || (realEmail(u[0]?.email) ? u[0].email : null);
  if (!to) throw BadRequest("ไม่มีอีเมลของลูกค้า · กรอกอีเมลที่จะส่ง");
  const pdf = await contractPdf(auth, b.booking_number);
  await sendMail({
    to,
    subject: `สัญญาเช่ารถ Coolkids · ${b.booking_number}`,
    text: `เรียนคุณ ${b.legal_full_name ?? ""}\n\nแนบสัญญาเช่ารถ เลขที่ ${b.contract_number} สำหรับการจอง ${b.booking_number}\n\n${bookingSummaryText(b)}\n\nดูสถานะการจอง: ${bookingLink(b.booking_number)}\n\nCoolkids Car Rental · 065-365-6514 · LINE @Coolkidscar`,
    attachments: [{ filename: pdf.filename, content: pdf.body, contentType: "application/pdf" }],
  });
  await withTransaction(async (db) => {
    await db.query(
      `INSERT INTO notifications (user_id, notification_type, channel, title, body, entity_type, entity_id, delivery_status, sent_at, data)
       VALUES ($1, 'CONTRACT_SENT', 'EMAIL', 'สัญญาเช่ารถของคุณ', $2, 'booking', $3, 'SENT', now(), $4)`,
      [b.user_id, `ส่งสัญญา ${b.contract_number} ไปที่ ${to}`, b.id, JSON.stringify({ to })],
    );
    await recordAudit(db, ctx, { action: "contract.sent", entityType: "booking", entityId: b.id, after: { via, to } });
  });
  return { sent: true, via, to };
}

// ---------------------------------------------------------------- booking timeline (cars × days)

const PHASE = (r) => {
  if (r.status === "PENDING") return "pending"; // รออนุมัติ / รอชำระ
  if (r.status === "ACTIVE") return "active"; // ใช้งาน
  if (r.status === "COMPLETED") return r.deposit_held && !r.deposit_returned_at ? "deposit" : "done"; // รอคืนมัดจำ
  return "handover"; // รอส่งมอบ
};

export async function schedule(from, to) {
  const { rows: cars } = await pool.query(
    `SELECT v.id, v.slug, v.fleet_no, v.brand, v.model, v.trim, v.license_plate, v.status,
            (SELECT COALESCE(m.variants->>'w640', m.file_url) FROM vehicle_images vi JOIN media m ON m.id = vi.media_id
              WHERE vi.vehicle_id = v.id AND vi.role = 'PRIMARY' AND vi.deleted_at IS NULL LIMIT 1) AS image
       FROM vehicles v WHERE v.deleted_at IS NULL AND v.status <> 'DRAFT'
      ORDER BY v.fleet_no NULLS LAST, v.brand, v.model`,
  );
  const { rows } = await pool.query(
    `SELECT b.id, b.booking_number, b.vehicle_id, b.status, b.pickup_at, b.return_at, b.review_status, b.deposit_returned_at,
            ci.legal_full_name, u.full_name AS user_name,
            EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id AND p.purpose = 'DEPOSIT' AND p.status = 'SUCCEEDED') AS deposit_held
       FROM bookings b
       JOIN users u ON u.id = b.user_id
       LEFT JOIN customer_identities ci ON ci.id = b.customer_identity_id
      WHERE b.deleted_at IS NULL AND b.status NOT IN ('EXPIRED','CANCELLED','REFUNDED')
        AND b.pickup_at < ($2::date + 1)::timestamp AT TIME ZONE '${TZ}' AND b.return_at >= $1::timestamp AT TIME ZONE '${TZ}'
      ORDER BY b.pickup_at`,
    [from, to],
  );
  const { rows: blocks } = await pool.query(
    `SELECT vehicle_id, lower(during) AS start_at, upper(during) AS end_at, reason
       FROM vehicle_availability_blocks
      WHERE block_type = 'MAINTENANCE' AND released_at IS NULL
        AND during && tstzrange($1::timestamp AT TIME ZONE '${TZ}', ($2::date + 1)::timestamp AT TIME ZONE '${TZ}')`,
    [from, to],
  );
  return {
    from, to,
    cars: cars.map((c) => ({ id: c.id, slug: c.slug, fleetNo: c.fleet_no, name: `${c.brand} ${c.model} ${c.trim ?? ""}`.trim(), plate: c.license_plate, status: c.status, image: c.image })),
    bookings: rows.map((r) => ({
      id: r.id, number: r.booking_number, vehicleId: r.vehicle_id, status: r.status, review: r.review_status, phase: PHASE(r),
      start: r.pickup_at, end: r.return_at, customer: r.legal_full_name ?? r.user_name,
    })),
    maintenance: blocks.map((m) => ({ vehicleId: m.vehicle_id, start: m.start_at, end: m.end_at, reason: m.reason })),
  };
}

// ---------------------------------------------------------------- service & document reminders

const NEAR_KM = 1000;
const NEAR_DAYS = 14;
const DOC_NEAR_DAYS = 30;

export const SERVICE_LABEL = {
  OIL_CHANGE: "เปลี่ยนน้ำมันเครื่อง", BRAKE_SERVICE: "เช็คระบบเบรก", TIRE_REPLACEMENT: "เปลี่ยนยาง", TIRE_ROTATION: "สลับยาง",
  ENGINE_SERVICE: "เช็คเครื่องยนต์", INSPECTION: "ตรวจสภาพรถประจำปี", CLEANING: "ทำความสะอาดใหญ่", BATTERY: "แบตเตอรี่", REPAIR: "ซ่อม", OTHER: "อื่นๆ",
};
export const DOC_LABEL = {
  COMPULSORY_INSURANCE: "พ.ร.บ.", ROAD_TAX: "ภาษีรถยนต์", INSURANCE: "ประกันภัย", LEASE_CONTRACT: "สัญญาเช่า/ลีสซิ่ง (ต่อสัญญา)",
  REGISTRATION: "ทะเบียนรถ", INSPECTION: "ตรวจสภาพ (ตรอ.)", OTHER: "เอกสารอื่น",
};

const level = (overdue, near) => (overdue ? "overdue" : near ? "near" : "ok");

/** Every car with its service plan, documents and recent odometer readings, worst first. */
export async function reminders() {
  const { rows: cars } = await pool.query(
    `SELECT v.id, v.fleet_no, v.brand, v.model, v.trim, v.license_plate, v.current_odometer_km,
            COALESCE((SELECT json_agg(json_build_object('id', p.id, 'type', p.maintenance_type, 'intervalKm', p.interval_km,
                       'intervalDays', p.interval_days, 'lastAt', p.last_performed_at, 'lastKm', p.last_performed_km,
                       'nextAt', p.next_due_at, 'nextKm', p.next_due_km) ORDER BY p.maintenance_type)
                        FROM vehicle_maintenance p WHERE p.vehicle_id = v.id AND p.is_active), '[]') AS plans,
            COALESCE((SELECT json_agg(json_build_object('id', d.id, 'type', d.doc_type, 'title', d.title, 'reference', d.reference,
                       'expiresOn', d.expires_on, 'notes', d.notes) ORDER BY d.expires_on)
                        FROM vehicle_documents d WHERE d.vehicle_id = v.id AND d.deleted_at IS NULL), '[]') AS docs,
            COALESCE((SELECT json_agg(x ORDER BY x.at DESC) FROM (
                        SELECT m.reading_km AS km, m.reading_type AS type, m.recorded_at AS at, b.booking_number AS booking
                          FROM vehicle_mileage m LEFT JOIN bookings b ON b.id = m.booking_id
                         WHERE m.vehicle_id = v.id ORDER BY m.recorded_at DESC LIMIT 10) x), '[]') AS mileage
       FROM vehicles v WHERE v.deleted_at IS NULL
      ORDER BY v.fleet_no NULLS LAST`,
  );
  const now = Date.now();
  const days = (d) => Math.ceil((new Date(d).getTime() - now) / 86_400_000);
  const out = cars.map((c) => {
    const km = c.current_odometer_km;
    const plans = c.plans.map((p) => {
      const kmLeft = p.nextKm != null ? p.nextKm - km : null;
      const daysLeft = p.nextAt ? days(p.nextAt) : null;
      return {
        ...p, label: SERVICE_LABEL[p.type] ?? p.type, kmLeft, daysLeft,
        level: level((kmLeft != null && kmLeft <= 0) || (daysLeft != null && daysLeft <= 0),
          (kmLeft != null && kmLeft <= NEAR_KM) || (daysLeft != null && daysLeft <= NEAR_DAYS)),
      };
    });
    const docs = c.docs.map((d) => {
      const daysLeft = days(`${d.expiresOn}T23:59:59+07:00`);
      return { ...d, label: d.title || DOC_LABEL[d.type], daysLeft, level: level(daysLeft < 0, daysLeft <= DOC_NEAR_DAYS) };
    });
    const items = [...plans, ...docs];
    return {
      id: c.id, fleetNo: c.fleet_no, name: `${c.brand} ${c.model} ${c.trim ?? ""}`.trim(), plate: c.license_plate, currentKm: km,
      plans, docs, mileage: c.mileage,
      overdue: items.filter((i) => i.level === "overdue").length,
      near: items.filter((i) => i.level === "near").length,
    };
  });
  out.sort((a, b) => b.overdue - a.overdue || b.near - a.near || (a.fleetNo ?? 999) - (b.fleetNo ?? 999));
  return { cars: out, serviceTypes: SERVICE_LABEL, docTypes: DOC_LABEL };
}

/** A service was done: history record + the plan's next due point (DB trigger), and the odometer. */
export async function completeService(auth, planId, { km, note, costMinor }, ctx) {
  return withTransaction(
    async (db) => {
      const { rows } = await db.query("SELECT p.*, v.current_odometer_km FROM vehicle_maintenance p JOIN vehicles v ON v.id = p.vehicle_id WHERE p.id = $1", [planId]);
      const p = rows[0];
      if (!p) throw NotFound("Service plan");
      const reading = km ?? p.current_odometer_km;
      const staffId = await staffIdOf(db, auth);
      if (reading > p.current_odometer_km) {
        await db.query("INSERT INTO vehicle_mileage (vehicle_id, reading_km, reading_type, recorded_by) VALUES ($1, $2, 'SERVICE', $3)", [p.vehicle_id, reading, staffId]);
      }
      await db.query(
        `INSERT INTO maintenance_records (vehicle_id, plan_id, maintenance_type, status, scheduled_start, scheduled_end, started_at, completed_at,
                                          odometer_km, description, labor_cost_minor, currency, performed_by, created_by)
         VALUES ($1, $2, $3, 'COMPLETED', now() - interval '1 minute', now(), now() - interval '1 minute', now(), $4, $5, $6, 'THB', $7, $8)`,
        [p.vehicle_id, p.id, p.maintenance_type, reading, note ?? null, costMinor ?? 0, staffId, auth.user.id],
      );
      await recordAudit(db, ctx, { action: "maintenance.completed", entityType: "vehicle", entityId: p.vehicle_id, after: { type: p.maintenance_type, km: reading } });
    },
    { actorId: auth.user.id },
  );
}

export async function updatePlan(auth, planId, { intervalKm, intervalDays }, ctx) {
  if (intervalKm == null && intervalDays == null) throw BadRequest("ตั้งอย่างน้อยระยะ กม. หรือจำนวนวัน");
  return withTransaction(async (db) => {
    const { rowCount } = await db.query(
      `UPDATE vehicle_maintenance SET interval_km = $2, interval_days = $3,
              next_due_km = CASE WHEN $2::int IS NULL THEN NULL ELSE COALESCE(last_performed_km, 0) + $2 END,
              next_due_at = CASE WHEN $3::int IS NULL THEN NULL ELSE COALESCE(last_performed_at, now()) + make_interval(days => $3) END
        WHERE id = $1`,
      [planId, intervalKm ?? null, intervalDays ?? null],
    );
    if (!rowCount) throw NotFound("Service plan");
    await recordAudit(db, ctx, { action: "maintenance.plan_changed", entityType: "maintenance_plan", entityId: planId, after: { intervalKm, intervalDays } });
  }, { actorId: auth.user.id });
}

/** Adds a document, or renews one (the old record is kept, soft-deleted). */
export async function saveDocument(auth, vehicleId, { replaces, type, title, reference, expiresOn, notes }, ctx) {
  return withTransaction(async (db) => {
    const { rows: v } = await db.query("SELECT 1 FROM vehicles WHERE id = $1 AND deleted_at IS NULL", [vehicleId]);
    if (!v[0]) throw NotFound("Vehicle");
    if (replaces) await db.query("UPDATE vehicle_documents SET deleted_at = now() WHERE id = $1 AND vehicle_id = $2", [replaces, vehicleId]);
    const { rows } = await db.query(
      `INSERT INTO vehicle_documents (vehicle_id, doc_type, title, reference, expires_on, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [vehicleId, type, title ?? null, reference ?? null, expiresOn, notes ?? null, auth.user.id],
    );
    await recordAudit(db, ctx, { action: replaces ? "vehicle.document_renewed" : "vehicle.document_added", entityType: "vehicle", entityId: vehicleId, after: { type, expiresOn } });
    return { id: rows[0].id };
  }, { actorId: auth.user.id });
}

export async function removeDocument(auth, documentId, ctx) {
  return withTransaction(async (db) => {
    const { rows } = await db.query("UPDATE vehicle_documents SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING vehicle_id", [documentId]);
    if (!rows[0]) throw NotFound("Document");
    await recordAudit(db, ctx, { action: "vehicle.document_removed", entityType: "vehicle", entityId: rows[0].vehicle_id, after: { documentId } });
  }, { actorId: auth.user.id });
}

