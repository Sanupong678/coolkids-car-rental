import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { fakeProvider, ORIGIN, resetDatabase, tinyPng } from "./helpers.js";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { seedCoolkids } from "../src/db/seed-coolkids.js";
import { seedAdmin } from "../src/db/seed-admin.js";
import { confirmPayment } from "../src/modules/bookings/bookings.service.js";
import { ledger } from "../src/modules/admin/fleetops.service.js";

const app = createApp({ identityProvider: fakeProvider() });
const SLUG = "honda-city-e-hev-black-outshine-2026";

before(async () => {
  await resetDatabase();
  await seedCoolkids();
  await seedAdmin({ login: "admin", password: "1234" });
});
after(() => pool.end());

const inDays = (n, hour = 10) => {
  const d = new Date(Date.now() + n * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};
// ~10 km north of the Don Mueang branch: priced by distance (no Google key in tests → straight-line estimate)
const AWAY = { address: "ปลายทางทดสอบ ปทุมธานี", lat: 14.0, lng: 100.6 };

const bookingBody = (overrides = {}) => ({
  vehicleSlug: SLUG,
  pickupAt: inDays(4),
  returnAt: inDays(6),
  fulfillment: "BRANCH_PICKUP",
  customer: {
    fullName: "Mana Rakdee", phone: "0898765432", countryCode: "TH", idType: "NATIONAL_ID", idNumber: "3101234567890",
    dateOfBirth: "1988-03-12", licenseNumber: "DL445566", licenseCountry: "TH", licenseExpiry: "2032-01-01", address: "1 ถนนวิภาวดี กรุงเทพฯ",
  },
  declarations: { hasOriginalLicense: true, infoMatchesLicense: true },
  ...overrides,
});

describe("return place", () => {
  const customer = request.agent(app);

  before(async () => {
    await customer.post("/api/v1/auth/register").set("Origin", ORIGIN).send({ fullName: "Mana", email: "mana@example.com", password: "password-123" });
    await customer.put("/api/v1/me/onboarding").set("Origin", ORIGIN).send({ age: 37, gender: "male" }).expect(200);
  });

  test("collecting the car from another address is priced by distance and added to the total", async () => {
    const branch = await customer.post("/api/v1/bookings").set("Origin", ORIGIN).send(bookingBody()).expect(201);
    assert.equal(branch.body.data.returnPlace.type, "BRANCH");

    const away = await customer.post("/api/v1/bookings").set("Origin", ORIGIN)
      .send(bookingBody({ pickupAt: inDays(10), returnAt: inDays(12), returnType: "ADDRESS", returnAddress: AWAY })).expect(201);
    const b = away.body.data;
    assert.equal(b.returnPlace.type, "ADDRESS");
    assert.equal(b.returnPlace.address, AWAY.address);
    assert.ok(b.returnPlace.distanceMeters > 0);
    const fee = b.money.items.find((i) => i.type === "RETURN_FEE");
    assert.ok(fee && fee.amountMinor > 0, "a RETURN_FEE line is on the bill");
    assert.equal(b.money.totalMinor, branch.body.data.money.totalMinor + fee.amountMinor);
  });

  test("returning to the delivery address needs a delivery, another address needs an address", async () => {
    await customer.post("/api/v1/bookings").set("Origin", ORIGIN).send(bookingBody({ returnType: "SAME_AS_DELIVERY" })).expect(400);
    await customer.post("/api/v1/bookings").set("Origin", ORIGIN).send(bookingBody({ returnType: "ADDRESS" })).expect(400);
  });
});

describe("staff booking on a customer's behalf, paid outside the system", () => {
  const admin = request.agent(app);
  const stranger = request.agent(app);
  let number;

  before(async () => {
    await admin.post("/api/v1/auth/login").set("Origin", ORIGIN).send({ login: "admin", password: "1234" }).expect(204);
    await stranger.post("/api/v1/auth/register").set("Origin", ORIGIN).send({ fullName: "Not staff", email: "nobody@example.com", password: "password-123" });
  });

  test("customers cannot use the staff booking endpoint", async () => {
    await stranger.post("/api/v1/admin/bookings").set("Origin", ORIGIN).send(bookingBody()).expect(403);
  });

  test("staff book for a phone customer: the booking belongs to the customer's account", async () => {
    const res = await admin.post("/api/v1/admin/bookings").set("Origin", ORIGIN)
      .send(bookingBody({ pickupAt: inDays(20), returnAt: inDays(23), customerEmail: "walkin@example.com" })).expect(201);
    const b = res.body.data;
    number = b.number;
    assert.equal(b.status, "PENDING");
    assert.equal(b.bookedByStaff, true);
    const { rows } = await pool.query("SELECT u.email, b.source FROM bookings b JOIN users u ON u.id = b.user_id WHERE b.booking_number = $1", [number]);
    assert.equal(rows[0].email, "walkin@example.com");
    assert.equal(rows[0].source, "ADMIN");
  });

  test("confirming needs the ID / licence photos first", async () => {
    const res = await admin.post(`/api/v1/admin/bookings/${number}/confirm-offline`).set("Origin", ORIGIN)
      .send({ paidMinor: 100_000, method: "transfer" }).expect(409);
    assert.equal(res.body.error.code, "DOCUMENTS_REQUIRED");
  });

  test("staff attach the photos and confirm with the amount received: CONFIRMED, payment recorded", async () => {
    for (const [i, kind] of ["id_front", "id_back", "license_front"].entries()) {
      await admin.put(`/api/v1/bookings/${number}/documents/${kind}`).set("Origin", ORIGIN).set("Content-Type", "image/png").send(tinyPng(30 + i)).expect(200);
    }
    const res = await admin.post(`/api/v1/admin/bookings/${number}/confirm-offline`).set("Origin", ORIGIN)
      .send({ paidMinor: 100_000, method: "transfer", note: "โอนเข้าบัญชีร้านแล้ว" }).expect(200);
    assert.equal(res.body.data.status, "CONFIRMED");
    assert.equal(res.body.data.review.status, "APPROVED");
    const { rows } = await pool.query(
      "SELECT p.provider, p.status, p.amount_minor, p.payment_method_type FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE b.booking_number = $1",
      [number],
    );
    assert.deepEqual(rows, [{ provider: "offline", status: "SUCCEEDED", amount_minor: 100_000, payment_method_type: "transfer" }]);
    const notes = await pool.query(
      "SELECT n.notification_type FROM notifications n JOIN bookings b ON b.id = n.entity_id WHERE b.booking_number = $1 AND n.channel = 'IN_APP'",
      [number],
    );
    assert.ok(notes.rows.some((n) => n.notification_type === "BOOKING_CONFIRMED"), "the customer is told the booking is confirmed");
  });

  test("a confirmed booking cannot be confirmed again", async () => {
    await admin.post(`/api/v1/admin/bookings/${number}/confirm-offline`).set("Origin", ORIGIN).send({ paidMinor: 0, method: "cash" }).expect(409);
  });

  test("nothing received yet (0 ฿) still confirms, with no payment row", async () => {
    const res = await admin.post("/api/v1/admin/bookings").set("Origin", ORIGIN)
      .send(bookingBody({ pickupAt: inDays(30), returnAt: inDays(32), customer: { ...bookingBody().customer, phone: "0811112222" } })).expect(201);
    const n = res.body.data.number;
    for (const [i, kind] of ["id_front", "id_back", "license_front"].entries()) {
      await admin.put(`/api/v1/bookings/${n}/documents/${kind}`).set("Origin", ORIGIN).set("Content-Type", "image/png").send(tinyPng(40 + i)).expect(200);
    }
    const ok = await admin.post(`/api/v1/admin/bookings/${n}/confirm-offline`).set("Origin", ORIGIN).send({ paidMinor: 0, method: "cash" }).expect(200);
    assert.equal(ok.body.data.status, "CONFIRMED");
    const { rows } = await pool.query("SELECT u.email FROM bookings b JOIN users u ON u.id = b.user_id WHERE b.booking_number = $1", [n]);
    assert.equal(rows[0].email, "phone-0811112222@walkin.coolkids.local", "no e-mail: an account keyed by the phone number");
  });
});

describe("rent balance + deposit paid online after confirmation", () => {
  const admin = request.agent(app);
  let number;
  let b;

  before(async () => {
    await admin.post("/api/v1/auth/login").set("Origin", ORIGIN).send({ login: "admin", password: "1234" }).expect(204);
    const res = await admin.post("/api/v1/admin/bookings").set("Origin", ORIGIN)
      .send(bookingBody({ pickupAt: inDays(40), returnAt: inDays(42), customerEmail: "balance@example.com", customer: { ...bookingBody().customer, phone: "0822223333" } })).expect(201);
    number = res.body.data.number;
    for (const [i, kind] of ["id_front", "id_back", "license_front"].entries()) {
      await admin.put(`/api/v1/bookings/${number}/documents/${kind}`).set("Origin", ORIGIN).set("Content-Type", "image/png").send(tinyPng(50 + i)).expect(200);
    }
    b = (await admin.post(`/api/v1/admin/bookings/${number}/confirm-offline`).set("Origin", ORIGIN).send({ paidMinor: 100_000, method: "transfer" }).expect(200)).body.data;
  });

  test("a confirmed booking shows what is still owed: rent balance + deposit", () => {
    assert.equal(b.balance.rentDueMinor, b.money.totalMinor - 100_000);
    assert.equal(b.balance.depositDueMinor, b.money.depositMinor);
    assert.equal(b.balance.dueMinor, b.money.payAtPickupMinor);
  });

  test("staff get a payment link + QR; only the newest link stays payable; paying it settles rent and deposit", async () => {
    const first = await admin.post(`/api/v1/admin/bookings/${number}/balance-link`).set("Origin", ORIGIN).send({}).expect(200);
    assert.ok(first.body.data.qr.startsWith("data:image/png"));
    assert.equal(first.body.data.amountMinor, b.balance.dueMinor);
    const second = await admin.post(`/api/v1/admin/bookings/${number}/balance-link`).set("Origin", ORIGIN).send({}).expect(200);
    const oldId = first.body.data.url.split("/").pop();
    const leadId = second.body.data.url.split("/").pop();
    const { rows: old } = await pool.query("SELECT status FROM payments WHERE id = $1 OR parent_payment_id = $1", [oldId]);
    assert.ok(old.every((r) => r.status === "CANCELLED"), "the replaced link cannot be paid any more");

    await assert.rejects(confirmPayment(leadId, { amountMinor: 1 }), /does not match/);
    await confirmPayment(leadId, { amountMinor: b.balance.dueMinor, methodType: "card" });

    const after = (await admin.get(`/api/v1/bookings/${number}`).set("Origin", ORIGIN).expect(200)).body.data;
    assert.equal(after.balance.dueMinor, 0);
    assert.equal(after.money.payAtPickupMinor, 0);
    assert.equal(after.payment.amountMinor, 100_000, "the reservation payment shown is still the first one");
    const l = await ledger(after.id ?? (await pool.query("SELECT id FROM bookings WHERE booking_number = $1", [number])).rows[0].id);
    assert.equal(l.rentDueMinor, 0);
    assert.equal(l.depositHeldMinor, b.money.depositMinor);
  });

  test("nothing left to pay: no new link", async () => {
    const res = await admin.post(`/api/v1/admin/bookings/${number}/balance-link`).set("Origin", ORIGIN).send({}).expect(409);
    assert.equal(res.body.error.code, "NOTHING_DUE");
  });
});
