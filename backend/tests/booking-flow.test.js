import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync, crc32 } from "node:zlib";
import request from "supertest";
import { approveBooking, fakeProvider, ORIGIN, resetDatabase, tinyPng } from "./helpers.js";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { seedCoolkids } from "../src/db/seed-coolkids.js";
import { seedAdmin } from "../src/db/seed-admin.js";
import { seedDrivers } from "../src/db/seed-drivers.js";

const app = createApp({ identityProvider: fakeProvider() });
const SLUG = "honda-city-e-hev-black-outshine-2026";

before(async () => {
  await resetDatabase();
  await seedCoolkids();
  await seedAdmin({ login: "admin", password: "1234" });
  await seedDrivers();
});
after(() => pool.end());

/** A valid (white, 40×20) PNG, like the signature pad produces. */
function signaturePng() {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(40, 0);
  ihdr.writeUInt32BE(20, 4);
  ihdr[8] = 8;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.alloc(21 * 20, 255))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

const inDays = (n, hour = 10) => {
  const d = new Date(Date.now() + n * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

const bookingBody = (overrides = {}) => ({
  vehicleSlug: SLUG,
  pickupAt: inDays(3),
  returnAt: inDays(5),
  fulfillment: "BRANCH_PICKUP",
  customer: {
    fullName: "Somchai Jaidee", phone: "0812345678", countryCode: "TH", idType: "NATIONAL_ID", idNumber: "1234567890123",
    dateOfBirth: "1990-05-01", licenseNumber: "DL998877", licenseCountry: "TH", licenseExpiry: "2031-01-01", address: "99 ถนนสุขุมวิท กรุงเทพฯ",
  },
  declarations: { hasOriginalLicense: true, infoMatchesLicense: true },
  ...overrides,
});

describe("password sign-in", () => {
  test("admin/1234 signs in with the admin role and skips customer onboarding", async () => {
    const agent = request.agent(app);
    await agent.post("/api/v1/auth/login").set("Origin", ORIGIN).send({ login: "ADMIN", password: "1234" }).expect(204);
    const me = await agent.get("/api/v1/me").expect(200);
    assert.deepEqual(me.body.data.roles, ["admin"]);
    assert.equal(me.body.data.needsOnboarding, false);
    assert.ok(me.body.data.permissions.includes("vehicles:price"));
  });

  test("wrong password is rejected and repeated failures lock the account", async () => {
    await seedAdmin({ login: "locktest", password: "correct-horse" });
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post("/api/v1/auth/login").set("Origin", ORIGIN).send({ login: "locktest", password: "nope" });
      assert.equal(res.status, 401);
    }
    const locked = await request(app).post("/api/v1/auth/login").set("Origin", ORIGIN).send({ login: "locktest", password: "correct-horse" });
    assert.equal(locked.status, 429);
    assert.equal(locked.body.error.code, "ACCOUNT_LOCKED");
  });

  test("passwords are stored as scrypt hashes, never in clear", async () => {
    const { rows } = await pool.query("SELECT password_hash FROM user_credentials WHERE login = 'admin'");
    assert.match(rows[0].password_hash, /^scrypt\$16384\$8\$1\$/);
    assert.ok(!rows[0].password_hash.includes("1234"));
  });

  test("email sign-up creates a session; the same email cannot register twice", async () => {
    const agent = request.agent(app);
    const body = { fullName: "Mali", email: "Mali@Example.com", password: "s3cret-pass" };
    await agent.post("/api/v1/auth/register").set("Origin", ORIGIN).send(body).expect(201);
    const me = await agent.get("/api/v1/me").expect(200);
    assert.equal(me.body.data.email, "mali@example.com");
    assert.equal(me.body.data.needsOnboarding, true);
    const dup = await request(app).post("/api/v1/auth/register").set("Origin", ORIGIN).send(body);
    assert.equal(dup.status, 409);
  });
});

describe("web booking: details → contract → payment → delivery", () => {
  const customer = request.agent(app);
  const admin = request.agent(app);
  let number;
  let bookingId;
  let created;

  before(async () => {
    await customer.post("/api/v1/auth/register").set("Origin", ORIGIN).send({ fullName: "Somchai", email: "somchai@example.com", password: "password-123" });
    await customer.put("/api/v1/me/onboarding").set("Origin", ORIGIN).send({ age: 36, gender: "male" }).expect(200);
    await admin.post("/api/v1/auth/login").set("Origin", ORIGIN).send({ login: "admin", password: "1234" }).expect(204);
  });

  test("creating a booking prices it server-side, holds the car and issues a contract", async () => {
    const res = await customer.post("/api/v1/bookings").set("Origin", ORIGIN).send(bookingBody()).expect(201);
    const b = res.body.data;
    created = b;
    number = b.number;
    bookingId = b.id;
    assert.equal(b.status, "PENDING");
    assert.equal(b.review.status, "DRAFT");
    assert.equal(b.money.dueNowMinor, 100_000, "โอน = จอง: only the 1,000 ฿ reservation fee is paid online");
    assert.equal(b.payWith, null, "nothing to pay before staff approve");
    assert.equal(b.rentalDays, 2);
    assert.equal(b.money.totalMinor, 2 * 129_000);
    assert.equal(b.contract.status, "ISSUED");

    const enc = await pool.query("SELECT id_document_number_enc, id_document_number_last4 FROM customer_identities");
    assert.ok(!enc.rows[0].id_document_number_enc.toString().includes("1234567890123"), "ID number is encrypted at rest");
    assert.equal(enc.rows[0].id_document_number_last4, "0123");
  });

  test("the contract shows the renter's details with document numbers masked", async () => {
    const res = await customer.get(`/api/v1/bookings/${number}/contract`).expect(200);
    assert.match(res.body.data.html, /Somchai Jaidee/);
    assert.match(res.body.data.html, /CK-002|HONDA/);
    assert.ok(!res.body.data.html.includes("1234567890123"));
    assert.match(res.body.data.html, /•+0123/);
  });

  test("an overlapping booking for the same car is refused", async () => {
    const other = request.agent(app);
    await other.post("/api/v1/auth/login").set("Origin", ORIGIN).send({ login: "admin", password: "1234" });
    const res = await other.post("/api/v1/bookings").set("Origin", ORIGIN).send(bookingBody({ pickupAt: inDays(4), returnAt: inDays(6) }));
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, "VEHICLE_UNAVAILABLE");
  });

  test("payment opens only after the documents are sent and staff approve them", async () => {
    const res = await customer.post(`/api/v1/bookings/${number}/checkout`).set("Origin", ORIGIN).send({}).expect(409);
    assert.equal(res.body.error.code, "NOT_APPROVED");
    const early = await customer.post(`/api/v1/bookings/${number}/submit`).set("Origin", ORIGIN).send({}).expect(409);
    assert.equal(early.body.error.code, "DOCUMENTS_REQUIRED");
    // Optional extras: second driver and a reference document.
    for (const [i, kind] of ["driver2_id", "driver2_license", "reference"].entries()) {
      await customer.put(`/api/v1/bookings/${number}/documents/${kind}`).set("Origin", ORIGIN).set("Content-Type", "image/png").send(tinyPng(50 + i)).expect(200);
    }
    await customer.post(`/api/v1/admin/bookings/${bookingId}/review`).set("Origin", ORIGIN).send({ decision: "approve" }).expect(403);
    const approved = await approveBooking(customer, admin, created);
    assert.equal(approved.review.status, "APPROVED");
    assert.equal(approved.documents.uploaded.driver2_license, true);
    assert.ok(new Date(approved.holdExpiresAt) - Date.now() > 11 * 3_600_000, "the car is held for the transfer");
    const again = await customer.post(`/api/v1/bookings/${number}/submit`).set("Origin", ORIGIN).send({}).expect(409);
    assert.equal(again.body.error.code, "ALREADY_SUBMITTED");
    const img = await admin.get(`/api/v1/bookings/${number}/documents/reference`).expect(200);
    assert.equal(img.headers["content-type"], "image/png");

    // E-signing stays available but is not required.
    await customer.post(`/api/v1/bookings/${number}/contract/sign`).set("Origin", ORIGIN)
      .send({ accepted: true, signature: "data:image/png;base64,AAAA" }).expect(400);
    const signed = await customer.post(`/api/v1/bookings/${number}/contract/sign`).set("Origin", ORIGIN)
      .send({ accepted: true, signature: signaturePng() }).expect(200);
    assert.equal(signed.body.data.status, "SIGNED");
    assert.match(signed.body.data.html, /<img src="data:image\/png;base64,/);
  });

  test("other customers cannot see the booking", async () => {
    const stranger = request.agent(app);
    await stranger.post("/api/v1/auth/register").set("Origin", ORIGIN).send({ fullName: "X", email: "x@example.com", password: "password-123" });
    await stranger.get(`/api/v1/bookings/${number}`).expect(404);
    await stranger.get("/api/v1/admin/operations").expect(403);
  });

  test("a successful (mock) payment confirms the booking exactly once", async () => {
    const checkout = await customer.post(`/api/v1/bookings/${number}/checkout`).set("Origin", ORIGIN).send({ locale: "th" }).expect(200);
    assert.equal(checkout.body.data.provider, "mock");
    const paymentId = checkout.body.data.url.split("/").pop();
    await customer.post(`/api/v1/payments/mock/${paymentId}/complete`).set("Origin", ORIGIN).send({ outcome: "success" }).expect(200);
    await customer.post(`/api/v1/payments/mock/${paymentId}/complete`).set("Origin", ORIGIN).send({ outcome: "success" }).expect(200);
    const b = (await customer.get(`/api/v1/bookings/${number}`).expect(200)).body.data;
    assert.equal(b.status, "CONFIRMED");
    assert.equal(b.payment.status, "SUCCEEDED");
    assert.equal(b.payment.amountMinor, 100_000);
    assert.equal(b.money.payAtPickupMinor, 258_000 + b.money.depositMinor - 100_000);
    assert.match(b.summary, /รุ่นรถ : Honda City/);
    assert.match(b.summary, /ชำระค่าจองแล้ว 1,000 บาท/);
    const tx = await pool.query("SELECT count(*)::int AS n FROM payment_transactions WHERE transaction_type = 'CAPTURE'");
    assert.equal(tx.rows[0].n, 1, "idempotent capture");
  });

  test("staff move the booking through preparing → ready → handed over, and the customer sees it", async () => {
    for (const status of ["PREPARING", "READY", "ACTIVE"]) {
      await admin.post(`/api/v1/admin/bookings/${bookingId}/status`).set("Origin", ORIGIN).send({ status }).expect(200);
    }
    const bad = await admin.post(`/api/v1/admin/bookings/${bookingId}/status`).set("Origin", ORIGIN).send({ status: "PREPARING" });
    assert.equal(bad.status, 400);
    const b = (await customer.get(`/api/v1/bookings/${number}`).expect(200)).body.data;
    assert.equal(b.stage, "arrived");
    assert.deepEqual(b.timeline.map((t) => t.status), ["PENDING", "CONFIRMED", "PREPARING", "READY", "ACTIVE"]);
  });

  test("dashboard analytics and pseudonymised exports", async () => {
    const o = (await admin.get("/api/v1/admin/analytics/overview?days=30").expect(200)).body.data;
    assert.equal(o.kpis.revenue, 100_000, "cash basis: the reservation fee paid online");
    assert.equal(o.kpis.bookings, 1);
    assert.equal(typeof o.byCategory[0].revenue, "number");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
    const csv = await admin.get(`/api/v1/admin/exports/bookings.csv?from=2020-01-01&to=${today}`).expect(200);
    assert.match(csv.text, /customer_key/);
    assert.ok(!csv.text.includes("somchai@example.com") && !csv.text.includes("Somchai Jaidee"), "no direct identifiers");
  });
});

describe("dispatch: calendar, drivers and the printable contract", () => {
  const customer = request.agent(app);
  const admin = request.agent(app);
  let bookingId;
  const pickupAt = inDays(8, 4);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date(pickupAt));

  before(async () => {
    await customer.post("/api/v1/auth/register").set("Origin", ORIGIN).send({ fullName: "Nok", email: "nok@example.com", password: "password-123" });
    await customer.put("/api/v1/me/onboarding").set("Origin", ORIGIN).send({ age: 30, gender: "female" }).expect(200);
    await admin.post("/api/v1/auth/login").set("Origin", ORIGIN).send({ login: "admin", password: "1234" }).expect(204);
    const res = await customer.post("/api/v1/bookings").set("Origin", ORIGIN).send(bookingBody({
      pickupAt, returnAt: inDays(10, 4), fulfillment: "DELIVERY",
      delivery: { address: "Central World, Bangkok", lat: 13.7466, lng: 100.5393 },
    })).expect(201);
    bookingId = res.body.data.id;
    const number = res.body.data.number;
    await approveBooking(customer, admin, res.body.data);
    const checkout = await customer.post(`/api/v1/bookings/${number}/checkout`).set("Origin", ORIGIN).send({}).expect(200);
    await customer.post(`/api/v1/payments/mock/${checkout.body.data.url.split("/").pop()}/complete`).set("Origin", ORIGIN).send({ outcome: "success" }).expect(200);
  });

  test("the month calendar lists the paid delivery on its Bangkok day", async () => {
    const cal = (await admin.get(`/api/v1/admin/dispatch/calendar?month=${day.slice(0, 7)}`).expect(200)).body.data;
    const job = cal.days[day].find((j) => j.id === bookingId);
    assert.equal(job.fulfillment, "DELIVERY");
    assert.equal(job.destination.lat, 13.7466);
    assert.equal(job.driver, null);
    await customer.get(`/api/v1/admin/dispatch/calendar?month=${day.slice(0, 7)}`).expect(403);
  });

  test("a driver is assigned, then takes that job on the road and delivers it", async () => {
    const { staff, meId } = (await admin.get(`/api/v1/admin/dispatch/staff?date=${day}`).expect(200)).body.data;
    assert.ok(meId, "the admin has a staff profile");
    const driver = staff.find((s) => s.code === "CK-DRV03");
    assert.ok(driver.location, "demo drivers have a position");
    await admin.post(`/api/v1/admin/bookings/${bookingId}/accept`).set("Origin", ORIGIN).send({}).expect(200);
    let cal = (await admin.get(`/api/v1/admin/dispatch/calendar?month=${day.slice(0, 7)}`).expect(200)).body.data;
    assert.equal(cal.days[day].find((j) => j.id === bookingId).driver.staffId, meId, "รับงาน puts the job on the caller");
    await customer.post(`/api/v1/admin/bookings/${bookingId}/accept`).set("Origin", ORIGIN).send({}).expect(403);
    await admin.post(`/api/v1/admin/bookings/${bookingId}/driver`).set("Origin", ORIGIN).send({ staffId: driver.id }).expect(200);
    const after = (await admin.get(`/api/v1/admin/dispatch/staff?date=${day}`).expect(200)).body.data.staff;
    assert.equal(after.find((s) => s.id === driver.id).jobs.length, 1);

    for (const status of ["PREPARING", "IN_DELIVERY", "ACTIVE"]) {
      // Pressing a status button also sends where the staff member is.
      const location = status === "ACTIVE" ? { lat: 13.7466, lng: 100.5393, accuracy: 15 } : undefined;
      await admin.post(`/api/v1/admin/bookings/${bookingId}/status`).set("Origin", ORIGIN).send({ status, location }).expect(200);
    }
    const { rows: pos } = await pool.query("SELECT latitude::float AS lat FROM staff_locations WHERE staff_id = $1", [meId]);
    assert.equal(pos[0].lat, 13.7466, "the hand-over position is recorded");
    const { rows } = await pool.query("SELECT staff_id, status FROM delivery_assignments WHERE booking_id = $1 AND status <> 'CANCELLED'", [bookingId]);
    assert.deepEqual(rows, [{ staff_id: driver.id, status: "DELIVERED" }], "the assigned driver's job is the one completed");
    cal = (await admin.get(`/api/v1/admin/dispatch/calendar?month=${day.slice(0, 7)}`).expect(200)).body.data;
    assert.equal(cal.days[day].find((j) => j.id === bookingId).delivered, true);
  });

  test("staff report their position; customers cannot", async () => {
    await admin.put("/api/v1/admin/staff/me/location").set("Origin", ORIGIN).send({ lat: 13.9, lng: 100.6, accuracy: 12 }).expect(200);
    const { rows } = await pool.query("SELECT latitude::float AS lat FROM staff_locations l JOIN staff s ON s.id = l.staff_id WHERE s.employee_code = 'CK-ADMIN'");
    assert.equal(rows[0].lat, 13.9);
    await customer.put("/api/v1/admin/staff/me/location").set("Origin", ORIGIN).send({ lat: 1, lng: 1 }).expect(403);
  });

  test("the printable contract carries raw values and masked documents", async () => {
    const p = (await admin.get(`/api/v1/admin/bookings/${bookingId}/contract-print`).expect(200)).body.data;
    assert.equal(p.renter.fullName, "Somchai Jaidee");
    assert.match(p.renter.idMasked, /•+0123/);
    assert.ok(!JSON.stringify(p).includes("1234567890123"));
    assert.equal(p.rental.fulfillment, "DELIVERY");
    assert.equal(p.money.totalMinor, p.money.rentalMinor + p.money.deliveryMinor - p.money.discountMinor);
    assert.equal(p.signature, null, "LINE bookings are signed on paper at pick-up");
    await customer.get(`/api/v1/admin/bookings/${bookingId}/contract-print`).expect(403);
  });
});

describe("admin fleet management", () => {
  const admin = request.agent(app);
  before(() => admin.post("/api/v1/auth/login").set("Origin", ORIGIN).send({ login: "admin", password: "1234" }));

  test("add a car, change its price (recorded in price history), and list it publicly", async () => {
    const created = await admin.post("/api/v1/admin/vehicles").set("Origin", ORIGIN).send({
      categorySlug: "suv-7", brand: "Toyota", model: "Fortuner", trim: "Legender", year: 2025, licensePlate: "กข 1234",
      transmission: "AUTOMATIC", fuel: "DIESEL", drive: "4WD", seats: 7, dailyRateMinor: 350_000, depositMinor: 1_000_000,
      minRentalDays: 1, minDriverAge: 21, status: "ACTIVE", isFeatured: false, features: ["carplay"],
    }).expect(201);
    const v = created.body.data;
    assert.equal(v.slug, "toyota-fortuner-legender-2025");
    await admin.patch(`/api/v1/admin/vehicles/${v.id}`).set("Origin", ORIGIN).send({ dailyRateMinor: 320_000 }).expect(200);
    const hist = await pool.query("SELECT daily_rate_minor FROM vehicle_price_history WHERE vehicle_id = $1 ORDER BY id", [v.id]);
    assert.deepEqual(hist.rows.map((r) => r.daily_rate_minor), [350_000, 320_000]);
    const pub = await request(app).get(`/api/v1/vehicles/${v.slug}`).expect(200);
    assert.equal(pub.body.data.price.dailyMinor, 320_000);
  });

  test("uploads accept real images only", async () => {
    await admin.post("/api/v1/admin/uploads").set("Origin", ORIGIN).set("Content-Type", "image/png").send(Buffer.from("not a png")).expect(400);
  });
});
