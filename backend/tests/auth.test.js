import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { fakeProvider, ORIGIN, resetDatabase, signIn } from "./helpers.js";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";

const app = createApp({ identityProvider: fakeProvider() });

before(resetDatabase);
after(() => pool.end());

describe("Google sign-in, session, onboarding", () => {
  const agent = request.agent(app);
  const profile = { sub: "g-123", email: "Alice@Example.com", name: "Alice" };

  test("unauthenticated /me is 401", async () => {
    const res = await request(app).get("/api/v1/me").expect(401);
    assert.equal(res.body.error.code, "UNAUTHENTICATED");
  });

  test("callback creates user, identity and session, redirects to returnTo", async () => {
    const res = await signIn(agent, profile);
    assert.equal(res.headers.location, `${ORIGIN}/vehicles`);
    const cookie = res.headers["set-cookie"].find((c) => c.startsWith("sid="));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);

    const { rows } = await pool.query(
      "SELECT u.email, i.provider_subject FROM users u JOIN user_identities i ON i.user_id = u.id",
    );
    assert.deepEqual(rows, [{ email: "alice@example.com", provider_subject: "g-123" }]);
    const sessions = await pool.query("SELECT token_hash FROM sessions");
    assert.equal(sessions.rows[0].token_hash.length, 32, "only a SHA-256 hash of the token is stored");
  });

  test("/me reports onboarding required; protected writes need it", async () => {
    const res = await agent.get("/api/v1/me").expect(200);
    assert.equal(res.body.data.needsOnboarding, true);
    assert.deepEqual(res.body.data.roles, []);
  });

  test("state-changing requests from a foreign origin are rejected", async () => {
    await agent.put("/api/v1/me/onboarding").set("Origin", "https://evil.example").send({ age: 30, gender: "female" }).expect(403);
    await agent.put("/api/v1/me/onboarding").send({ age: 30, gender: "female" }).expect(403); // no Origin at all
  });

  test("onboarding validates input", async () => {
    const res = await agent.put("/api/v1/me/onboarding").set("Origin", ORIGIN).send({ age: 12, gender: "robot" }).expect(400);
    assert.ok(res.body.error.details.age);
    assert.ok(res.body.error.details.gender);
  });

  test("onboarding completes and is audited", async () => {
    const res = await agent.put("/api/v1/me/onboarding").set("Origin", ORIGIN).send({ age: 30, gender: "female" }).expect(200);
    assert.equal(res.body.data.needsOnboarding, false);
    assert.equal(res.body.data.age, 30);
    const audit = await pool.query("SELECT action FROM audit_logs ORDER BY id");
    assert.deepEqual(audit.rows.map((r) => r.action), ["user.signed_up", "user.onboarded"]);
  });

  test("second login reuses the account (no duplicate user)", async () => {
    await signIn(request.agent(app), profile);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM users");
    assert.equal(rows[0].n, 1);
  });

  test("customers cannot read the audit log", async () => {
    await agent.get("/api/v1/admin/audit-logs").expect(403);
  });

  test("forged state is rejected", async () => {
    const a = request.agent(app);
    await a.get("/api/v1/auth/google").expect(302);
    const res = await a.get(`/api/v1/auth/google/callback?code=${encodeURIComponent(JSON.stringify(profile))}&state=forged`).expect(302);
    assert.match(res.headers.location, /auth_error=signin_failed/);
    assert.ok(!res.headers["set-cookie"]?.some((c) => c.startsWith("sid=") && !c.startsWith("sid=;")));
  });

  test("open redirects via returnTo are neutralised", async () => {
    const a = request.agent(app);
    const start = await a.get("/api/v1/auth/google?returnTo=//evil.example/x").expect(302);
    const state = new URL(start.headers.location).searchParams.get("state");
    const res = await a.get(`/api/v1/auth/google/callback?code=${encodeURIComponent(JSON.stringify(profile))}&state=${state}`);
    assert.equal(res.headers.location, `${ORIGIN}/`);
  });

  test("logout revokes the session server-side", async () => {
    await agent.post("/api/v1/auth/logout").set("Origin", ORIGIN).expect(204);
    await agent.get("/api/v1/me").expect(401);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM sessions WHERE revoked_at IS NOT NULL");
    assert.ok(rows[0].n >= 1);
  });
});

describe("RBAC", () => {
  test("bootstrap super admin gets all permissions and can read the audit log", async () => {
    const boss = request.agent(app);
    await signIn(boss, { sub: "g-boss", email: "boss@example.com" });
    const me = await boss.get("/api/v1/me").expect(200);
    assert.deepEqual(me.body.data.roles, ["super_admin"]);
    assert.ok(me.body.data.permissions.includes("audit:read"));
    const logs = await boss.get("/api/v1/admin/audit-logs?limit=2").expect(200);
    assert.equal(logs.body.data.length, 2);
    assert.ok(logs.body.page.nextCursor);
  });

  test("suspending a user invalidates their sessions immediately", async () => {
    const a = request.agent(app);
    await signIn(a, { sub: "g-sus", email: "sus@example.com" });
    await a.get("/api/v1/me").expect(200);
    await pool.query("UPDATE users SET status = 'SUSPENDED' WHERE email = 'sus@example.com'");
    await a.get("/api/v1/me").expect(401);
  });
});
