import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { fakeProvider, ORIGIN, resetDatabase, signIn } from "./helpers.js";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { seedAdmin } from "../src/db/seed-admin.js";

const app = createApp({ identityProvider: fakeProvider() });

before(async () => {
  await resetDatabase();
  await seedAdmin({ login: "admin", password: "1234" });
});
after(() => pool.end());

describe("super admin manages sub-admin accounts", () => {
  const boss = request.agent(app); // BOOTSTRAP_SUPER_ADMINS (tests/setup.js): super_admin on Google sign-in
  const admin = request.agent(app);
  let mintId;

  before(async () => {
    await signIn(boss, { sub: "g-boss", email: "boss@example.com", name: "Boss" });
    await admin.post("/api/v1/auth/login").set("Origin", ORIGIN).send({ login: "admin", password: "1234" }).expect(204);
  });

  test("the super admin sees every page plus account management; a normal admin cannot manage accounts", async () => {
    const me = (await boss.get("/api/v1/me").expect(200)).body.data;
    assert.ok(me.roles.includes("super_admin"));
    assert.deepEqual(me.adminPages, ["dashboard", "schedule", "operations", "approvals", "slips", "maintenance", "fleet", "data", "admins"]);
    const adminMe = (await admin.get("/api/v1/me").expect(200)).body.data;
    assert.ok(!adminMe.adminPages.includes("admins"));
    await admin.get("/api/v1/admin/accounts").expect(403);
  });

  test("a sub-admin made with only a Gmail signs in with Google and gets the ticked pages; changing the Gmail unlinks the old one", async () => {
    await boss.post("/api/v1/admin/accounts").set("Origin", ORIGIN)
      .send({ fullName: "ไม่มีอะไรเลย", pages: ["operations"] }).expect(400);
    await boss.post("/api/v1/admin/accounts").set("Origin", ORIGIN)
      .send({ fullName: "รหัสไม่มีชื่อ", password: "lonely-pass-2026", pages: ["operations"] }).expect(400);
    const created = await boss.post("/api/v1/admin/accounts").set("Origin", ORIGIN)
      .send({ fullName: "ฟ้า แอดมิน", email: "Fah.Coolkids@Gmail.com", pages: ["slips"] }).expect(201);
    assert.equal(created.body.data.gmail, "fah.coolkids@gmail.com");
    assert.equal(created.body.data.login, null);
    assert.equal(created.body.data.google, false);
    await boss.post("/api/v1/admin/accounts").set("Origin", ORIGIN)
      .send({ fullName: "ซ้ำ", email: "fah.coolkids@gmail.com", pages: ["slips"] }).expect(409);

    const fah = request.agent(app);
    await signIn(fah, { sub: "g-fah", email: "fah.coolkids@gmail.com", name: "Fah" });
    const me = (await fah.get("/api/v1/me").expect(200)).body.data;
    assert.equal(me.id, created.body.data.id, "Google sign-in landed on the staff account, not a new customer");
    assert.deepEqual(me.adminPages, ["slips"]);

    await boss.patch(`/api/v1/admin/accounts/${me.id}`).set("Origin", ORIGIN).send({ email: "fah.new@gmail.com" }).expect(200);
    await fah.get("/api/v1/me").expect(401); // signed out everywhere
    const old = request.agent(app);
    await signIn(old, { sub: "g-fah", email: "fah.coolkids@gmail.com", name: "Fah" });
    assert.notEqual((await old.get("/api/v1/me").expect(200)).body.data.id, me.id, "the old Gmail is no longer this staff account");
    const fresh = request.agent(app);
    await signIn(fresh, { sub: "g-fah-new", email: "fah.new@gmail.com", name: "Fah" });
    assert.equal((await fresh.get("/api/v1/me").expect(200)).body.data.id, me.id);
  });

  test("a sub-admin made with a username + password sees only the ticked pages, and the API agrees", async () => {
    const created = await boss.post("/api/v1/admin/accounts").set("Origin", ORIGIN)
      .send({ fullName: "มิ้นท์ แอดมิน", login: "mint.coolkids", password: "mint-pass-2026", pages: ["operations", "maintenance"] }).expect(201);
    mintId = created.body.data.id;
    assert.deepEqual(created.body.data.pages, ["maintenance", "operations"]);
    await boss.post("/api/v1/admin/accounts").set("Origin", ORIGIN)
      .send({ fullName: "ซ้ำ", login: "mint.coolkids", password: "another-pass-1", pages: ["data"] }).expect(409);

    const mint = request.agent(app);
    await mint.post("/api/v1/auth/login").set("Origin", ORIGIN).send({ login: "mint.coolkids", password: "mint-pass-2026" }).expect(204);
    const me = (await mint.get("/api/v1/me").expect(200)).body.data;
    assert.deepEqual(me.adminPages, ["operations", "maintenance"]);
    assert.equal(me.needsOnboarding, false);
    await mint.get("/api/v1/admin/operations").expect(200);
    await mint.get("/api/v1/admin/fleet/reminders").expect(200);
    await mint.get("/api/v1/admin/analytics/overview?days=30").expect(403);
    await mint.post("/api/v1/admin/vehicles").set("Origin", ORIGIN).send({}).expect(403); // can read cars (service page), not edit them
    await mint.get("/api/v1/admin/accounts").expect(403);

    // Pages changed: permissions follow at once.
    await boss.patch(`/api/v1/admin/accounts/${mintId}`).set("Origin", ORIGIN).send({ pages: ["data"] }).expect(200);
    await mint.get("/api/v1/admin/operations").expect(403);
    await mint.get("/api/v1/admin/exports").expect(200);
  });

  test("suspending signs the sub-admin out; a new password works and the old one does not", async () => {
    await boss.patch(`/api/v1/admin/accounts/${mintId}`).set("Origin", ORIGIN).send({ password: "fresh-pass-2026" }).expect(200);
    await request(app).post("/api/v1/auth/login").set("Origin", ORIGIN).send({ login: "mint.coolkids", password: "mint-pass-2026" }).expect(401);
    const mint = request.agent(app);
    await mint.post("/api/v1/auth/login").set("Origin", ORIGIN).send({ login: "mint.coolkids", password: "fresh-pass-2026" }).expect(204);
    await boss.patch(`/api/v1/admin/accounts/${mintId}`).set("Origin", ORIGIN).send({ active: false }).expect(200);
    await mint.get("/api/v1/me").expect(401);

    const list = (await boss.get("/api/v1/admin/accounts").expect(200)).body.data.accounts;
    assert.ok(list.find((a) => a.superAdmin && a.email === "boss@example.com"));
    const bossId = list.find((a) => a.superAdmin).id;
    await boss.patch(`/api/v1/admin/accounts/${bossId}`).set("Origin", ORIGIN).send({ active: false }).expect(403); // not your own account
  });
});
