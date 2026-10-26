import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { fakeProvider, ORIGIN, resetDatabase, tinyPng } from "./helpers.js";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { seedCoolkids } from "../src/db/seed-coolkids.js";

const app = createApp({ identityProvider: fakeProvider() });
const SLUG = "honda-city-e-hev-black-outshine-2026";

before(async () => {
  await resetDatabase();
  await seedCoolkids();
});
after(() => pool.end());

const inDays = (n, hour = 10) => {
  const d = new Date(Date.now() + n * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};
const CUSTOMER = {
  fullName: "Somchai Jaidee", phone: "0812345678", countryCode: "TH", idType: "NATIONAL_ID", idNumber: "1234567890123",
  dateOfBirth: "1990-05-01", licenseNumber: "DL998877", licenseCountry: "TH", licenseExpiry: "2031-01-01", address: "99 ถนนสุขุมวิท กรุงเทพฯ",
};
const bookingBody = (from, to) => ({
  vehicleSlug: SLUG, pickupAt: inDays(from), returnAt: inDays(to), fulfillment: "BRANCH_PICKUP",
  customer: CUSTOMER, declarations: { hasOriginalLicense: true, infoMatchesLicense: true },
  areaOfUse: "เชียงใหม่", stayLocation: "Nimman Hotel", socialUrl: "fb.com/somchai", rentalPurpose: "TRAVEL",
});

async function newCustomer(email) {
  const agent = request.agent(app);
  await agent.post("/api/v1/auth/register").set("Origin", ORIGIN).send({ fullName: "Somchai", email, password: "password-123" }).expect(201);
  await agent.put("/api/v1/me/onboarding").set("Origin", ORIGIN).send({ age: 36, gender: "male" }).expect(200);
  return agent;
}

describe("customer: remembered details and self-cancel", () => {
  let customer;
  let first;
  let second;

  before(async () => {
    customer = await newCustomer("cancel@example.com");
  });

  test("a new customer has nothing to prefill", async () => {
    const res = await customer.get("/api/v1/me/booking-defaults").expect(200);
    assert.deepEqual(res.body.data, { customer: null, rental: null });
    assert.equal(res.headers["cache-control"], "no-store");
  });

  test("after a booking, the form comes back filled with what they typed", async () => {
    first = (await customer.post("/api/v1/bookings").set("Origin", ORIGIN).send(bookingBody(3, 5)).expect(201)).body.data;
    assert.equal(first.canCancel, true);
    const res = await customer.get("/api/v1/me/booking-defaults").expect(200);
    assert.deepEqual(res.body.data.customer, CUSTOMER);
    assert.equal(res.body.data.rental.stayLocation, "Nimman Hotel");
    assert.equal(res.body.data.rental.socialUrl, "fb.com/somchai");

    const stranger = await newCustomer("stranger@example.com");
    assert.equal((await stranger.get("/api/v1/me/booking-defaults").expect(200)).body.data.customer, null);
    await request(app).get("/api/v1/me/booking-defaults").expect(401);
  });

  test("ID photos carry over to the next booking when the numbers are the same", async () => {
    for (const [i, kind] of first.documents.required.entries()) {
      await customer.put(`/api/v1/bookings/${first.number}/documents/${kind}`).set("Origin", ORIGIN).set("Content-Type", "image/png")
        .send(tinyPng(30 + i)).expect(200);
    }
    second = (await customer.post("/api/v1/bookings").set("Origin", ORIGIN).send(bookingBody(10, 12)).expect(201)).body.data;
    assert.equal(second.documents.complete, true, "no re-upload needed");

    // replacing a photo on the new booking keeps the old booking's copy
    await customer.put(`/api/v1/bookings/${second.number}/documents/id_front`).set("Origin", ORIGIN).set("Content-Type", "image/png")
      .send(tinyPng(77)).expect(200);
    await customer.get(`/api/v1/bookings/${first.number}/documents/id_front`).expect(200);
  });

  test("the renter cancels: the car is released and the booking can't be cancelled twice", async () => {
    const res = await customer.post(`/api/v1/bookings/${first.number}/cancel`).set("Origin", ORIGIN).send({ reason: "เปลี่ยนแผน" }).expect(200);
    assert.equal(res.body.data.status, "CANCELLED");
    assert.equal(res.body.data.canCancel, false);
    assert.match(res.body.data.cancellation.reason, /ลูกค้ายกเลิกเอง: เปลี่ยนแผน/);
    const blocks = await pool.query("SELECT released_at FROM vehicle_availability_blocks WHERE booking_id = $1", [first.id]);
    assert.ok(blocks.rows.every((r) => r.released_at), "car is free again");

    const again = await customer.post(`/api/v1/bookings/${first.number}/cancel`).set("Origin", ORIGIN).send({}).expect(409);
    assert.equal(again.body.error.code, "NOT_CANCELLABLE");
  });

  test("nobody else can cancel someone's booking", async () => {
    const stranger = await newCustomer("other@example.com");
    await stranger.post(`/api/v1/bookings/${second.number}/cancel`).set("Origin", ORIGIN).send({}).expect(404);
    const { rows } = await pool.query("SELECT status FROM bookings WHERE id = $1", [second.id]);
    assert.equal(rows[0].status, "PENDING");
  });
});
