import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync, crc32 } from "node:zlib";
import request from "supertest";
import { fakeProvider, ORIGIN, resetDatabase } from "./helpers.js";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { seedCoolkids } from "../src/db/seed-coolkids.js";
import { seedAdmin } from "../src/db/seed-admin.js";
import { chromePath } from "../src/modules/contracts/pdf.js";

// Identity document photos and contract PDFs live in private storage: only the
// renter and staff with users:read_sensitive may read them.
const app = createApp({ identityProvider: fakeProvider() });
const SLUG = "honda-city-e-hev-black-outshine-2026";

function png(w = 4, h = 4) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.alloc((w + 1) * h, 255))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const inDays = (n) => {
  const d = new Date(Date.now() + n * 86_400_000);
  d.setUTCHours(4, 0, 0, 0);
  return d.toISOString();
};

const renter = request.agent(app);
const stranger = request.agent(app);
const admin = request.agent(app);
let number;

before(async () => {
  await resetDatabase();
  await seedCoolkids();
  await seedAdmin({ login: "admin", password: "1234" });
  for (const [agent, email] of [[renter, "docs@example.com"], [stranger, "nosy@example.com"]]) {
    await agent.post("/api/v1/auth/register").set("Origin", ORIGIN).send({ fullName: "Doc Tester", email, password: "Tr1cky-Horse-77" }).expect(201);
    await agent.put("/api/v1/me/onboarding").set("Origin", ORIGIN).send({ age: 30, gender: "female" }).expect(200);
  }
  await admin.post("/api/v1/auth/login").set("Origin", ORIGIN).send({ login: "admin", password: "1234" }).expect(204);
  const res = await renter.post("/api/v1/bookings").set("Origin", ORIGIN).send({
    vehicleSlug: SLUG, pickupAt: inDays(4), returnAt: inDays(6), fulfillment: "BRANCH_PICKUP",
    customer: {
      fullName: "Doc Tester", phone: "0812345678", countryCode: "TH", idType: "NATIONAL_ID", idNumber: "1234567890123",
      dateOfBirth: "1990-05-01", licenseNumber: "DL998877", licenseCountry: "TH", licenseExpiry: "2031-01-01", address: "1 ถนนทดสอบ กรุงเทพฯ",
    },
    declarations: { hasOriginalLicense: true, infoMatchesLicense: true },
  }).expect(201);
  number = res.body.data.number;
});
after(() => pool.end());

describe("identity documents", () => {
  test("a new booking lists the photos it still needs", async () => {
    const b = (await renter.get(`/api/v1/bookings/${number}`).expect(200)).body.data;
    assert.deepEqual(b.documents.required, ["id_front", "id_back", "license_front"]);
    assert.equal(b.documents.complete, false);
  });

  test("only real images are accepted", async () => {
    await renter.put(`/api/v1/bookings/${number}/documents/id_front`).set("Origin", ORIGIN).set("Content-Type", "image/png")
      .send(Buffer.from("<script>alert(1)</script> not a png")).expect(400);
    await renter.put(`/api/v1/bookings/${number}/documents/selfie`).set("Origin", ORIGIN).set("Content-Type", "image/png").send(png()).expect(400);
  });

  test("the renter uploads all three; the booking is complete and the file is private", async () => {
    for (const kind of ["id_front", "id_back", "license_front"]) {
      await renter.put(`/api/v1/bookings/${number}/documents/${kind}`).set("Origin", ORIGIN).set("Content-Type", "image/png").send(png()).expect(200);
    }
    const b = (await renter.get(`/api/v1/bookings/${number}`).expect(200)).body.data;
    assert.equal(b.documents.complete, true);
    const { rows } = await pool.query("SELECT is_private, storage_key FROM media WHERE storage_key LIKE 'identities/%'");
    assert.equal(rows.length, 3);
    assert.ok(rows.every((r) => r.is_private));
  });

  test("other customers cannot upload or read; staff with the permission can read", async () => {
    await stranger.put(`/api/v1/bookings/${number}/documents/id_front`).set("Origin", ORIGIN).set("Content-Type", "image/png").send(png()).expect(404);
    await stranger.get(`/api/v1/bookings/${number}/documents/id_front`).expect(404);
    const mine = await renter.get(`/api/v1/bookings/${number}/documents/id_front`).expect(200);
    assert.equal(mine.headers["content-type"], "image/png");
    assert.match(mine.headers["cache-control"], /no-store/);
    await admin.get(`/api/v1/bookings/${number}/documents/license_front`).expect(200);
  });

  test("public file route refuses path tricks", async () => {
    const res = await request(app).get("/uploads/..%2f..%2fstorage%2fsignatures%2fx.png");
    assert.notEqual(res.status, 200);
  });

  test("the contract renders as a PDF for the renter", { skip: !chromePath() && "Chrome not installed" }, async () => {
    const res = await renter.get(`/api/v1/bookings/${number}/contract.pdf`).buffer(true).parse((r, cb) => {
      const parts = [];
      r.on("data", (c) => parts.push(c));
      r.on("end", () => cb(null, Buffer.concat(parts)));
    }).expect(200);
    assert.equal(res.headers["content-type"], "application/pdf");
    assert.equal(res.body.subarray(0, 4).toString(), "%PDF");
    await stranger.get(`/api/v1/bookings/${number}/contract.pdf`).expect(404);
  });
});
