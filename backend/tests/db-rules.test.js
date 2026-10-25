// Business rules the database itself must enforce, independent of the API.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createUser, fixtureIds, insertBooking, resetDatabase } from "./helpers.js";
import { pool, withTransaction } from "../src/db/pool.js";

let ids;
let userId;

before(async () => {
  await resetDatabase();
  ids = await fixtureIds();
  userId = await createUser(pool, "renter@example.com");
});
after(() => pool.end());

const book = (from, to) => withTransaction((db) => insertBooking(db, { userId, ...ids, from, to }));
const pgCode = (code) => (err) => err.code === code;

describe("double booking prevention", () => {
  test("overlapping booking on the same vehicle is rejected", async () => {
    await book("2030-01-10T10:00Z", "2030-01-15T10:00Z");
    await assert.rejects(book("2030-01-14T10:00Z", "2030-01-18T10:00Z"), pgCode("23P01"));
  });

  test("turnaround buffer is enforced after return", async () => {
    // Porsche turnaround = 120 min → returning 10:00 blocks until 12:00.
    await assert.rejects(book("2030-01-15T11:00Z", "2030-01-16T10:00Z"), pgCode("23P01"));
    await book("2030-01-15T12:00Z", "2030-01-16T10:00Z");
  });

  test("concurrent requests for the same slot: exactly one wins", async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, () => book("2030-03-01T10:00Z", "2030-03-03T10:00Z")),
    );
    assert.equal(attempts.filter((a) => a.status === "fulfilled").length, 1);
    assert.ok(attempts.filter((a) => a.status === "rejected").every((a) => a.reason.code === "23P01"));
  });

  test("cancelling releases the slot (business rule 3)", async () => {
    const id = await book("2030-04-01T10:00Z", "2030-04-02T10:00Z");
    await pool.query("UPDATE bookings SET status = 'CANCELLED' WHERE id = $1", [id]);
    await book("2030-04-01T10:00Z", "2030-04-02T10:00Z");
    const { rows } = await pool.query("SELECT released_at FROM vehicle_availability_blocks WHERE booking_id = $1", [id]);
    assert.ok(rows[0].released_at, "block kept for history but released");
  });

  test("return before pickup is rejected", async () => {
    await assert.rejects(book("2030-05-02T10:00Z", "2030-05-01T10:00Z"));
  });
});

describe("booking state machine", () => {
  test("invalid transitions are rejected and valid ones recorded in history", async () => {
    const id = await book("2030-06-01T10:00Z", "2030-06-02T10:00Z");
    await assert.rejects(pool.query("UPDATE bookings SET status = 'COMPLETED' WHERE id = $1", [id]), /Invalid booking status transition/);
    await withTransaction(async (db) => {
      await db.query("SELECT set_config('app.status_reason', 'customer request', true)");
      await db.query("UPDATE bookings SET status = 'CANCELLED' WHERE id = $1", [id]);
    }, { actorId: userId });
    const { rows } = await pool.query(
      "SELECT from_status, to_status, changed_by, reason FROM booking_status_history WHERE booking_id = $1 ORDER BY id", [id],
    );
    assert.deepEqual(rows, [
      { from_status: null, to_status: "PENDING", changed_by: null, reason: null },
      { from_status: "PENDING", to_status: "CANCELLED", changed_by: userId, reason: "customer request" },
    ]);
  });

  test("a booking cannot be confirmed without customer identification", async () => {
    const id = await book("2030-07-01T10:00Z", "2030-07-02T10:00Z");
    await assert.rejects(pool.query("UPDATE bookings SET status = 'CONFIRMED' WHERE id = $1", [id]), pgCode("23514"));
  });
});

describe("maintenance", () => {
  test("scheduled maintenance blocks bookings; running maintenance flips vehicle status", async () => {
    const { rows } = await pool.query(
      `INSERT INTO maintenance_records (vehicle_id, maintenance_type, scheduled_start, scheduled_end)
       VALUES ($1, 'OIL_CHANGE', '2030-08-01T00:00Z', '2030-08-02T00:00Z') RETURNING id`, [ids.vehicleId],
    );
    await assert.rejects(book("2030-08-01T10:00Z", "2030-08-03T10:00Z"), pgCode("23P01"));

    await pool.query("UPDATE maintenance_records SET status = 'IN_PROGRESS', started_at = now() WHERE id = $1", [rows[0].id]);
    assert.equal((await pool.query("SELECT status FROM vehicles WHERE id = $1", [ids.vehicleId])).rows[0].status, "MAINTENANCE");

    await pool.query("UPDATE maintenance_records SET status = 'COMPLETED', completed_at = now() WHERE id = $1", [rows[0].id]);
    assert.equal((await pool.query("SELECT status FROM vehicles WHERE id = $1", [ids.vehicleId])).rows[0].status, "ACTIVE");
    await book("2030-08-01T10:00Z", "2030-08-03T10:00Z"); // slot is free again
  });
});

describe("history protection", () => {
  test("vehicles cannot be hard-deleted", async () => {
    await assert.rejects(pool.query("DELETE FROM vehicles WHERE id = $1", [ids.vehicleId]), /soft delete/);
  });

  test("audit log is immutable", async () => {
    await pool.query("INSERT INTO audit_logs (action, entity_type, entity_id) VALUES ('test.event', 'test', '1')");
    await assert.rejects(pool.query("UPDATE audit_logs SET action = 'x.y'"), /append-only/);
    await assert.rejects(pool.query("DELETE FROM audit_logs"), /append-only/);
  });

  test("price changes are captured in price history with the actor", async () => {
    const admin = await createUser(pool, "pricing-admin@example.com");
    await withTransaction(
      (db) => db.query("UPDATE vehicles SET daily_rate_minor = 47000 WHERE id = $1", [ids.vehicleId]),
      { actorId: admin },
    );
    const { rows } = await pool.query(
      "SELECT daily_rate_minor, changed_by FROM vehicle_price_history WHERE vehicle_id = $1 ORDER BY id DESC LIMIT 1", [ids.vehicleId],
    );
    assert.deepEqual(rows[0], { daily_rate_minor: 47000, changed_by: admin });
  });

  test("odometer cannot go backwards", async () => {
    await pool.query("INSERT INTO vehicle_mileage (vehicle_id, reading_km, reading_type) VALUES ($1, 12000, 'MANUAL')", [ids.vehicleId]);
    await assert.rejects(
      pool.query("INSERT INTO vehicle_mileage (vehicle_id, reading_km, reading_type) VALUES ($1, 11000, 'RETURN')", [ids.vehicleId]),
      /below current/,
    );
  });

  test("negative prices are rejected", async () => {
    await assert.rejects(pool.query("UPDATE vehicles SET daily_rate_minor = -1 WHERE id = $1", [ids.vehicleId]), pgCode("23514"));
  });
});
