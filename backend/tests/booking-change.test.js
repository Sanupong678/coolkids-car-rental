import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { fakeProvider, ORIGIN, resetDatabase, tinyPng } from "./helpers.js";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { seedCoolkids } from "../src/db/seed-coolkids.js";
import { seedAdmin } from "../src/db/seed-admin.js";

// "เปลี่ยนรถ / เปลี่ยนวัน" (same booking, payments kept, difference shown) and
// "จองเพิ่ม" (another car on the same bill, confirmed at once, no reservation fee).
const app = createApp({ identityProvider: fakeProvider() });
const CITY = "honda-city-e-hev-black-outshine-2026"; // ฿1,290/day
const ACCORD = "honda-accord-e-hev-el-plus-2025"; // ฿2,800/day
const ALMERA = "nissan-almera-2022"; // ฿990/day
const CAMRY = "toyota-camry-hev-premium-2025";

const inDays = (n, hour = 10) => {
  const d = new Date(Date.now() + n * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};
const customer = (phone) => ({
  fullName: "Mana Rakdee", phone, countryCode: "TH", idType: "NATIONAL_ID", idNumber: "3101234567890",
  dateOfBirth: "1988-03-12", licenseNumber: "DL445566", licenseCountry: "TH", licenseExpiry: "2032-01-01", address: "1 ถนนวิภาวดี กรุงเทพฯ",
});
const body = (o = {}) => ({
  vehicleSlug: CITY, pickupAt: inDays(10), returnAt: inDays(13), fulfillment: "BRANCH_PICKUP",
  customer: customer("0891112222"), declarations: { hasOriginalLicense: true, infoMatchesLicense: true }, ...o,
});

const admin = request.agent(app);
async function confirmedBooking(o, paidMinor = 100_000) {
  const res = await admin.post("/api/v1/admin/bookings").set("Origin", ORIGIN).send(body(o)).expect(201);
  const n = res.body.data.number;
  for (const [i, kind] of ["id_front", "license_front"].entries()) {
    await admin.put(`/api/v1/bookings/${n}/documents/${kind}`).set("Origin", ORIGIN).set("Content-Type", "image/png").send(tinyPng(60 + i)).expect(200);
  }
  await admin.post(`/api/v1/admin/bookings/${n}/confirm-offline`).set("Origin", ORIGIN).send({ paidMinor, method: "transfer" }).expect(200);
  return n;
}

before(async () => {
  await resetDatabase();
  await seedCoolkids();
  await seedAdmin({ login: "admin", password: "1234" });
  await admin.post("/api/v1/auth/login").set("Origin", ORIGIN).send({ login: "admin", password: "1234" }).expect(204);
});
after(() => pool.end());

describe("เปลี่ยนรถ / เปลี่ยนวัน", () => {
  let number;
  before(async () => {
    number = await confirmedBooking();
  });

  test("the quote shows the difference against what was paid; applying it keeps the number and the payment", async () => {
    const q = (await admin.post(`/api/v1/admin/bookings/${number}/change/quote`).set("Origin", ORIGIN).send({ vehicleSlug: ACCORD }).expect(200)).body.data;
    assert.equal(q.swapped, true);
    assert.equal(q.available, true);
    assert.ok(q.differenceMinor > 0, "a dearer car costs more");
    assert.equal(q.differenceMinor, q.after.totalMinor - q.before.totalMinor);
    assert.equal(q.paidMinor, 100_000);
    assert.equal(q.leftToCollectMinor, q.after.totalMinor - 100_000);

    const b = (await admin.post(`/api/v1/admin/bookings/${number}/change`).set("Origin", ORIGIN).send({ vehicleSlug: ACCORD }).expect(200)).body.data;
    assert.equal(b.number, number);
    assert.equal(b.vehicle.slug, ACCORD);
    assert.equal(b.money.totalMinor, q.after.totalMinor);
    assert.equal(b.money.depositMinor, q.after.depositMinor);
    const { rows } = await pool.query(
      `SELECT v.slug, (SELECT count(*) FROM payments p WHERE p.booking_id = b.id AND p.status = 'SUCCEEDED')::int AS paid
         FROM vehicle_availability_blocks k JOIN vehicles v ON v.id = k.vehicle_id JOIN bookings b ON b.id = k.booking_id
        WHERE b.booking_number = $1 AND k.released_at IS NULL`,
      [number],
    );
    assert.deepEqual(rows, [{ slug: ACCORD, paid: 1 }], "the car hold moved to the new car; the payment stays");
    // the line items add up to the new total
    const sum = b.money.items.reduce((n, i) => n + i.amountMinor, 0);
    assert.equal(sum, b.money.totalMinor);
  });

  test("a cheaper car than what was paid: the quote says how much to give back", async () => {
    const n = await confirmedBooking({ pickupAt: inDays(40), returnAt: inDays(42), customer: customer("0893334444") }, 258_000);
    const q = (await admin.post(`/api/v1/admin/bookings/${n}/change/quote`).set("Origin", ORIGIN).send({ vehicleSlug: ALMERA }).expect(200)).body.data;
    assert.ok(q.differenceMinor < 0);
    assert.equal(q.refundMinor, 258_000 - q.after.totalMinor);
    assert.equal(q.leftToCollectMinor, 0);
  });

  test("a car that is taken in those days: the quote says so and the change is refused", async () => {
    await confirmedBooking({ vehicleSlug: CAMRY, customer: customer("0895556666") });
    const q = (await admin.post(`/api/v1/admin/bookings/${number}/change/quote`).set("Origin", ORIGIN).send({ vehicleSlug: CAMRY }).expect(200)).body.data;
    assert.equal(q.available, false);
    assert.ok(q.busy.includes(CAMRY));
    await admin.post(`/api/v1/admin/bookings/${number}/change`).set("Origin", ORIGIN).send({ vehicleSlug: CAMRY }).expect(409);
  });

  test("dates only, same car: the rent follows the new number of days", async () => {
    const q = (await admin.post(`/api/v1/admin/bookings/${number}/change/quote`).set("Origin", ORIGIN).send({ returnAt: inDays(15) }).expect(200)).body.data;
    assert.equal(q.swapped, false);
    assert.equal(q.after.days, 5);
    assert.ok(q.differenceMinor > 0);
  });

  test("once the car has left, it cannot be swapped", async () => {
    const n = await confirmedBooking({ pickupAt: inDays(60), returnAt: inDays(62), customer: customer("0897778888") });
    await pool.query("UPDATE bookings SET status = 'PREPARING' WHERE booking_number = $1", [n]);
    await pool.query("UPDATE bookings SET status = 'IN_DELIVERY' WHERE booking_number = $1", [n]);
    const res = await admin.post(`/api/v1/admin/bookings/${n}/change/quote`).set("Origin", ORIGIN).send({ vehicleSlug: ALMERA }).expect(409);
    assert.equal(res.body.error.code, "CAR_ALREADY_OUT");
  });
});

describe("จองเพิ่ม", () => {
  let number;
  before(async () => {
    number = await confirmedBooking({ pickupAt: inDays(80), returnAt: inDays(82), customer: customer("0881231234") });
  });

  test("another car on the same bill: own number, renter's documents carried, confirmed with no fee", async () => {
    const q = (await admin.post(`/api/v1/admin/bookings/${number}/change/quote`).set("Origin", ORIGIN)
      .send({ addOn: true, vehicleSlug: ALMERA, pickupAt: inDays(80), returnAt: inDays(82) }).expect(200)).body.data;
    assert.equal(q.available, true);
    assert.equal(q.after.days, 2);

    const r = (await admin.post(`/api/v1/admin/bookings/${number}/add-on`).set("Origin", ORIGIN)
      .send({ vehicleSlug: ALMERA, pickupAt: inDays(80), returnAt: inDays(82) }).expect(201)).body.data;
    assert.equal(r.confirmed, true);
    assert.notEqual(r.booking.number, number);
    assert.equal(r.booking.status, "CONFIRMED");
    assert.equal(r.booking.vehicle.slug, ALMERA);
    assert.equal(r.booking.money.totalMinor, q.after.totalMinor);
    const { rows } = await pool.query(
      `SELECT a.user_id = p.user_id AS same_customer, a.bill_booking_id = p.id AS same_bill,
              (SELECT count(*) FROM payments x WHERE x.booking_id = a.id)::int AS payments
         FROM bookings a, bookings p WHERE a.booking_number = $1 AND p.booking_number = $2`,
      [r.booking.number, number],
    );
    assert.deepEqual(rows[0], { same_customer: true, same_bill: true, payments: 0 });

    const board = (await admin.get("/api/v1/admin/operations").set("Origin", ORIGIN).expect(200)).body.data;
    const card = board.lists.to_deliver.find((x) => x.number === number);
    assert.deepEqual(card.ops.bill.numbers, [number, r.booking.number]);
    assert.equal(card.ops.bill.totalMinor, card.money.totalMinor + r.booking.money.totalMinor);
  });

  for (const [label, path] of [["while the car is on its way", ["PREPARING", "IN_DELIVERY"]], ["while the renter has the car", ["PREPARING", "IN_DELIVERY", "ACTIVE"]]]) {
    test(`a car can be added ${label}, starting today`, async () => {
      const n = await confirmedBooking({ pickupAt: inDays(90 + path.length * 10), returnAt: inDays(93 + path.length * 10), customer: customer(`08${path.length}5550000`) });
      for (const s of path) await pool.query("UPDATE bookings SET status = $2 WHERE booking_number = $1", [n, s]);
      const soon = new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000 + 3_600_000);
      const raw = await admin.post(`/api/v1/admin/bookings/${n}/add-on`).set("Origin", ORIGIN)
        .send({ vehicleSlug: path.length === 2 ? ALMERA : ACCORD, pickupAt: soon.toISOString(), returnAt: new Date(soon.getTime() + 2 * 86_400_000).toISOString() })
      const r = raw.body.data;
      assert.equal(raw.status, 201, JSON.stringify(raw.body));
      assert.equal(r.confirmed, true);
      assert.equal(r.booking.status, "CONFIRMED");
    });
  }
});
