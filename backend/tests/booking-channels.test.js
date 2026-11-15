import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { fakeProvider, ORIGIN, resetDatabase } from "./helpers.js";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { seedCoolkids } from "../src/db/seed-coolkids.js";
import { seedAdmin } from "../src/db/seed-admin.js";
import { repliesFor } from "../src/modules/line/bot.service.js";

// Booking channels (owner 2026-11-14): a LINE-only car has no self-service booking. The
// site shows it with a LINE button; the LINE card sends the shop a chat message; staff
// key the booking in from the back office.
const app = createApp({ identityProvider: fakeProvider() });
const SLUG = "honda-city-e-hev-black-outshine-2026";

const inDays = (n, hour = 10) => {
  const d = new Date(Date.now() + n * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};
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
const carsReply = async () => (await repliesFor({ type: "message", message: { type: "text", text: "เลือกรถ" } }))[0];
const bubbleFor = (msg, brandModel) => msg.contents.contents.find((b) => b.body?.contents?.[0]?.text === brandModel);

describe("booking channels", () => {
  const admin = request.agent(app);
  const customer = request.agent(app);
  let car;

  before(async () => {
    await resetDatabase();
    await seedCoolkids();
    await seedAdmin({ login: "admin", password: "1234" });
    await admin.post("/api/v1/auth/login").set("Origin", ORIGIN).send({ login: "admin", password: "1234" }).expect(204);
    await customer.post("/api/v1/auth/register").set("Origin", ORIGIN).send({ fullName: "Mana", email: "mana@example.com", password: "password-123" });
    await customer.put("/api/v1/me/onboarding").set("Origin", ORIGIN).send({ age: 37, gender: "male" }).expect(200);
    car = (await admin.get("/api/v1/admin/vehicles").expect(200)).body.data.find((v) => v.slug === SLUG);
  });
  after(() => pool.end());

  test("new and existing cars are bookable on both channels", async () => {
    assert.equal(car.bookOnWeb, true);
    assert.equal(car.bookOnLine, true);
    const pub = (await request(app).get(`/api/v1/vehicles/${SLUG}`).expect(200)).body.data;
    assert.deepEqual(pub.booking, { web: true, line: true });
    const bubble = bubbleFor(await carsReply(), `${car.brand} ${car.model}`);
    assert.equal(bubble.footer.contents[0].action.type, "uri");
  });

  test("a car needs at least one channel", async () => {
    const res = await admin.patch(`/api/v1/admin/vehicles/${car.id}`).set("Origin", ORIGIN)
      .send({ bookOnWeb: false, bookOnLine: false }).expect(400);
    assert.ok(res.body.error.details.bookOnLine);
  });

  test("LINE only: the card sends an inquiry, customers cannot book, staff can", async () => {
    const saved = (await admin.patch(`/api/v1/admin/vehicles/${car.id}`).set("Origin", ORIGIN).send({ bookOnWeb: false }).expect(200)).body.data;
    assert.equal(saved.bookOnWeb, false);
    assert.equal(saved.bookOnLine, true);

    // still listed on the site, flagged for the LINE button
    const list = (await request(app).get("/api/v1/vehicles?pageSize=48").expect(200)).body.data;
    assert.deepEqual(list.find((v) => v.slug === SLUG).booking, { web: false, line: true });

    // LINE card: same label, but the tap posts a chat message instead of opening the calendar
    const action = bubbleFor(await carsReply(), `${car.brand} ${car.model}`).footer.contents[0].action;
    assert.equal(action.type, "message");
    assert.equal(action.label, "จองคันนี้ / เลือกวัน");
    assert.match(action.text, /^สอบถามรายละเอียดการจองรถ Honda City/);
    // the bot only acknowledges it (staff answer), naming the car and asking for dates
    const ack = await repliesFor({ type: "message", message: { type: "text", text: action.text } });
    assert.equal(ack.length, 1);
    assert.equal(ack[0].type, "text");
    assert.match(ack[0].text, /^ได้รับข้อความแล้ว/);
    assert.match(ack[0].text, /Honda City/);
    assert.match(ack[0].text, /วัน-เวลารับรถ/);
    // other free text is still left to staff
    assert.equal(await repliesFor({ type: "message", message: { type: "text", text: "สวัสดีครับ" } }), null);

    const refused = await customer.post("/api/v1/bookings").set("Origin", ORIGIN).send(bookingBody()).expect(409);
    assert.equal(refused.body.error.code, "BOOK_VIA_ADMIN");

    const staff = await admin.post("/api/v1/admin/bookings").set("Origin", ORIGIN)
      .send(bookingBody({ customerEmail: "walkin@example.com" })).expect(201);
    assert.equal(staff.body.data.bookedByStaff, true);
  });

  test("website only: the car stays out of the LINE carousel", async () => {
    await admin.patch(`/api/v1/admin/vehicles/${car.id}`).set("Origin", ORIGIN).send({ bookOnWeb: true, bookOnLine: false }).expect(200);
    assert.equal(bubbleFor(await carsReply(), `${car.brand} ${car.model}`), undefined);
    await customer.post("/api/v1/bookings").set("Origin", ORIGIN)
      .send(bookingBody({ pickupAt: inDays(20), returnAt: inDays(22) })).expect(201);
  });
});
