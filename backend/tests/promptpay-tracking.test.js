import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync, crc32 } from "node:zlib";
import request from "supertest";
import { createHmac } from "node:crypto";
import { approveBooking, ORIGIN, resetDatabase } from "./helpers.js";
import { createApp } from "../src/app.js";
import { config } from "../src/config/env.js";
import { pool } from "../src/db/pool.js";
import { seedCoolkids } from "../src/db/seed-coolkids.js";
import { seedAdmin } from "../src/db/seed-admin.js";
import { seedDrivers } from "../src/db/seed-drivers.js";
import { sendPendingLine } from "../src/modules/notifications/line.service.js";
import { promptpayPayload } from "../src/shared/promptpay.js";

const app = createApp();
const SLUG = "honda-city-e-hev-black-outshine-2026";
const DEST = { lat: 13.7466, lng: 100.5393 }; // Central World

/** A valid white PNG; a different width gives a different file (and hash). */
function png(width = 40) {
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

const inDays = (n, hour = 10) => {
  const d = new Date(Date.now() + n * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};
const bookingBody = (from, overrides = {}) => ({
  vehicleSlug: SLUG,
  pickupAt: inDays(from),
  returnAt: inDays(from + 2),
  fulfillment: "BRANCH_PICKUP",
  customer: {
    fullName: "Lalin Suksai", phone: "0898765432", countryCode: "TH", idType: "PASSPORT", idNumber: "AA1234567",
    dateOfBirth: "1992-02-02", licenseNumber: "DL123456", licenseCountry: "TH", licenseExpiry: "2031-01-01", address: "1 ถนนพระราม 1 กรุงเทพฯ",
  },
  declarations: { hasOriginalLicense: true, infoMatchesLicense: true },
  ...overrides,
});

// ---- outgoing HTTP: SlipOK, LINE verify and LINE push are answered by the test.
const realFetch = globalThis.fetch;
const calls = [];
let slipok = () => ({ status: 500, body: {} });
let lineVerify = () => ({ status: 400, body: {} });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const reply = ({ status, body }) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (u.startsWith("https://api.slipok.com/")) {
    calls.push({ url: u, headers: init.headers, form: init.body });
    return reply(slipok(init));
  }
  if (u === "https://api.line.me/oauth2/v2.1/verify") return reply(lineVerify(new URLSearchParams(init.body)));
  if (u === "https://api.line.me/v2/bot/message/push") {
    calls.push({ url: u, headers: init.headers, body: JSON.parse(init.body) });
    return reply({ status: 200, body: {} });
  }
  return realFetch(url, init);
};

const slipData = (overrides = {}) => ({
  success: true, transRef: `REF${Math.random().toString().slice(2, 12)}`, amount: 1000, // the 1,000 ฿ reservation fee transDate: "20261012", transTime: "10:00:00",
  transTimestamp: new Date().toISOString(), sendingBank: "004",
  sender: { displayName: "น.ส. ลลิน ส", account: { value: "xxx-x-x1234-x" } },
  receiver: { displayName: "Coolkids", account: { value: "xxx-x-x9999-x" }, proxy: { type: "MSISDN", value: "xxx-xxx-5678" } },
  ...overrides,
});

const saved = {};
const staff = request.agent(app); // reviews documents
before(async () => {
  for (const k of ["PROMPTPAY_ID", "PROMPTPAY_NAME", "SLIPOK_BRANCH_ID", "SLIPOK_API_KEY", "promptpayConfigured", "slipokConfigured",
    "LINE_MESSAGING_ACCESS_TOKEN", "lineMessagingConfigured", "LINE_CHANNEL_ID", "LINE_CHANNEL_SECRET", "lineConfigured"]) saved[k] = config[k];
  Object.assign(config, {
    PROMPTPAY_ID: "0812345678", PROMPTPAY_NAME: "Coolkids", promptpayConfigured: true,
    SLIPOK_BRANCH_ID: "12345", SLIPOK_API_KEY: "test-key", slipokConfigured: true,
  });
  await resetDatabase();
  await seedCoolkids();
  await seedAdmin({ login: "admin", password: "1234" });
  await seedDrivers();
  await staff.post("/api/v1/auth/login").set("Origin", ORIGIN).send({ login: "admin", password: "1234" }).expect(204);
});
after(async () => {
  Object.assign(config, saved);
  globalThis.fetch = realFetch;
  await pool.end();
});
afterEach(() => {
  calls.length = 0;
});

async function customerAgent(email) {
  const agent = request.agent(app);
  await agent.post("/api/v1/auth/register").set("Origin", ORIGIN).send({ fullName: "Lalin", email, password: "password-123" }).expect(201);
  await agent.put("/api/v1/me/onboarding").set("Origin", ORIGIN).send({ age: 34, gender: "female" }).expect(200);
  return agent;
}

/** Booked, documents sent and approved by staff: ready for the reservation fee. */
async function signedBooking(agent, from, overrides) {
  const b = (await agent.post("/api/v1/bookings").set("Origin", ORIGIN).send(bookingBody(from, overrides)).expect(201)).body.data;
  return approveBooking(agent, staff, b);
}

const sendSlip = (agent, number, image) =>
  agent.post(`/api/v1/bookings/${number}/slip`).set("Origin", ORIGIN).set("Content-Type", "image/png").send(image);

describe("PromptPay QR", () => {
  test("the payload matches the Thai QR standard for phone ids and tax ids", () => {
    assert.equal(
      promptpayPayload("081-234-5678", 123_450),
      "00020101021229370016A000000677010111011300668123456785802TH530376454071234.50630414B2",
    );
    assert.equal(promptpayPayload("1234567890123", 9900), "00020101021229370016A000000677010111021312345678901235802TH5303764540599.0063045135");
  });
});

describe("PromptPay slip → booking confirmed (ตัดยอด)", () => {
  let customer;
  let admin;
  let first;

  before(async () => {
    customer = await customerAgent("lalin@example.com");
    admin = request.agent(app);
    await admin.post("/api/v1/auth/login").set("Origin", ORIGIN).send({ login: "admin", password: "1234" }).expect(204);
    first = await signedBooking(customer, 3);
  });

  test("the QR carries the booking total and the masked receiving id", async () => {
    assert.deepEqual(first.payWith, { card: false, promptpay: true });
    const info = (await customer.get(`/api/v1/bookings/${first.number}/promptpay`).expect(200)).body.data;
    assert.equal(info.amountMinor, 100_000);
    assert.equal(info.accountId, "081-xxx-5678");
    assert.match(info.qr, /^data:image\/svg\+xml;base64,/);
    const stranger = await customerAgent("stranger@example.com");
    await stranger.get(`/api/v1/bookings/${first.number}/promptpay`).expect(404);
  });

  test("a slip the bank confirms pays the booking at once", async () => {
    const data = slipData();
    first.transRef = data.transRef;
    slipok = () => ({ status: 200, body: { success: true, data } });
    const res = (await sendSlip(customer, first.number, png(41)).expect(200)).body.data;
    assert.equal(res.status, "VERIFIED");
    assert.equal(res.booking.status, "CONFIRMED");
    assert.equal(res.booking.payment.status, "SUCCEEDED");
    assert.equal(res.booking.payment.provider, "promptpay");
    assert.equal(calls[0].headers["x-authorization"], "test-key");
    assert.equal(calls[0].form.get("amount"), "1000");
    assert.equal(calls[0].form.get("log"), "true");
    const { rows } = await pool.query("SELECT status, trans_ref, amount_minor FROM payment_slips WHERE booking_id = $1", [first.id]);
    assert.deepEqual(rows, [{ status: "VERIFIED", trans_ref: data.transRef, amount_minor: 100_000 }]);
  });

  test("a slip cannot pay twice: same picture, or same bank reference in a new picture", async () => {
    const second = await signedBooking(customer, 10);
    const sameImage = await sendSlip(customer, second.number, png(41)).expect(409);
    assert.equal(sameImage.body.error.code, "SLIP_ALREADY_USED");
    assert.equal(calls.length, 0, "no SlipOK quota spent on a known picture");

    slipok = () => ({ status: 200, body: { success: true, data: slipData({ transRef: first.transRef }) } });
    const sameRef = (await sendSlip(customer, second.number, png(42)).expect(200)).body.data;
    assert.equal(sameRef.status, "REJECTED");
    assert.equal(sameRef.booking.status, "PENDING");
  });

  test("wrong amount, someone else's account, or a slip SlipOK refuses is rejected", async () => {
    const b = await signedBooking(customer, 20);
    slipok = () => ({ status: 200, body: { success: true, data: slipData({ amount: 2580 }) } });
    assert.equal((await sendSlip(customer, b.number, png(43)).expect(200)).body.data.reason, "ยอดเงินในสลิปไม่ตรงกับยอดที่ต้องชำระ");

    slipok = () => ({ status: 200, body: { success: true, data: slipData({ receiver: { proxy: { value: "xxx-xxx-0000" } } }) } });
    assert.equal((await sendSlip(customer, b.number, png(44)).expect(200)).body.data.reason, "บัญชีผู้รับในสลิปไม่ใช่บัญชีของร้าน");

    slipok = () => ({ status: 400, body: { code: 1012, message: "duplicate" } });
    const dup = (await sendSlip(customer, b.number, png(45)).expect(200)).body.data;
    assert.equal(dup.status, "REJECTED");
    assert.equal(dup.reason, "สลิปนี้เคยถูกใช้แล้ว");
    assert.equal(dup.booking.slip.status, "REJECTED");
    assert.equal(dup.booking.status, "PENDING");
  });

  test("when the bank cannot answer, the slip waits for staff, who confirm the booking", async () => {
    const b = await signedBooking(customer, 30);
    slipok = () => ({ status: 400, body: { code: 1010, message: "please wait" } });
    const res = (await sendSlip(customer, b.number, png(46)).expect(200)).body.data;
    assert.equal(res.status, "NEEDS_REVIEW");
    assert.equal(res.booking.status, "PENDING");
    assert.ok(new Date(res.booking.holdExpiresAt) - Date.now() > 5 * 3_600_000, "the car stays held while staff check");
    assert.equal((await sendSlip(customer, b.number, png(47)).expect(409)).body.error.code, "SLIP_IN_REVIEW");

    await customer.get("/api/v1/admin/slips").expect(403);
    const list = (await admin.get("/api/v1/admin/slips?status=NEEDS_REVIEW").expect(200)).body.data;
    assert.equal(list.length, 1);
    assert.equal(list[0].booking.number, b.number);
    const img = await admin.get(`/api/v1/admin/slips/${list[0].id}/image`).expect(200);
    assert.equal(img.headers["content-type"], "image/png");

    await customer.post(`/api/v1/admin/slips/${list[0].id}/review`).set("Origin", ORIGIN).send({ decision: "approve" }).expect(403);
    const done = (await admin.post(`/api/v1/admin/slips/${list[0].id}/review`).set("Origin", ORIGIN)
      .send({ decision: "approve", transRef: "MANUAL123456" }).expect(200)).body.data;
    assert.equal(done.status, "VERIFIED");
    assert.equal(done.booking.status, "CONFIRMED");
    await admin.post(`/api/v1/admin/slips/${list[0].id}/review`).set("Origin", ORIGIN).send({ decision: "reject", reason: "late" }).expect(409);
  });

  test("a rejected review tells the customer and lets them send another slip", async () => {
    // A customer may hold at most three unpaid bookings, so the next ones belong to someone else.
    customer = await customerAgent("lalin2@example.com");
    const b = await signedBooking(customer, 40);
    slipok = () => ({ status: 503, body: {} });
    await sendSlip(customer, b.number, png(48)).expect(200);
    const [slip] = (await admin.get("/api/v1/admin/slips?status=NEEDS_REVIEW").expect(200)).body.data;
    await admin.post(`/api/v1/admin/slips/${slip.id}/review`).set("Origin", ORIGIN).send({ decision: "reject", reason: "ยอดไม่ครบ" }).expect(200);
    const { rows } = await pool.query("SELECT body FROM notifications WHERE notification_type = 'SLIP_REJECTED'");
    assert.match(rows[0].body, /ยอดไม่ครบ/);
    slipok = () => ({ status: 200, body: { success: true, data: slipData() } });
    assert.equal((await sendSlip(customer, b.number, png(49)).expect(200)).body.data.status, "VERIFIED");
  });

  test("a slip that does not show our receiving account waits for staff; our bank account number confirms it", async () => {
    customer = await customerAgent("lalin3@example.com");
    const accountOnly = (value) => slipData({ receiver: { displayName: "Someone", account: { value } } });
    const b = await signedBooking(customer, 200);
    slipok = () => ({ status: 200, body: { success: true, data: accountOnly("xxx-x-x5555-x") } });
    const res = (await sendSlip(customer, b.number, png(51)).expect(200)).body.data;
    assert.equal(res.status, "NEEDS_REVIEW", "a real 1,000 ฿ transfer to another account must not confirm the booking");
    assert.equal(res.booking.status, "PENDING");

    const savedAccount = config.PROMPTPAY_BANK_ACCOUNT;
    config.PROMPTPAY_BANK_ACCOUNT = "226-1-92263-3";
    try {
      const ok = await signedBooking(customer, 210);
      slipok = () => ({ status: 200, body: { success: true, data: accountOnly("xxx-x-x2263-x") } });
      assert.equal((await sendSlip(customer, ok.number, png(52)).expect(200)).body.data.status, "VERIFIED");
    } finally {
      config.PROMPTPAY_BANK_ACCOUNT = savedAccount;
    }
  });

  test("only images are accepted as slips", async () => {
    const b = await signedBooking(customer, 50);
    await customer.post(`/api/v1/bookings/${b.number}/slip`).set("Origin", ORIGIN).set("Content-Type", "image/png").send(Buffer.from("not an image")).expect(400);
  });
});

describe("live delivery tracking and arrival alerts", () => {
  let customer;
  let admin;
  let b;
  const at = (dLat) => ({ lat: DEST.lat + dLat, lng: DEST.lng, accuracy: 10, speed: 8 });
  const where = (pos) => admin.put("/api/v1/admin/staff/me/location").set("Origin", ORIGIN).send(pos).expect(200);
  const alerts = async () =>
    (await pool.query("SELECT notification_type FROM notifications WHERE entity_id = $1 AND channel = 'IN_APP' AND notification_type LIKE 'DELIVERY_%' ORDER BY created_at", [b.id]))
      .rows.map((r) => r.notification_type);

  before(async () => {
    customer = await customerAgent("track@example.com");
    admin = request.agent(app);
    await admin.post("/api/v1/auth/login").set("Origin", ORIGIN).send({ login: "admin", password: "1234" }).expect(204);
    b = await signedBooking(customer, 60, { fulfillment: "DELIVERY", delivery: { address: "Central World, Bangkok", ...DEST } });
    slipok = () => ({ status: 200, body: { success: true, data: slipData() } });
    assert.equal((await sendSlip(customer, b.number, png(60)).expect(200)).body.data.status, "VERIFIED");
    await admin.post(`/api/v1/admin/bookings/${b.id}/accept`).set("Origin", ORIGIN).send({}).expect(200);
    for (const status of ["PREPARING", "IN_DELIVERY"]) {
      await admin.post(`/api/v1/admin/bookings/${b.id}/status`).set("Origin", ORIGIN).send({ status }).expect(200);
    }
  });

  test("the customer sees the car move and how far it still is", async () => {
    let t = (await customer.get(`/api/v1/bookings/${b.number}/tracking`).expect(200)).body.data;
    assert.equal(t.live, true);
    assert.equal(t.position, null, "no fix yet");
    await where(at(0.05)); // ~5.5 km away
    t = (await customer.get(`/api/v1/bookings/${b.number}/tracking`).expect(200)).body.data;
    assert.ok(t.remainingMeters > 5000 && t.remainingMeters < 6000);
    assert.equal(t.position.speedKmh, 28.8);
    assert.ok(new Date(t.etaAt) > new Date());
    assert.deepEqual(await alerts(), []);
    const stranger = await customerAgent("peek@example.com");
    await stranger.get(`/api/v1/bookings/${b.number}/tracking`).expect(404);
  });

  test("near and arrived are each announced once; vague GPS fixes are ignored", async () => {
    await where({ ...at(0.001), accuracy: 900 });
    assert.deepEqual(await alerts(), [], "a 900 m fix never triggers an alert");
    await where(at(0.01)); // ~1.1 km
    await where(at(0.008));
    assert.deepEqual(await alerts(), ["DELIVERY_NEAR"]);
    await where(at(0.0005)); // ~55 m
    await where(at(0.0002));
    assert.deepEqual(await alerts(), ["DELIVERY_NEAR", "DELIVERY_ARRIVED"]);
    const again = (await admin.post(`/api/v1/admin/bookings/${b.id}/arrived`).set("Origin", ORIGIN).send({}).expect(200)).body.data;
    assert.equal(again.notified, false);
    const t = (await customer.get(`/api/v1/bookings/${b.number}/tracking`).expect(200)).body.data;
    assert.ok(t.nearAt && t.arrivedAt);
  });

  test("after hand-over the driver's position is no longer shared", async () => {
    await admin.post(`/api/v1/admin/bookings/${b.id}/status`).set("Origin", ORIGIN).send({ status: "ACTIVE" }).expect(200);
    const t = (await customer.get(`/api/v1/bookings/${b.number}/tracking`).expect(200)).body.data;
    assert.equal(t.live, false);
    assert.equal(t.position, null);
    assert.equal(t.driver, null);
    await admin.post(`/api/v1/admin/bookings/${b.id}/arrived`).set("Origin", ORIGIN).send({}).expect(409);
  });
});

describe("LINE: sign-in inside LIFF and push notifications", () => {
  before(() => {
    Object.assign(config, {
      LINE_CHANNEL_ID: "1650000000", LINE_CHANNEL_SECRET: "secret", lineConfigured: true,
      LINE_MESSAGING_ACCESS_TOKEN: "oa-token", lineMessagingConfigured: true,
    });
  });
  after(() => Object.assign(config, { lineConfigured: saved.lineConfigured, lineMessagingConfigured: saved.lineMessagingConfigured }));

  test("a LIFF ID token signs the customer in, as the same user every time", async () => {
    lineVerify = (form) =>
      form.get("id_token") === "good-token-from-liff" && form.get("client_id") === "1650000000"
        ? { status: 200, body: { sub: "U0123456789abcdef", name: "Lin" } }
        : { status: 400, body: { error: "invalid_request" } };
    const a = request.agent(app);
    await a.post("/api/v1/auth/line/liff").set("Origin", ORIGIN).send({ idToken: "bad-token-from-somewhere" }).expect(401);
    await a.post("/api/v1/auth/line/liff").set("Origin", ORIGIN).send({ idToken: "good-token-from-liff" }).expect(204);
    const me = (await a.get("/api/v1/me").expect(200)).body.data;
    const b = request.agent(app);
    await b.post("/api/v1/auth/line/liff").set("Origin", ORIGIN).send({ idToken: "good-token-from-liff" }).expect(204);
    assert.equal((await b.get("/api/v1/me").expect(200)).body.data.id, me.id);
    await request(app).post("/api/v1/auth/line/liff").send({ idToken: "good-token-from-liff" }).expect(403); // no Origin → CSRF guard
  });

  test("customer alerts go out as LINE pushes to customers who use LINE", async () => {
    const lineUser = request.agent(app);
    await lineUser.post("/api/v1/auth/line/liff").set("Origin", ORIGIN).send({ idToken: "good-token-from-liff" }).expect(204);
    await lineUser.put("/api/v1/me/onboarding").set("Origin", ORIGIN).send({ age: 30, gender: "female" }).expect(200);
    const b = await signedBooking(lineUser, 70);
    slipok = () => ({ status: 200, body: { success: true, data: slipData() } });
    await sendSlip(lineUser, b.number, png(70)).expect(200);

    const { rows } = await pool.query("SELECT notification_type, delivery_status FROM notifications WHERE channel = 'LINE' AND entity_id = $1 ORDER BY created_at", [b.id]);
    assert.deepEqual(rows, [
      { notification_type: "BOOKING_APPROVED", delivery_status: "PENDING" },
      { notification_type: "BOOKING_CONFIRMED", delivery_status: "PENDING" },
    ]);
    assert.equal(await sendPendingLine(), 2);
    const push = calls.filter((c) => c.url.endsWith("/push"))[1];
    assert.equal(push.body.to, "U0123456789abcdef");
    assert.equal(push.headers.Authorization, "Bearer oa-token");
    assert.match(push.body.messages[0].text, new RegExp(`ชำระเงินสำเร็จ[\\s\\S]*${b.number}`));
    assert.match(push.headers["X-Line-Retry-Key"], /^[0-9a-f-]{36}$/);
    const sent = await pool.query("SELECT delivery_status FROM notifications WHERE channel = 'LINE' AND entity_id = $1", [b.id]);
    assert.deepEqual(sent.rows.map((r) => r.delivery_status), ["SENT", "SENT"]);
    assert.equal(await sendPendingLine(), 0, "nothing is sent twice");
  });
});

describe("LINE review flow and chat bot", () => {
  before(() => Object.assign(config, { LINE_MESSAGING_ACCESS_TOKEN: "oa-token", LINE_MESSAGING_CHANNEL_SECRET: "bot-secret", lineMessagingConfigured: true }));
  after(() => Object.assign(config, { lineMessagingConfigured: saved.lineMessagingConfigured }));

  test("staff can ask for more documents; the customer fixes them and sends again", async () => {
    const customer = await customerAgent("review@example.com");
    const b = (await customer.post("/api/v1/bookings").set("Origin", ORIGIN).send(bookingBody(80, {
      areaOfUse: "กรุงเทพ", stayLocation: "Skyline Rattanathibet Condominium", socialUrl: "facebook.com/lalin.s", rentalPurpose: "TRAVEL",
      contactEmail: "lalin@example.com",
    })).expect(201)).body.data;
    assert.deepEqual(b.details, {
      areaOfUse: "กรุงเทพ", stayLocation: "Skyline Rattanathibet Condominium", socialUrl: "facebook.com/lalin.s", purpose: "TRAVEL",
      contactEmail: "lalin@example.com",
    });
    assert.match(b.number, /^COOL-\d{6}-\d{3}$/, "booking numbers are COOL-YYMMDD-NNN");
    for (const kind of b.documents.required) {
      await customer.put(`/api/v1/bookings/${b.number}/documents/${kind}`).set("Origin", ORIGIN).set("Content-Type", "image/png").send(png(90)).expect(200);
    }
    await customer.post(`/api/v1/bookings/${b.number}/submit`).set("Origin", ORIGIN).send({}).expect(200);
    const queue = (await staff.get("/api/v1/admin/approvals").expect(200)).body.data;
    assert.equal(queue[0].number, b.number);
    assert.equal(queue[0].review.status, "SUBMITTED");
    await customer.put(`/api/v1/bookings/${b.number}/documents/license_front`).set("Origin", ORIGIN).set("Content-Type", "image/png").send(png(91)).expect(409);

    await staff.post(`/api/v1/admin/bookings/${b.id}/review`).set("Origin", ORIGIN).send({ decision: "request_changes" }).expect(400);
    const asked = (await staff.post(`/api/v1/admin/bookings/${b.id}/review`).set("Origin", ORIGIN)
      .send({ decision: "request_changes", note: "รูปใบขับขี่ไม่ชัด กรุณาถ่ายใหม่" }).expect(200)).body.data;
    assert.equal(asked.review.status, "CHANGES_REQUESTED");
    const line = await pool.query("SELECT body FROM notifications WHERE channel = 'LINE' AND notification_type = 'DOCS_CHANGES_REQUESTED' AND entity_id = $1", [b.id]);
    assert.match(line.rows[0].body, /ใบขับขี่ไม่ชัด/);

    await customer.put(`/api/v1/bookings/${b.number}/documents/license_front`).set("Origin", ORIGIN).set("Content-Type", "image/png").send(png(92)).expect(200);
    await customer.post(`/api/v1/bookings/${b.number}/submit`).set("Origin", ORIGIN).send({}).expect(200);
    const ok = (await staff.post(`/api/v1/admin/bookings/${b.id}/review`).set("Origin", ORIGIN).send({ decision: "approve" }).expect(200)).body.data;
    assert.equal(ok.review.status, "APPROVED");
    const approved = await pool.query("SELECT body FROM notifications WHERE channel = 'LINE' AND notification_type = 'BOOKING_APPROVED' AND entity_id = $1", [b.id]);
    assert.match(approved.rows[0].body, /โอนค่าจอง 1,000 บาท/);

    slipok = () => ({ status: 200, body: { success: true, data: slipData() } });
    const paid = (await sendSlip(customer, b.number, png(93)).expect(200)).body.data.booking;
    assert.match(paid.summary, /สถานที่ใช้รถ : กรุงเทพ/);
    assert.match(paid.summary, /วันรับรถชำระ/);
    const confirmed = await pool.query("SELECT body FROM notifications WHERE channel = 'LINE' AND notification_type = 'BOOKING_CONFIRMED' AND entity_id = $1", [b.id]);
    assert.match(confirmed.rows[0].body, /รุ่นรถ : Honda City/);
    const pdf = (await customer.get(`/api/v1/bookings/${b.number}/contract`).expect(200)).body.data;
    assert.match(pdf.html, /กรุงเทพ/, "the contract shows the area of use the customer typed");
  });

  const hook = (body, secret = "bot-secret") => {
    const raw = JSON.stringify(body);
    return request(app).post("/api/v1/webhooks/line").set("Content-Type", "application/json")
      .set("x-line-signature", createHmac("sha256", secret).update(raw).digest("base64")).send(raw);
  };

  test("the rich menu keywords get card replies; other chat is left to staff", async () => {
    await hook({ events: [] }, "wrong-secret").expect(401);
    const replies = () => calls.filter((c) => c.url === "https://api.line.me/v2/bot/message/reply");
    const realPush = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url) === "https://api.line.me/v2/bot/message/reply") {
        calls.push({ url: String(url), body: JSON.parse(init.body) });
        return new Response("{}", { status: 200 });
      }
      return realPush(url, init);
    };
    try {
      const msg = (text, token) => ({ type: "message", replyToken: token, message: { type: "text", text } });
      await hook({ events: [msg("เลือกรถ", "t1"), msg("สวัสดีครับ", "t2"), msg("ติดต่อเรา", "t3"), msg("กรอกเอกสาร", "t4")] }).expect(200);
      for (let i = 0; i < 50 && replies().length < 3; i++) await new Promise((r) => setTimeout(r, 20));
      const r = replies();
      assert.deepEqual(r.map((c) => c.body.replyToken), ["t1", "t3", "t4"], "small talk gets no bot reply");
      const carousel = r[0].body.messages[0].contents;
      assert.equal(carousel.type, "carousel");
      const honda = carousel.contents.find((b) => b.body?.contents[0].text?.startsWith("Honda City"));
      assert.match(honda.hero.url, /\/cars\/line\/.+\.jpg$/, "LINE gets a JPEG, not the site's WebP");
      assert.match(honda.footer.contents[0].action.uri, /\/book\/honda-city/);
      assert.match(JSON.stringify(r[1].body.messages[0]), /facebook\.com/);
    } finally {
      globalThis.fetch = realPush;
    }
  });
});

describe("map pin → address", () => {
  test("a dropped pin becomes a Thai address (OpenStreetMap without a Google key), for signed-in users only", async () => {
    const realFetch2 = globalThis.fetch;
    let asked = null;
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("https://nominatim.openstreetmap.org/reverse")) {
        asked = { url: new URL(url), ua: init.headers["User-Agent"] };
        return new Response(JSON.stringify({
          address: { building: "Skyline", road: "รัตนาธิเบศร์", suburb: "ตำบลบางกระสอ", city: "นนทบุรี", postcode: "11000" },
        }), { status: 200 });
      }
      return realFetch2(url, init);
    };
    try {
      await request(app).get("/api/v1/maps/reverse?lat=13.86&lng=100.5").expect(401);
      const customer = await customerAgent("pin@example.com");
      await customer.get("/api/v1/maps/reverse?lat=200&lng=100.5").expect(400);
      const r = (await customer.get("/api/v1/maps/reverse?lat=13.86&lng=100.5").expect(200)).body.data;
      assert.equal(r.address, "Skyline ถนนรัตนาธิเบศร์ ตำบลบางกระสอ นนทบุรี 11000");
      assert.equal(asked.url.searchParams.get("accept-language"), "th");
      assert.match(asked.ua, /^CoolkidsCarRental/);
    } finally {
      globalThis.fetch = realFetch2;
    }
  });
});

describe("map search", () => {
  test("place search returns Thai places with coordinates, without duplicates", async () => {
    const realFetch3 = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("https://nominatim.openstreetmap.org/search")) {
        const road = { name: "ถนนรัตนาธิเบศร์", display_name: "ถนนรัตนาธิเบศร์, ตำบลบางรักน้อย, นนทบุรี, 11000, ประเทศไทย", lat: "13.86", lon: "100.49" };
        return new Response(JSON.stringify([road, road]), { status: 200 });
      }
      return realFetch3(url, init);
    };
    try {
      const customer = await customerAgent("search@example.com");
      await customer.get("/api/v1/maps/search?q=a").expect(400);
      const places = (await customer.get(`/api/v1/maps/search?q=${encodeURIComponent("รัตนาธิเบศร์")}`).expect(200)).body.data;
      assert.deepEqual(places, [{ name: "ถนนรัตนาธิเบศร์", address: "ตำบลบางรักน้อย นนทบุรี 11000", lat: 13.86, lng: 100.49 }]);
    } finally {
      globalThis.fetch = realFetch3;
    }
  });
});

describe("delivery fee per car", () => {
  test("staff set a car's delivery fee; the car page and the quote use it, other cars keep the shop default", async () => {
    const list = (await staff.get("/api/v1/admin/vehicles").expect(200)).body.data;
    const car = list.find((v) => v.slug === SLUG);
    assert.equal(car.deliveryPerKmMinor, null, "starts on the shop default");
    const meta = (await staff.get("/api/v1/admin/vehicles/meta").expect(200)).body.data;
    assert.deepEqual(meta.deliveryDefaults, { freeKm: 5, perKmMinor: 2000, minFeeMinor: 10000 });

    await staff.patch(`/api/v1/admin/vehicles/${car.id}`).set("Origin", ORIGIN)
      .send({ deliveryFreeKm: 0, deliveryPerKmMinor: 5000, deliveryMinFeeMinor: 30000 }).expect(200);
    const pub = (await request(app).get(`/api/v1/vehicles/${SLUG}`).expect(200)).body.data;
    assert.deepEqual(pub.delivery, { freeKm: 0, perKmMinor: 5000, minFeeMinor: 30000 });

    const customer = await customerAgent("fee@example.com");
    const point = { lat: DEST.lat, lng: DEST.lng, address: "Central World" };
    const own = (await customer.post(`/api/v1/delivery/quote?vehicle=${SLUG}`).set("Origin", ORIGIN).send(point).expect(200)).body.data;
    const shop = (await customer.post("/api/v1/delivery/quote").set("Origin", ORIGIN).send(point).expect(200)).body.data;
    assert.deepEqual(own.policy, { freeKm: 0, perKmMinor: 5000, minFeeMinor: 30000 });
    assert.ok(own.feeMinor >= 30000 && own.feeMinor > shop.feeMinor, "this car's fee applies");

    await staff.patch(`/api/v1/admin/vehicles/${car.id}`).set("Origin", ORIGIN)
      .send({ deliveryFreeKm: null, deliveryPerKmMinor: null, deliveryMinFeeMinor: null }).expect(200);
    assert.deepEqual((await request(app).get(`/api/v1/vehicles/${SLUG}`).expect(200)).body.data.delivery, { freeKm: 5, perKmMinor: 2000, minFeeMinor: 10000 });
  });
});

describe("operations board: money, odometer, contract, timeline, reminders", () => {
  let customer;
  let b;
  before(async () => {
    customer = await customerAgent("ops@example.com");
    b = await signedBooking(customer, 90, { contactEmail: "ops-renter@example.com" });
    slipok = () => ({ status: 200, body: { success: true, data: slipData() } });
    await sendSlip(customer, b.number, png(120)).expect(200);
  });

  test("the board shows what is still to collect; staff record rent + deposit once, then return the deposit with a deduction", async () => {
    const board = (await staff.get("/api/v1/admin/operations").expect(200)).body.data;
    const row = Object.values(board.lists).flat().find((r) => r.id === b.id);
    assert.equal(row.ops.paidOnlineMinor, 100_000);
    assert.equal(row.ops.dueMinor, 258_000 - 100_000 + row.money.depositMinor, "rent balance + deposit");
    assert.ok(row.vehicle.fleetNo > 0);

    await customer.post(`/api/v1/admin/bookings/${b.id}/collect`).set("Origin", ORIGIN).send({ method: "cash" }).expect(403);
    const ledger = (await staff.post(`/api/v1/admin/bookings/${b.id}/collect`).set("Origin", ORIGIN).send({ method: "transfer" }).expect(200)).body.data;
    assert.equal(ledger.paidCounterMinor, 158_000);
    assert.equal(ledger.rentDueMinor, 0);
    assert.equal(ledger.depositHeldMinor, row.money.depositMinor);
    await staff.post(`/api/v1/admin/bookings/${b.id}/collect`).set("Origin", ORIGIN).send({ method: "cash" }).expect(409);

    await staff.post(`/api/v1/admin/bookings/${b.id}/deposit-return`).set("Origin", ORIGIN).send({ refundMinor: 400_000 }).expect(400); // deduction needs a reason
    const back = (await staff.post(`/api/v1/admin/bookings/${b.id}/deposit-return`).set("Origin", ORIGIN)
      .send({ refundMinor: 400_000, note: "เติมน้ำมันไม่เต็มถัง" }).expect(200)).body.data;
    assert.equal(back.depositDeductionMinor, row.money.depositMinor - 400_000);
    assert.ok(back.depositReturnedAt);

    const o = (await staff.get("/api/v1/admin/analytics/overview?days=30").expect(200)).body.data;
    assert.ok(o.kpis.revenue >= 258_000, "rent counts as revenue");
  });

  test("odometer at hand-over and return; it can never go backwards", async () => {
    const km = (await staff.post(`/api/v1/admin/bookings/${b.id}/mileage`).set("Origin", ORIGIN).send({ kind: "PICKUP", km: 45_000 }).expect(200)).body.data;
    assert.equal(km.startKm, 45_000);
    await staff.post(`/api/v1/admin/bookings/${b.id}/mileage`).set("Origin", ORIGIN).send({ kind: "RETURN", km: 44_000 }).expect(400);
    const done = (await staff.post(`/api/v1/admin/bookings/${b.id}/mileage`).set("Origin", ORIGIN).send({ kind: "RETURN", km: 45_620 }).expect(200)).body.data;
    assert.equal(done.distanceKm, 620);
    const r = (await staff.get("/api/v1/admin/fleet/reminders").expect(200)).body.data;
    const car = r.cars.find((c) => c.currentKm === 45_620);
    assert.ok(car, "the reading became the car's current odometer");
    assert.equal(car.mileage[0].km, 45_620);
    assert.equal(car.mileage[0].booking, b.number);
  });

  test("the contract goes to the customer by e-mail (PDF attached) or LINE", async () => {
    const { setMailTransport } = await import("../src/shared/mailer.js");
    const nodemailer = (await import("nodemailer")).default;
    const sent = [];
    const t = nodemailer.createTransport({ jsonTransport: true });
    setMailTransport({ sendMail: async (m) => (sent.push(m), t.sendMail(m)) });
    const saved = { ...config };
    Object.assign(config, { mailConfigured: true, SMTP_USER: "shop@example.com" });
    try {
      const r = await staff.post(`/api/v1/admin/bookings/${b.id}/send-contract`).set("Origin", ORIGIN).send({ via: "email" });
      if (r.status === 503 && r.body.error.code === "PDF_UNAVAILABLE") return; // no Chrome on this machine
      assert.equal(r.status, 200);
      assert.equal(r.body.data.to, "ops-renter@example.com");
      assert.equal(sent[0].attachments[0].contentType, "application/pdf");
      assert.match(sent[0].text, /รุ่นรถ : Honda City/);
    } finally {
      Object.assign(config, { mailConfigured: saved.mailConfigured, SMTP_USER: saved.SMTP_USER });
    }
    const line = await staff.post(`/api/v1/admin/bookings/${b.id}/send-contract`).set("Origin", ORIGIN).send({ via: "line" }).expect(409);
    assert.equal(line.body.error.code, "NO_LINE", "this renter signed up by e-mail, not LINE");
  });

  test("timeline of cars × days and the service / document reminders", async () => {
    const from = new Date(Date.now() + 85 * 86_400_000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 100 * 86_400_000).toISOString().slice(0, 10);
    const s = (await staff.get(`/api/v1/admin/schedule?from=${from}&to=${to}`).expect(200)).body.data;
    const bar = s.bookings.find((x) => x.id === b.id);
    assert.equal(bar.phase, "handover");
    assert.ok(s.cars.some((c) => c.id === bar.vehicleId && c.fleetNo));
    await staff.get(`/api/v1/admin/schedule?from=${to}&to=${from}`).expect(400);

    const r = (await staff.get("/api/v1/admin/fleet/reminders").expect(200)).body.data;
    const car = r.cars.find((c) => c.currentKm === 45_620);
    const oil = car.plans.find((p) => p.type === "OIL_CHANGE");
    assert.equal(oil.level, "overdue", "45,620 km is past the 10,000 km oil change from 0 km");
    await staff.post(`/api/v1/admin/fleet/plans/${oil.id}/complete`).set("Origin", ORIGIN).send({ km: 45_620, note: "น้ำมันสังเคราะห์" }).expect(204);
    await staff.post(`/api/v1/admin/vehicles/${car.id}/documents`).set("Origin", ORIGIN)
      .send({ type: "COMPULSORY_INSURANCE", expiresOn: new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10) }).expect(201);
    const after = (await staff.get("/api/v1/admin/fleet/reminders").expect(200)).body.data.cars.find((c) => c.id === car.id);
    const oil2 = after.plans.find((p) => p.type === "OIL_CHANGE");
    assert.equal(oil2.nextKm, 55_620);
    assert.equal(oil2.level, "ok");
    assert.equal(after.docs[0].level, "near");
    assert.equal(after.docs[0].label, "พ.ร.บ.");
    await customer.get("/api/v1/admin/fleet/reminders").expect(403);
  });
});

describe("booking slip and receipts", () => {
  test("every payment gets one receipt RE+YYMMDD-NNN; slip and receipts render with the real data and can be signed", async () => {
    const customer = await customerAgent("docs@example.com");
    const b = await signedBooking(customer, 110);
    slipok = () => ({ status: 200, body: { success: true, data: slipData() } });
    await sendSlip(customer, b.number, png(130)).expect(200);
    await staff.post(`/api/v1/admin/bookings/${b.id}/collect`).set("Origin", ORIGIN).send({ method: "cash" }).expect(200);

    const list = (await staff.get(`/api/v1/admin/bookings/${b.id}/documents`).expect(200)).body.data;
    assert.equal(list.receipts.length, 3, "reservation fee, rent at the counter, deposit");
    assert.deepEqual(list.receipts.map((r) => r.purpose), ["เงินจอง", "ค่าเช่า", "เงินมัดจำ"]);
    for (const r of list.receipts) assert.match(r.number, /^RE\d{6}-\d{3}$/);
    const again = (await staff.get(`/api/v1/admin/bookings/${b.id}/documents`).expect(200)).body.data;
    assert.deepEqual(again.receipts.map((r) => r.number), list.receipts.map((r) => r.number), "receipts are issued once");

    const slip = await staff.get(`/api/v1/admin/bookings/${b.id}/documents/view?kind=booking`).expect(200);
    assert.match(slip.text, /ใบจอง/);
    assert.match(slip.text, new RegExp(b.number));
    assert.match(slip.text, /Lalin Suksai/);
    assert.match(slip.text, /เงินจอง:<\/span><b>฿1,000<span class="paid">ชำระแล้ว/);
    const rec = await staff.get(`/api/v1/admin/bookings/${b.id}/documents/view?kind=receipt&receipt=${list.receipts[0].id}`).expect(200);
    assert.match(rec.text, new RegExp(`เลขที่: ${list.receipts[0].number}`));
    assert.match(rec.text, /รวมทั้งสิ้น: ฿1,000/);

    await staff.post(`/api/v1/admin/bookings/${b.id}/documents/sign`).set("Origin", ORIGIN)
      .send({ kind: "booking", party: "SHOP", signature: `data:image/png;base64,${png(40).toString("base64")}` }).expect(204);
    const signed = (await staff.get(`/api/v1/admin/bookings/${b.id}/documents`).expect(200)).body.data;
    assert.deepEqual(signed.booking.signed, { shop: true, customer: false });
    assert.match((await staff.get(`/api/v1/admin/bookings/${b.id}/documents/view?kind=booking`).expect(200)).text, /<img src="data:image\/png;base64,/);

    // The customer can list their own documents; strangers cannot.
    const mine = (await customer.get(`/api/v1/bookings/${b.number}/documents`).expect(200)).body.data;
    assert.equal(mine.receipts.length, 3);
    const stranger = await customerAgent("nosy@example.com");
    await stranger.get(`/api/v1/bookings/${b.number}/documents`).expect(404);
    await customer.get(`/api/v1/admin/bookings/${b.id}/documents`).expect(403);
  });
});
