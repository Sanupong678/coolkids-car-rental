import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { fakeProvider, ORIGIN, resetDatabase, signIn } from "./helpers.js";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";

const app = createApp({ identityProvider: fakeProvider() });

before(resetDatabase);
after(() => pool.end());

describe("account settings", () => {
  test("a password customer edits the profile and changes the password", async () => {
    const me = request.agent(app);
    await me.post("/api/v1/auth/register").set("Origin", ORIGIN)
      .send({ fullName: "Somchai", email: "somchai@example.com", password: "Rent-a-car-42" }).expect(201);

    const account = (await me.get("/api/v1/me/account").expect(200)).body.data;
    assert.deepEqual(account.signIn.methods, []);
    assert.equal(account.signIn.password.login, "somchai@example.com");
    assert.equal(account.renter, null);

    const updated = (await me.patch("/api/v1/me").set("Origin", ORIGIN)
      .send({ fullName: "Somchai Jaidee", phone: "0812345678", locale: "zh", age: 31, gender: "male" }).expect(200)).body.data;
    assert.equal(updated.fullName, "Somchai Jaidee");
    assert.equal(updated.locale, "zh");
    assert.equal(updated.age, 31);
    assert.equal(updated.gender, "male");
    await me.patch("/api/v1/me").set("Origin", ORIGIN).send({ age: 15 }).expect(400);

    const other = request.agent(app);
    await other.post("/api/v1/auth/login").set("Origin", ORIGIN).send({ login: "somchai@example.com", password: "Rent-a-car-42" }).expect(204);

    const wrong = await me.put("/api/v1/me/password").set("Origin", ORIGIN)
      .send({ currentPassword: "nope-nope", newPassword: "Brand-new-77" }).expect(400);
    assert.equal(wrong.body.error.code, "WRONG_PASSWORD");
    await me.put("/api/v1/me/password").set("Origin", ORIGIN)
      .send({ currentPassword: "Rent-a-car-42", newPassword: "password" }).expect(400);
    await me.put("/api/v1/me/password").set("Origin", ORIGIN)
      .send({ currentPassword: "Rent-a-car-42", newPassword: "Brand-new-77" }).expect(200);

    await me.get("/api/v1/me").expect(200); // this device stays signed in
    await other.get("/api/v1/me").expect(401); // other sessions are signed out
    await request(app).post("/api/v1/auth/login").set("Origin", ORIGIN)
      .send({ login: "somchai@example.com", password: "Brand-new-77" }).expect(204);
  });

  test("a Google customer has no password to change", async () => {
    const g = request.agent(app);
    await signIn(g, { sub: "g-acct", email: "g@example.com", name: "G" });
    const account = (await g.get("/api/v1/me/account").expect(200)).body.data;
    assert.equal(account.signIn.methods[0].provider, "google");
    assert.equal(account.signIn.password, null);
    const r = await g.put("/api/v1/me/password").set("Origin", ORIGIN)
      .send({ currentPassword: "whatever1", newPassword: "Brand-new-77" }).expect(400);
    assert.equal(r.body.error.code, "NO_PASSWORD");
  });
});
