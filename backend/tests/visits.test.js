import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { fakeProvider, ORIGIN, resetDatabase } from "./helpers.js";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { seedAdmin } from "../src/db/seed-admin.js";

// Dashboard "D/M/Y": distinct website visitors today / this month / this year.
const app = createApp({ identityProvider: fakeProvider() });
const admin = request.agent(app);
const visit = (agent, anonymousId, path = "/") =>
  agent.post("/api/v1/visits").set("Origin", ORIGIN).send({ anonymousId, sessionKey: randomUUID(), path });
const counts = async () => (await admin.get("/api/v1/admin/analytics/visitors").expect(200)).body.data;

before(async () => {
  await resetDatabase();
  await seedAdmin({ login: "admin", password: "1234" });
  await admin.post("/api/v1/auth/login").set("Origin", ORIGIN).send({ login: "admin", password: "1234" }).expect(204);
});
after(() => pool.end());

test("visitors are counted once per browser, staff and the back office are not", async () => {
  assert.deepEqual(await counts(), { day: 0, month: 0, year: 0 });
  const a = randomUUID();
  await visit(request(app), a, "/vehicles?x=1").expect(204);
  await visit(request(app), a, "/").expect(204); // same browser, new session
  await visit(request(app), randomUUID(), "/admin").expect(204); // back office: ignored
  await visit(admin, randomUUID()).expect(204); // staff: ignored
  // someone who came last year counts nowhere; earlier this month counts for M and Y only
  const old = randomUUID();
  await pool.query(
    `INSERT INTO analytics_events (event_name, occurred_at, anonymous_id, session_key, page_path)
     VALUES ('PAGE_VIEW', now() - interval '400 days', $1, $1, '/')`, [old]);
  assert.deepEqual(await counts(), { day: 1, month: 1, year: 1 });
  const { rows } = await pool.query("SELECT page_path FROM analytics_events WHERE anonymous_id = $1 ORDER BY id LIMIT 1", [a]);
  assert.equal(rows[0].page_path, "/vehicles");
});

test("bad visit payloads are refused and only staff with analytics see the counts", async () => {
  await visit(request(app), "not-a-uuid").expect(400);
  await request(app).get("/api/v1/admin/analytics/visitors").expect(401);
});
