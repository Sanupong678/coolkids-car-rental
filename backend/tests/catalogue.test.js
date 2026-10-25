import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createUser, fakeProvider, fixtureIds, insertBooking, resetDatabase } from "./helpers.js";
import { createApp } from "../src/app.js";
import { pool, withTransaction } from "../src/db/pool.js";

const app = createApp({ identityProvider: fakeProvider() });
const get = (path) => request(app).get(`/api/v1${path}`);

before(resetDatabase);
after(() => pool.end());

describe("public catalogue", () => {
  test("lists only active vehicles with image, specs and display price", async () => {
    const res = await get("/vehicles").expect(200);
    assert.equal(res.body.page.total, 9);
    const v = res.body.data[0];
    assert.ok(v.image?.url.startsWith("https://"));
    assert.ok(v.specs.seats > 0);
    assert.equal(typeof v.price.dailyMinor, "number");
    assert.match(res.headers["cache-control"], /public/);
  });

  test("filters combine (category + transmission) and sort by price", async () => {
    const sports = await get("/vehicles?category=sports&sort=price_desc").expect(200);
    assert.deepEqual(sports.body.data.map((v) => v.brand), ["Porsche", "BMW", "Ford"]);
    const manual = await get("/vehicles?category=sports&transmission=MANUAL").expect(200);
    assert.deepEqual(manual.body.data.map((v) => v.model), ["Mustang"]);
  });

  test("price range and seats filters", async () => {
    const cheap = await get("/vehicles?priceMax=7000").expect(200);
    assert.ok(cheap.body.data.every((v) => v.price.dailyMinor <= 7000));
    const big = await get("/vehicles?seats=7").expect(200);
    assert.ok(big.body.data.length >= 1 && big.body.data.every((v) => v.specs.seats >= 7));
  });

  test("running auto-applied promotion yields a discounted daily price", async () => {
    const res = await get("/vehicles?category=sports").expect(200);
    for (const v of res.body.data) {
      assert.equal(v.promotion.slug, "track-season");
      assert.equal(v.price.discountPercent, 20);
      assert.equal(v.price.discountedDailyMinor, v.price.dailyMinor * 0.8);
    }
    const family = await get("/vehicles?category=family").expect(200);
    assert.ok(family.body.data.every((v) => v.promotion === null && v.price.discountedDailyMinor === null));
  });

  test("expired promotions are never shown (rule 11)", async () => {
    await pool.query("UPDATE promotions SET starts_at = now() - interval '10 days', ends_at = now() - interval '1 day'");
    const res = await get("/vehicles?category=sports").expect(200);
    assert.ok(res.body.data.every((v) => v.promotion === null));
    assert.deepEqual((await get("/promotions").expect(200)).body.data, []);
    await pool.query("UPDATE promotions SET starts_at = now() - interval '1 day', ends_at = now() + interval '30 days'");
  });

  test("archived vehicles disappear from the catalogue", async () => {
    await pool.query("UPDATE vehicles SET status = 'ARCHIVED', deleted_at = now() WHERE slug LIKE 'honda-civic%'");
    const res = await get("/vehicles").expect(200);
    assert.equal(res.body.page.total, 8);
    await get("/vehicles/honda-civic-e-hev-2025").expect(404);
  });

  test("date filter excludes vehicles with an overlapping booking (incl. turnaround)", async () => {
    const ids = await fixtureIds();
    const userId = await createUser(pool, "lister@example.com");
    await withTransaction((db) =>
      insertBooking(db, { userId, ...ids, from: "2031-02-01T10:00:00Z", to: "2031-02-05T10:00:00Z" }),
    );
    const during = await get("/vehicles?category=sports&from=2031-02-03T10:00:00Z&to=2031-02-04T10:00:00Z").expect(200);
    assert.ok(!during.body.data.some((v) => v.id === ids.vehicleId));
    const inTurnaround = await get("/vehicles?category=sports&from=2031-02-05T11:00:00Z&to=2031-02-06T10:00:00Z").expect(200);
    assert.ok(!inTurnaround.body.data.some((v) => v.id === ids.vehicleId));
    const after = await get("/vehicles?category=sports&from=2031-02-05T12:00:00Z&to=2031-02-06T10:00:00Z").expect(200);
    assert.ok(after.body.data.some((v) => v.id === ids.vehicleId));
  });

  test("availability calendar reflects bookings and maintenance", async () => {
    const ids = await fixtureIds();
    await pool.query(
      `INSERT INTO maintenance_records (vehicle_id, maintenance_type, scheduled_start, scheduled_end)
       VALUES ($1, 'INSPECTION', '2031-02-10T03:00:00Z', '2031-02-10T09:00:00Z')`, [ids.vehicleId],
    );
    const res = await get("/vehicles/porsche-911-carrera-s-2025/availability?from=2031-02-01&to=2031-02-11").expect(200);
    const day = Object.fromEntries(res.body.data.map((d) => [d.date, d.status]));
    assert.equal(day["2031-02-02"], "BOOKED");
    assert.equal(day["2031-02-08"], "AVAILABLE");
    assert.equal(day["2031-02-10"], "MAINTENANCE");
    assert.equal(res.headers["cache-control"], "no-store");
  });

  test("detail returns features, images and full specs", async () => {
    const res = await get("/vehicles/porsche-911-carrera-s-2025").expect(200);
    assert.equal(res.body.data.brand, "Porsche");
    assert.ok(res.body.data.features.length >= 1);
    assert.ok(res.body.data.images.length >= 1);
    assert.equal(res.body.data.specs.lengthMm, 4542);
  });

  test("invalid query parameters are rejected", async () => {
    await get("/vehicles?transmission=HOVER").expect(400);
    await get("/vehicles?from=2031-01-01T00:00:00Z").expect(400); // to missing
    await get("/vehicles/porsche-911-carrera-s-2025/availability?from=2031-01-01&to=2031-12-31").expect(400); // > 120 days
  });

  test("facets, categories, locations and CMS content", async () => {
    const facets = (await get("/vehicles/facets").expect(200)).body.data;
    assert.ok(facets.brands.some((b) => b.name === "Porsche"));
    const cats = (await get("/categories").expect(200)).body.data;
    assert.deepEqual(cats.map((c) => c.slug), ["family", "fuel-efficient", "sports"]);
    assert.ok(cats.every((c) => c.image_url));
    const locs = (await get("/locations").expect(200)).body.data;
    assert.equal(typeof locs[0].latitude, "number");
    const site = (await get("/content/site").expect(200)).body.data;
    assert.ok(site.footer.columns.length > 0);
    const home = (await get("/content/homepage").expect(200)).body.data;
    assert.equal(home[0].type, "hero");
    assert.ok(home[0].banners[0].image);
    assert.ok(home.some((s) => s.type === "showcase" && s.config.exterior.hotspots.length));
  });
});
