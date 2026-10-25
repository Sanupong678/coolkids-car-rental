import "./setup.js";
import { deflateSync, crc32 } from "node:zlib";
import { pool } from "../src/db/pool.js";
import { migrate } from "../src/db/migrate.js";
import { seed } from "../src/db/seed.js";

/** Rebuilds the test database from migrations + seed. */
export async function resetDatabase() {
  await pool.query("DROP SCHEMA IF EXISTS dw CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate({ log: () => {} });
  await seed();
}

/** Fake identity provider: the "code" is a JSON profile, so tests choose who signs in. */
export function fakeProvider() {
  return {
    name: "google",
    async createAuthRequest({ state }) {
      return { url: `https://accounts.example/auth?state=${state}`, codeVerifier: "verifier" };
    },
    async exchangeCode({ code }) {
      const p = JSON.parse(code);
      return { subject: p.sub, email: p.email, emailVerified: true, name: p.name ?? "Test User", picture: null };
    },
  };
}

export const ORIGIN = "http://localhost:5173";

/** Runs the full OAuth round trip against the app and returns the session cookie. */
export async function signIn(agent, profile) {
  const start = await agent.get("/api/v1/auth/google?returnTo=/vehicles").expect(302);
  const state = new URL(start.headers.location).searchParams.get("state");
  const res = await agent
    .get(`/api/v1/auth/google/callback?code=${encodeURIComponent(JSON.stringify(profile))}&state=${state}`)
    .expect(302);
  return res;
}

export async function fixtureIds(db = pool) {
  const one = async (sql) => (await db.query(sql)).rows[0].id;
  return {
    vehicleId: await one("SELECT id FROM vehicles WHERE slug LIKE 'porsche-911%'"),
    locationId: await one("SELECT id FROM locations WHERE code = 'BKK-HQ'"),
  };
}

export async function createUser(db, email) {
  const { rows } = await db.query(
    "INSERT INTO users (email, full_name) VALUES ($1, 'Fixture User') RETURNING id", [email],
  );
  return rows[0].id;
}

/**
 * Minimal booking insert mirroring what the booking service will do:
 * booking row + availability block (incl. turnaround) in one transaction.
 */
export async function insertBooking(db, { userId, vehicleId, locationId, from, to }) {
  const { rows } = await db.query(
    `INSERT INTO bookings (user_id, vehicle_id, pickup_location_id, return_location_id, pickup_at, return_at,
       hold_expires_at, currency, rental_days, subtotal_minor, total_minor, pricing_snapshot)
     VALUES ($1, $2, $3, $3, $4, $5, now() + interval '15 minutes', 'USD', 1, 1000, 1000, '{}')
     RETURNING id`,
    [userId, vehicleId, locationId, from, to],
  );
  const bookingId = rows[0].id;
  await db.query(
    `INSERT INTO vehicle_availability_blocks (vehicle_id, block_type, during, booking_id)
     SELECT $1, 'BOOKING', tstzrange($2::timestamptz, $3::timestamptz + make_interval(mins => v.turnaround_minutes), '[)'), $4
       FROM vehicles v WHERE v.id = $1`,
    [vehicleId, from, to, bookingId],
  );
  return bookingId;
}

/** A valid white PNG; a different width gives a different file (and hash). */
export function tinyPng(width = 40) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(20, 4);
  ihdr[8] = 8;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.alloc((width + 1) * 20, 255))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * LINE review flow up to payment: driver 1's photos, submit, staff approve.
 * `admin` is an agent signed in with bookings:write + users:read_sensitive.
 */
export async function approveBooking(customer, admin, booking) {
  for (const kind of booking.documents.required) {
    await customer.put(`/api/v1/bookings/${booking.number}/documents/${kind}`).set("Origin", ORIGIN).set("Content-Type", "image/png")
      .send(tinyPng(30 + booking.documents.required.indexOf(kind))).expect(200);
  }
  await customer.post(`/api/v1/bookings/${booking.number}/submit`).set("Origin", ORIGIN).send({}).expect(200);
  const res = await admin.post(`/api/v1/admin/bookings/${booking.id}/review`).set("Origin", ORIGIN).send({ decision: "approve" }).expect(200);
  return res.body.data;
}
