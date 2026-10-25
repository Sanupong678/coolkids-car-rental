import { execFileSync } from "node:child_process";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { fakeProvider, ORIGIN, resetDatabase, signIn } from "./helpers.js";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { seedCoolkids } from "../src/db/seed-coolkids.js";
import { seedAdmin } from "../src/db/seed-admin.js";
import { CUSTOMER_IDLE_MS, STAFF_IDLE_MS } from "../src/middleware/auth.js";
import { toCsv } from "../src/modules/admin/analytics.service.js";
import { confirmPayment } from "../src/modules/bookings/bookings.service.js";

// Hardening rules: each test is one attack the API must refuse.
const app = createApp({ identityProvider: fakeProvider() });
const SLUG = "honda-city-e-hev-black-outshine-2026";

before(async () => {
  await resetDatabase();
  await seedCoolkids();
  await seedAdmin({ login: "admin", password: "1234" });
});
after(() => pool.end());

const inDays = (n) => {
  const d = new Date(Date.now() + n * 86_400_000);
  d.setUTCHours(4, 0, 0, 0);
  return d.toISOString();
};
const body = (from, to) => ({
  vehicleSlug: SLUG,
  pickupAt: inDays(from),
  returnAt: inDays(to),
  fulfillment: "BRANCH_PICKUP",
  customer: {
    fullName: "Hold Tester", phone: "0812345678", countryCode: "TH", idType: "NATIONAL_ID", idNumber: "1234567890123",
    dateOfBirth: "1990-05-01", licenseNumber: "DL998877", licenseCountry: "TH", licenseExpiry: "2031-01-01", address: "1 ถนนทดสอบ กรุงเทพฯ",
  },
  declarations: { hasOriginalLicense: true, infoMatchesLicense: true },
});

describe("security hardening", () => {
  test("cross-site requests without our Origin are blocked (CSRF)", async () => {
    await request(app).post("/api/v1/auth/login").send({ login: "admin", password: "1234" }).expect(403);
    await request(app).post("/api/v1/auth/login").set("Origin", "https://evil.example").send({ login: "admin", password: "1234" }).expect(403);
  });

  test("a dev server opened as 127.0.0.1 or a LAN address is accepted; other sites are not", async () => {
    for (const origin of ["http://127.0.0.1:5173", "http://192.168.1.20:5173"]) {
      await request(app).post("/api/v1/auth/login").set("Origin", origin).send({ login: "admin", password: "1234" }).expect(204);
    }
    await request(app).post("/api/v1/auth/login").set("Origin", "http://evil.localhost.example").send({ login: "admin", password: "1234" }).expect(403);
    await request(app).post("/api/v1/auth/login").set("Origin", "https://127.0.0.1.evil.com").send({ login: "admin", password: "1234" }).expect(403);
  });

  test("weak or common passwords are refused at sign-up", async () => {
    for (const password of ["password123", "12345678", "aaaaaaaa", "kittycat-2026"]) {
      const res = await request(app).post("/api/v1/auth/register").set("Origin", ORIGIN)
        .send({ fullName: "Kitty", email: "kittycat@example.com", password });
      assert.equal(res.status, 400, password);
    }
  });

  test("a customer cannot hold more than three unpaid bookings", async () => {
    const agent = request.agent(app);
    await agent.post("/api/v1/auth/register").set("Origin", ORIGIN).send({ fullName: "Hoarder", email: "hoarder@example.com", password: "Tr1cky-Horse-77" }).expect(201);
    await agent.put("/api/v1/me/onboarding").set("Origin", ORIGIN).send({ age: 30, gender: "male" }).expect(200);
    for (const [a, b] of [[3, 5], [7, 9], [11, 13]]) {
      await agent.post("/api/v1/bookings").set("Origin", ORIGIN).send(body(a, b)).expect(201);
    }
    const res = await agent.post("/api/v1/bookings").set("Origin", ORIGIN).send(body(15, 17));
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, "TOO_MANY_HOLDS");
  });

  test("a gateway payment that does not match the booking is never confirmed", async () => {
    const { rows } = await pool.query(
      `INSERT INTO payments (booking_id, user_id, purpose, provider, amount_minor, currency, idempotency_key, provider_payment_id)
       SELECT id, user_id, 'RENTAL', 'stripe', total_minor, currency, gen_random_uuid()::text, 'cs_test_real'
         FROM bookings WHERE status = 'PENDING' LIMIT 1 RETURNING id, amount_minor`,
    );
    const p = rows[0];
    await assert.rejects(confirmPayment(p.id, { providerPaymentId: "cs_test_other", amountMinor: p.amount_minor, currency: "thb" }), { code: "PAYMENT_MISMATCH" });
    await assert.rejects(confirmPayment(p.id, { providerPaymentId: "cs_test_real", amountMinor: 100, currency: "thb" }), { code: "PAYMENT_MISMATCH" });
    await assert.rejects(confirmPayment(p.id, { providerPaymentId: "cs_test_real", amountMinor: p.amount_minor, currency: "usd" }), { code: "PAYMENT_MISMATCH" });
    const { rows: after } = await pool.query("SELECT status FROM payments WHERE id = $1", [p.id]);
    assert.notEqual(after[0].status, "SUCCEEDED");
  });

  test("exported CSV cannot smuggle spreadsheet formulas", () => {
    const csv = toCsv({ columns: ["name", "amount"], rows: [{ name: "=HYPERLINK(\"http://evil\")", amount: -500 }] });
    assert.match(csv, /^name,amount\r\n"'=HYPERLINK/);
    assert.match(csv, /,-500$/, "real negative numbers stay numbers");
  });

  test("an idle back-office session expires", async () => {
    const admin = request.agent(app);
    await admin.post("/api/v1/auth/login").set("Origin", ORIGIN).send({ login: "admin", password: "1234" }).expect(204);
    await admin.get("/api/v1/admin/vehicles").expect(200);
    await pool.query("UPDATE sessions SET last_seen_at = now() - make_interval(secs => $1)", [STAFF_IDLE_MS / 1000 + 60]);
    await admin.get("/api/v1/admin/vehicles").expect(401);
  });

  test("an idle customer session expires, says so and clears the cookie", async () => {
    const customer = request.agent(app);
    await signIn(customer, { sub: "idle-1", email: "idle@example.com", name: "Idle" });
    await customer.get("/api/v1/me").expect(200);
    await pool.query("UPDATE sessions SET last_seen_at = now() - make_interval(secs => $1)", [CUSTOMER_IDLE_MS / 1000 + 60]);
    const res = await customer.get("/api/v1/me").expect(401);
    assert.equal(res.body.error.code, "SESSION_EXPIRED");
    assert.match(String(res.headers["set-cookie"]), /sid=;.*Expires=Thu, 01 Jan 1970/);
    const again = await customer.get("/api/v1/me").expect(401);
    assert.equal(again.body.error.code, "UNAUTHENTICATED", "cookie is gone, so the next call is a plain guest");
  });

  test("a password account made with someone else's email is taken back when the owner signs in with Google", async () => {
    const attacker = request.agent(app);
    await attacker.post("/api/v1/auth/register").set("Origin", ORIGIN)
      .send({ fullName: "Not Me", email: "victim@gmail.com", password: "attacker-pass-2026" }).expect(201);
    const planted = (await attacker.get("/api/v1/me").expect(200)).body.data.id;

    const victim = request.agent(app);
    await signIn(victim, { sub: "g-victim", email: "victim@gmail.com", name: "Victim" });
    assert.equal((await victim.get("/api/v1/me").expect(200)).body.data.id, planted, "the owner gets the account (and its bookings)");
    await attacker.get("/api/v1/me").expect(401); // the attacker's session is gone
    await request(app).post("/api/v1/auth/login").set("Origin", ORIGIN)
      .send({ login: "victim@gmail.com", password: "attacker-pass-2026" }).expect(401); // and so is their password
  });

  test("developer shortcuts (LINE demo as admin, free mock payments) are off on a public URL even without NODE_ENV=production", () => {
    const probe = (APP_URL) =>
      execFileSync(process.execPath, ["--input-type=module", "-e", 'const { config } = await import("./src/config/env.js"); console.log(config.devToolsEnabled, config.cardPaymentsEnabled)'], {
        cwd: path.resolve(import.meta.dirname, ".."),
        env: { ...process.env, NODE_ENV: "development", APP_URL, FRONTEND_URL: APP_URL, STRIPE_SECRET_KEY: "" },
        stdio: ["ignore", "pipe", "ignore"],
      }).toString().trim();
    assert.equal(probe("https://coolkidscar.com"), "false false");
    assert.equal(probe("http://localhost:5000"), "true true");
  });

  test("failed logins are written to the audit log", async () => {
    await request(app).post("/api/v1/auth/login").set("Origin", ORIGIN).send({ login: "admin", password: "wrong" }).expect(401);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'auth.login_failed'");
    assert.ok(rows[0].n >= 1);
  });

  test("security headers are set and errors do not leak internals", async () => {
    const res = await request(app).get("/api/v1/vehicles?sort=%27;DROP%20TABLE%20bookings;--");
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.ok(res.headers["strict-transport-security"]);
    assert.ok(res.headers["content-security-policy"]);
    assert.ok(!res.headers["x-powered-by"]);
    assert.ok(!JSON.stringify(res.body).includes("DROP TABLE") || res.status === 400);
  });
});
