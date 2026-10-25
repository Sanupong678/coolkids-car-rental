import { pool, withTransaction } from "../../db/pool.js";
import { BadRequest, Conflict, NotFound } from "../../shared/errors.js";
import { distanceMeters, minutesToDrive } from "../../shared/geo.js";
import { getSettings } from "../../shared/settings.js";
import { recordAudit } from "../audit/audit.service.js";
import { navigationUrl, notify } from "../bookings/bookings.service.js";
import { signatureDataUrl } from "../contracts/contracts.service.js";

// Dispatch planning for the dashboard: the month calendar of hand-overs, one
// day's jobs with their drivers, who is free, where each driver is now, and the
// data the printable contract needs. Status changes stay in operations.service.

const TZ = "Asia/Bangkok";
// Bookings that still need (or needed) a car handed over on their pick-up day.
const HANDOVER = "('CONFIRMED','PREPARING','READY','IN_DELIVERY','ACTIVE','COMPLETED')";
const OPEN = "('CONFIRMED','PREPARING','READY','IN_DELIVERY')";

const JOB_SELECT = `
  SELECT b.id, b.booking_number, b.status, b.pickup_at, b.return_at, b.rental_days, b.fulfillment_type,
         b.delivery_address, b.delivery_distance_m, b.delivery_duration_s, b.delivery_eta_at, b.delivered_at,
         b.total_minor, b.currency,
         v.brand, v.model, v.license_plate,
         ci.legal_full_name, ci.phone AS customer_phone,
         l.name AS branch_name, l.latitude::float AS branch_lat, l.longitude::float AS branch_lng,
         a.id AS assignment_id, a.status AS assignment_status, a.staff_id, a.created_at AS assigned_at,
         su.full_name AS staff_name, su.avatar_url AS staff_avatar, s.phone AS staff_phone
    FROM bookings b
    JOIN vehicles v ON v.id = b.vehicle_id
    JOIN locations l ON l.id = b.pickup_location_id
    LEFT JOIN customer_identities ci ON ci.id = b.customer_identity_id
    LEFT JOIN delivery_assignments a ON a.booking_id = b.id AND a.assignment_type = 'DELIVERY' AND a.status NOT IN ('FAILED','CANCELLED')
    LEFT JOIN staff s ON s.id = a.staff_id
    LEFT JOIN users su ON su.id = s.user_id`;

const jobDto = (r) => ({
  id: r.id,
  number: r.booking_number,
  status: r.status,
  pickupAt: r.pickup_at,
  returnAt: r.return_at,
  rentalDays: r.rental_days,
  fulfillment: r.fulfillment_type,
  vehicle: { brand: r.brand, model: r.model, plate: r.license_plate },
  customer: { fullName: r.legal_full_name, phone: r.customer_phone },
  branch: { name: r.branch_name, lat: r.branch_lat, lng: r.branch_lng },
  destination:
    r.fulfillment_type === "DELIVERY"
      ? {
          address: r.delivery_address?.address, notes: r.delivery_address?.notes,
          lat: r.delivery_address?.lat ?? null, lng: r.delivery_address?.lng ?? null,
          distanceMeters: r.delivery_distance_m, durationSeconds: r.delivery_duration_s, etaAt: r.delivery_eta_at,
          mapsUrl: navigationUrl({ lat: r.branch_lat, lng: r.branch_lng }, r.delivery_address),
        }
      : { address: r.branch_name, lat: r.branch_lat, lng: r.branch_lng },
  delivered: ["ACTIVE", "COMPLETED"].includes(r.status),
  driver: r.staff_id
    ? {
        staffId: r.staff_id, name: r.staff_name, phone: r.staff_phone, avatarUrl: r.staff_avatar,
        assignmentStatus: r.assignment_status, assignedAt: r.assigned_at,
      }
    : null,
  totalMinor: Number(r.total_minor),
  currency: r.currency,
});

/** Hand-overs per Bangkok day for one month ("2026-10"), each with its jobs. */
export async function calendar(month) {
  const from = `${month}-01`;
  const { rows } = await pool.query(
    `${JOB_SELECT}
      WHERE b.deleted_at IS NULL AND b.status IN ${HANDOVER}
        AND (b.pickup_at AT TIME ZONE '${TZ}')::date >= $1::date
        AND (b.pickup_at AT TIME ZONE '${TZ}')::date < ($1::date + interval '1 month')
      ORDER BY b.pickup_at`,
    [from],
  );
  const days = {};
  for (const r of rows) {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(r.pickup_at);
    (days[day] ??= []).push(jobDto(r));
  }
  return { month, days };
}

/** Today's numbers for the dashboard header. */
export async function summary() {
  const { rows } = await pool.query(
    `SELECT
       count(*) FILTER (WHERE (pickup_at AT TIME ZONE '${TZ}')::date = (now() AT TIME ZONE '${TZ}')::date
                          AND status IN ${HANDOVER})::int AS today_total,
       count(*) FILTER (WHERE (pickup_at AT TIME ZONE '${TZ}')::date = (now() AT TIME ZONE '${TZ}')::date
                          AND status IN ${OPEN})::int AS today_open,
       count(*) FILTER (WHERE pickup_at < now() AND status IN ${OPEN})::int AS overdue
       FROM bookings WHERE deleted_at IS NULL`,
  );
  return rows[0];
}

/** Every active staff member, their latest position and their open jobs on `date`. */
export async function staffBoard(date) {
  const { rows } = await pool.query(
    `SELECT s.id, s.employee_code, s.job_title, s.phone, u.full_name, u.avatar_url,
            loc.latitude::float AS lat, loc.longitude::float AS lng, loc.accuracy_m, loc.recorded_at,
            COALESCE((SELECT json_agg(json_build_object('bookingId', a.booking_id, 'status', a.status, 'scheduledAt', a.scheduled_at)
                                      ORDER BY a.scheduled_at)
                        FROM delivery_assignments a
                       WHERE a.staff_id = s.id AND a.status NOT IN ('FAILED','CANCELLED','DELIVERED')
                         AND (a.scheduled_at AT TIME ZONE '${TZ}')::date = $1::date), '[]') AS jobs,
            EXISTS (SELECT 1 FROM delivery_assignments a
                     WHERE a.staff_id = s.id AND a.status IN ('VEHICLE_PICKED_UP','EN_ROUTE','ARRIVING')) AS on_the_road
       FROM staff s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN staff_locations loc ON loc.staff_id = s.id
      WHERE s.deleted_at IS NULL AND s.status = 'ACTIVE'
      ORDER BY on_the_road, u.full_name`,
    [date],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.full_name,
    code: r.employee_code,
    title: r.job_title,
    phone: r.phone,
    avatarUrl: r.avatar_url,
    location: r.lat != null ? { lat: r.lat, lng: r.lng, accuracyM: r.accuracy_m, at: r.recorded_at } : null,
    jobs: r.jobs,
    onTheRoad: r.on_the_road,
  }));
}

/** Puts a driver on a delivery job (replacing the previous driver, if any). */
export async function assignDriver(auth, bookingId, staffId, ctx) {
  return withTransaction(
    async (db) => {
      const { rows } = await db.query("SELECT * FROM bookings WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [bookingId]);
      const b = rows[0];
      if (!b) throw NotFound("Booking");
      if (b.fulfillment_type !== "DELIVERY") throw BadRequest("This booking is a branch pick-up");
      if (!["CONFIRMED", "PREPARING", "READY"].includes(b.status)) throw BadRequest(`Cannot assign a driver to a ${b.status} booking`);
      const { rows: staff } = await db.query("SELECT id FROM staff WHERE id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL", [staffId]);
      if (!staff[0]) throw NotFound("Staff");

      const { rows: prev } = await db.query(
        `UPDATE delivery_assignments SET status = 'CANCELLED', failure_reason = 'Reassigned'
          WHERE booking_id = $1 AND assignment_type = 'DELIVERY' AND status NOT IN ('FAILED','CANCELLED','DELIVERED')
          RETURNING staff_id`,
        [b.id],
      );
      const { rows: a } = await db.query(
        `INSERT INTO delivery_assignments (booking_id, staff_id, vehicle_id, assignment_type, status, origin_location_id,
           destination, scheduled_at, assigned_by)
         VALUES ($1, $2, $3, 'DELIVERY', 'ASSIGNED', $4, $5, $6, $7) RETURNING id`,
        [b.id, staffId, b.vehicle_id, b.pickup_location_id, JSON.stringify(b.delivery_address), b.pickup_at, auth.user.id],
      );
      await recordAudit(db, ctx, {
        action: "delivery.assigned", entityType: "booking", entityId: b.id,
        before: { staffId: prev[0]?.staff_id ?? null }, after: { staffId },
      });
      return { assignmentId: a[0].id, staffId };
    },
    { actorId: auth.user.id },
  );
}

/** The signed-in staff member's own staff id (null for accounts without a staff profile). */
export async function myStaffId(auth) {
  const { rows } = await pool.query("SELECT id FROM staff WHERE user_id = $1 AND deleted_at IS NULL", [auth.user.id]);
  return rows[0]?.id ?? null;
}

/** A driver takes an open delivery job for themself ("รับงาน"). */
export async function acceptJob(auth, bookingId, ctx) {
  const staffId = await myStaffId(auth);
  if (!staffId) throw BadRequest("This account has no staff profile");
  return assignDriver(auth, bookingId, staffId, ctx);
}

/**
 * The signed-in staff member's phone/browser reports where it is. While the
 * driver is on a trip this streams every ~15 s (frontend tripTracking), leaves a
 * breadcrumb on the trip and alerts the customer when the car is near / has arrived.
 */
export async function updateMyLocation(auth, { lat, lng, accuracy, speed, heading }) {
  const { rows } = await pool.query("SELECT id FROM staff WHERE user_id = $1 AND deleted_at IS NULL", [auth.user.id]);
  if (!rows[0]) throw BadRequest("This account has no staff profile");
  const staffId = rows[0].id;
  await pool.query(
    `INSERT INTO staff_locations (staff_id, latitude, longitude, accuracy_m, recorded_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (staff_id) DO UPDATE SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
            accuracy_m = EXCLUDED.accuracy_m, recorded_at = now()`,
    [staffId, lat, lng, accuracy == null ? null : Math.round(accuracy)],
  );
  // A driver on a trip also leaves a breadcrumb on that trip.
  const speedKmh = speed == null ? null : Math.round(speed * 36) / 10; // browsers report m/s
  await pool.query(
    `INSERT INTO delivery_tracking (assignment_id, event_type, latitude, longitude, speed_kmh, heading_deg, recorded_by)
     SELECT id, 'LOCATION', $2, $3, $4, $5, $1 FROM delivery_assignments
      WHERE staff_id = $1 AND status IN ('VEHICLE_PICKED_UP','EN_ROUTE','ARRIVING')`,
    [staffId, lat, lng, speedKmh, heading == null ? null : Math.round(heading) % 360],
  );
  const alerts = await alertCustomers(staffId, { lat, lng, accuracy, speedKmh });
  return { staffId, alerts };
}

// The customer hears "almost there" inside NEAR_M and "arrived" inside ARRIVED_M.
// Fixes vaguer than MAX_ACCURACY_M (indoors, no GPS lock) never trigger an alert.
export const NEAR_M = 2000;
export const ARRIVED_M = 150;
const MAX_ACCURACY_M = 300;

const TRIP_SELECT = `
  SELECT b.id, b.user_id, b.booking_number, b.delivery_address, b.delivery_near_notified_at, b.delivery_arrived_notified_at,
         v.brand, v.model, v.license_plate, a.id AS assignment_id, u.full_name AS driver_name, s.phone AS driver_phone
    FROM delivery_assignments a
    JOIN bookings b ON b.id = a.booking_id
    JOIN vehicles v ON v.id = b.vehicle_id
    JOIN staff s ON s.id = a.staff_id
    JOIN users u ON u.id = s.user_id`;

const carText = (t) => `${t.brand} ${t.model} ทะเบียน ${t.license_plate}`;
const driverText = (t) => [t.driver_name && `คนขับ ${t.driver_name}`, t.driver_phone && `โทร ${t.driver_phone}`].filter(Boolean).join(" ");

/** Sends the "arrived" alert once per booking (driver's GPS, or the driver's own button). */
async function notifyArrived(db, t, staffId) {
  const { rowCount } = await db.query(
    `UPDATE bookings SET delivery_arrived_notified_at = now(), delivery_near_notified_at = COALESCE(delivery_near_notified_at, now())
      WHERE id = $1 AND delivery_arrived_notified_at IS NULL`,
    [t.id],
  );
  if (!rowCount) return false;
  await db.query("UPDATE delivery_assignments SET status = 'ARRIVING' WHERE id = $1 AND status = 'EN_ROUTE'", [t.assignment_id]);
  await db.query("INSERT INTO delivery_tracking (assignment_id, event_type, status, recorded_by) VALUES ($1, 'STATUS', 'ARRIVED', $2)", [
    t.assignment_id, staffId,
  ]);
  await notify(db, t.user_id, {
    type: "DELIVERY_ARRIVED", bookingId: t.id,
    title: "รถถึงจุดส่งแล้ว",
    body: `${carText(t)} ถึงที่หมายแล้ว ${driverText(t)}`.trim(),
  });
  return true;
}

async function alertCustomers(staffId, { lat, lng, accuracy, speedKmh }) {
  if (accuracy != null && accuracy > MAX_ACCURACY_M) return [];
  const { rows } = await pool.query(
    `${TRIP_SELECT} WHERE a.staff_id = $1 AND a.status IN ('EN_ROUTE','ARRIVING') AND b.status = 'IN_DELIVERY'
        AND b.delivery_arrived_notified_at IS NULL`,
    [staffId],
  );
  const sent = [];
  for (const t of rows) {
    const dest = t.delivery_address;
    if (dest?.lat == null || dest?.lng == null) continue;
    const meters = distanceMeters({ lat, lng }, dest);
    if (meters <= ARRIVED_M) {
      if (await withTransaction((db) => notifyArrived(db, t, staffId))) sent.push({ booking: t.booking_number, alert: "arrived" });
    } else if (meters <= NEAR_M && !t.delivery_near_notified_at) {
      const first = await withTransaction(async (db) => {
        const { rowCount } = await db.query(
          "UPDATE bookings SET delivery_near_notified_at = now() WHERE id = $1 AND delivery_near_notified_at IS NULL",
          [t.id],
        );
        if (!rowCount) return false;
        await db.query("UPDATE delivery_assignments SET status = 'ARRIVING' WHERE id = $1 AND status = 'EN_ROUTE'", [t.assignment_id]);
        await notify(db, t.user_id, {
          type: "DELIVERY_NEAR", bookingId: t.id,
          title: "รถใกล้ถึงแล้ว",
          body: `${carText(t)} อีกประมาณ ${minutesToDrive(meters, speedKmh)} นาทีจะถึง กรุณาเตรียมตัวรับรถ`,
        });
        return true;
      });
      if (first) sent.push({ booking: t.booking_number, alert: "near" });
    }
  }
  return sent;
}

/** The driver's "แจ้งลูกค้าว่าถึงแล้ว" button, for when GPS never got close enough (basement, bad signal). */
export async function markArrived(auth, bookingId, ctx) {
  return withTransaction(
    async (db) => {
      const { rows: b } = await db.query("SELECT status FROM bookings WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [bookingId]);
      if (!b[0]) throw NotFound("Booking");
      if (b[0].status !== "IN_DELIVERY") throw Conflict("NOT_IN_DELIVERY", "This car is not on the way");
      const { rows } = await db.query(
        `${TRIP_SELECT} WHERE b.id = $1 AND a.assignment_type = 'DELIVERY' AND a.status NOT IN ('FAILED','CANCELLED','DELIVERED')
          ORDER BY a.created_at DESC LIMIT 1`,
        [bookingId],
      );
      if (!rows[0]) throw NotFound("Delivery");
      const notified = await notifyArrived(db, rows[0], await myStaffId(auth));
      if (notified) await recordAudit(db, ctx, { action: "delivery.arrived", entityType: "booking", entityId: bookingId });
      return { notified };
    },
    { actorId: auth.user.id },
  );
}

/**
 * Everything the printed rental agreement shows, as raw values so the page can
 * render it in Thai, English or Chinese. Document numbers come from the
 * contract snapshot, which only ever holds them masked.
 */
export async function contractPrint(bookingId) {
  const { rows } = await pool.query(
    `SELECT b.*, v.brand, v.model, v.trim, v.license_plate, v.fuel_type,
            l.name AS branch_name, l.city AS branch_city,
            ct.id AS contract_id, ct.contract_number, ct.status AS contract_status, ct.data_snapshot, ct.signed_at,
            ct.signature_media_id, ct.created_at AS contract_created_at,
            (SELECT COALESCE(sum(amount_minor), 0) FROM booking_items WHERE booking_id = b.id AND item_type = 'RENTAL') AS rental_minor,
            (SELECT COALESCE(sum(amount_minor), 0) FROM booking_items WHERE booking_id = b.id AND item_type = 'DELIVERY_FEE') AS delivery_minor,
            (SELECT COALESCE(-sum(amount_minor), 0) FROM booking_items WHERE booking_id = b.id AND item_type = 'DISCOUNT') AS discount_minor
       FROM bookings b
       JOIN vehicles v ON v.id = b.vehicle_id
       JOIN locations l ON l.id = b.pickup_location_id
       LEFT JOIN contracts ct ON ct.booking_id = b.id AND ct.status IN ('ISSUED','SIGNED')
      WHERE b.id = $1 AND b.deleted_at IS NULL`,
    [bookingId],
  );
  const r = rows[0];
  if (!r) throw NotFound("Booking");
  const settings = await getSettings();
  const snap = r.data_snapshot ?? {};
  return {
    company: settings["company.legal"] ?? snap.company ?? null,
    bookingNumber: r.booking_number,
    contract: r.contract_number
      ? { number: r.contract_number, status: r.contract_status, issuedAt: r.contract_created_at, signedAt: r.signed_at }
      : null,
    renter: {
      fullName: snap.renter?.fullName ?? null,
      address: snap.renter?.address ?? null,
      phone: snap.renter?.phone ?? null,
      idType: snap.renter?.idDocLabel?.includes("Passport") ? "PASSPORT" : "NATIONAL_ID",
      idMasked: snap.renter?.idDocMasked ?? null,
      licenseMasked: snap.renter?.licenseMasked ?? null,
    },
    vehicle: { make: r.brand, model: [r.model, r.trim].filter(Boolean).join(" "), plate: r.license_plate, fuel: r.fuel_type },
    rental: {
      pickupAt: r.pickup_at,
      returnAt: r.return_at,
      days: r.rental_days,
      fulfillment: r.fulfillment_type,
      area: r.area_of_use ?? (r.fulfillment_type === "DELIVERY" ? r.delivery_address?.address : `${r.branch_name}, ${r.branch_city}`),
      purpose: r.rental_purpose === "REPLACEMENT" ? "replacement" : r.rental_purpose === "TRAVEL" ? "travel" : null,
      executedAt: r.branch_name,
    },
    // Bookings can only be made after both licence declarations are answered "yes".
    declared: Boolean(snap.declarations),
    money: {
      currency: r.currency,
      rentalMinor: Number(r.rental_minor),
      deliveryMinor: Number(r.delivery_minor),
      discountMinor: Number(r.discount_minor),
      depositMinor: Number(r.deposit_minor),
      totalMinor: Number(r.total_minor),
    },
    signature: await signatureDataUrl(pool, r.signature_media_id),
  };
}
