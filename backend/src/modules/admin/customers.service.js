import { pool, withTransaction } from "../../db/pool.js";
import { NotFound } from "../../shared/errors.js";
import { recordAudit } from "../audit/audit.service.js";
import { DRAFT_REPLACED, writeIdentity } from "../bookings/bookings.service.js";
import { bookingDefaults } from "../users/users.service.js";

// Back-office address book ("สมุดรายชื่อ"): everyone who has booked, how often, and
// their saved details, so staff booking for a regular customer pick them instead of
// typing everything again. Full ID / licence numbers are only in the detail (audited).

// LINE / walk-in accounts get a made-up address: not one to show or e-mail.
const realEmail = (e) => (e && !/@(line\.coolkids\.invalid|walkin\.coolkids\.local|coolkids\.local)$/i.test(e) ? e : null);

export async function listCustomers() {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.full_name, u.phone, u.created_at,
            ci.legal_full_name, ci.phone AS identity_phone,
            count(b.id) FILTER (WHERE b.status NOT IN ('EXPIRED','CANCELLED','REFUNDED'))::int AS bookings,
            count(b.id) FILTER (WHERE b.status = 'COMPLETED')::int AS completed,
            count(b.id) FILTER (WHERE b.status IN ('CANCELLED','REFUNDED') AND b.cancellation_reason IS DISTINCT FROM $1)::int AS cancelled,
            max(b.pickup_at) AS last_pickup_at,
            max(b.created_at) AS last_booked_at,
            EXISTS (SELECT 1 FROM user_identities i WHERE i.user_id = u.id AND i.provider = 'line') AS on_line
       FROM users u
       JOIN bookings b ON b.user_id = u.id AND b.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT legal_full_name, phone FROM customer_identities
          WHERE user_id = u.id AND deleted_at IS NULL ORDER BY is_current DESC, created_at DESC LIMIT 1
       ) ci ON true
      WHERE u.deleted_at IS NULL
      GROUP BY u.id, ci.legal_full_name, ci.phone
     -- someone whose only bookings were abandoned holds (expired / replaced drafts) is left out
     HAVING count(b.id) FILTER (WHERE b.status <> 'EXPIRED' AND b.cancellation_reason IS DISTINCT FROM $1) > 0
      ORDER BY max(b.created_at) DESC
      LIMIT 2000`,
    [DRAFT_REPLACED],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.legal_full_name ?? r.full_name ?? "—",
    phone: r.identity_phone ?? r.phone,
    email: realEmail(r.email),
    onLine: r.on_line,
    bookings: r.bookings,
    completed: r.completed,
    cancelled: r.cancelled,
    lastPickupAt: r.last_pickup_at,
    lastBookedAt: r.last_booked_at,
  }));
}

/** One customer: saved details (full numbers) for the booking form, and their bookings. */
export async function customerDetail(staff, id, ctx) {
  const { rows: u } = await pool.query("SELECT id, email, full_name, phone, created_at FROM users WHERE id = $1 AND deleted_at IS NULL", [id]);
  if (!u[0]) throw NotFound("Customer");
  const [saved, { rows: bookings }] = await Promise.all([
    bookingDefaults(id, { includeStaff: true }),
    pool.query(
      `SELECT b.booking_number, b.status, b.pickup_at, b.return_at, b.total_minor, b.currency, b.created_by_staff IS NOT NULL AS by_staff,
              v.brand, v.model, v.license_plate
         FROM bookings b JOIN vehicles v ON v.id = b.vehicle_id
        WHERE b.user_id = $1 AND b.deleted_at IS NULL AND b.cancellation_reason IS DISTINCT FROM $2
        ORDER BY b.pickup_at DESC LIMIT 100`,
      [id, DRAFT_REPLACED],
    ),
  ]);
  await recordAudit(pool, ctx, { action: "customer.viewed", entityType: "user", entityId: id });
  return {
    id,
    email: realEmail(u[0].email),
    name: saved.customer?.fullName ?? u[0].full_name,
    phone: saved.customer?.phone ?? u[0].phone,
    since: u[0].created_at,
    customer: saved.customer,
    rental: saved.rental,
    bookings: bookings.map((b) => ({
      number: b.booking_number, status: b.status, pickupAt: b.pickup_at, returnAt: b.return_at,
      totalMinor: Number(b.total_minor), currency: b.currency, byStaff: b.by_staff,
      car: [b.brand, b.model, b.license_plate].filter(Boolean).join(" "),
    })),
  };
}

/**
 * Staff correct a customer's details: a new identity version (bookings already made keep
 * the version they were made with; photos carry over when the numbers stay the same).
 */
export async function updateCustomer(staff, id, c, ctx) {
  await withTransaction(
    async (db) => {
      const { rows } = await db.query("SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [id]);
      if (!rows[0]) throw NotFound("Customer");
      const { rows: cur } = await db.query(
        "SELECT id FROM customer_identities WHERE user_id = $1 AND deleted_at IS NULL ORDER BY is_current DESC, created_at DESC LIMIT 1",
        [id],
      );
      await writeIdentity(db, id, c, cur[0]?.id ?? null);
      await db.query("UPDATE users SET full_name = $2, phone = $3 WHERE id = $1", [id, c.fullName, c.phone]);
      await recordAudit(db, ctx, { action: "customer.updated", entityType: "user", entityId: id, after: { fullName: c.fullName, phone: c.phone } });
    },
    { actorId: staff.user.id },
  );
  return customerDetail(staff, id, ctx);
}
