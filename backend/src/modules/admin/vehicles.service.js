import { pool, withTransaction } from "../../db/pool.js";
import { Conflict, Forbidden, NotFound } from "../../shared/errors.js";
import * as storage from "../../shared/storage.js";
import { feePolicy, getSettings } from "../../shared/settings.js";
import { recordAudit } from "../audit/audit.service.js";

// Back-office fleet management. Prices are in minor units (satang) end to end;
// price changes are captured by the vehicle_price_history trigger automatically.

const COLUMNS = {
  categorySlug: null, // resolved to category_id
  brand: "brand", model: "model", trim: "trim", year: "model_year", licensePlate: "license_plate", color: "color",
  description: "description", transmission: "transmission", fuel: "fuel_type", drive: "drive_type", seats: "seats",
  doors: "doors", luggageLiters: "luggage_liters", engineCc: "engine_displacement_cc", powerHp: "power_hp",
  torqueNm: "torque_nm", fuelEconomy: "fuel_economy_l_100km", rangeKm: "range_km",
  dailyRateMinor: "daily_rate_minor", hourlyRateMinor: "hourly_rate_minor", depositMinor: "deposit_minor",
  minRentalDays: "min_rental_days", maxRentalDays: "max_rental_days", minDriverAge: "min_driver_age",
  status: "status", isFeatured: "is_featured",
  fleetNo: "fleet_no",
  deliveryFreeKm: "delivery_free_km", deliveryPerKmMinor: "delivery_per_km_minor", deliveryMinFeeMinor: "delivery_min_fee_minor",
};
const PRICE_FIELDS = ["dailyRateMinor", "hourlyRateMinor", "depositMinor"];

const slugify = (s) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "vehicle";

const ADMIN_SELECT = `
  SELECT v.*, c.slug AS category_slug, c.name AS category_name,
         (SELECT m.file_url FROM vehicle_images vi JOIN media m ON m.id = vi.media_id
           WHERE vi.vehicle_id = v.id AND vi.role = 'PRIMARY' AND vi.deleted_at IS NULL LIMIT 1) AS image_url,
         COALESCE((SELECT array_agg(f.code ORDER BY f.code) FROM vehicle_features vf JOIN features f ON f.id = vf.feature_id
                    WHERE vf.vehicle_id = v.id), '{}') AS features,
         (SELECT count(*) FROM bookings b WHERE b.vehicle_id = v.id
             AND b.status IN ('PENDING','CONFIRMED','PREPARING','READY','IN_DELIVERY','ACTIVE'))::int AS open_bookings
    FROM vehicles v JOIN vehicle_categories c ON c.id = v.category_id`;

const dto = (r) => ({
  id: r.id, slug: r.slug, categorySlug: r.category_slug, categoryName: r.category_name,
  brand: r.brand, model: r.model, trim: r.trim, year: r.model_year, licensePlate: r.license_plate, color: r.color,
  description: r.description, transmission: r.transmission, fuel: r.fuel_type, drive: r.drive_type, seats: r.seats,
  doors: r.doors, luggageLiters: r.luggage_liters, engineCc: r.engine_displacement_cc, powerHp: r.power_hp,
  torqueNm: r.torque_nm, fuelEconomy: r.fuel_economy_l_100km != null ? Number(r.fuel_economy_l_100km) : null, rangeKm: r.range_km,
  currency: r.currency, dailyRateMinor: r.daily_rate_minor, hourlyRateMinor: r.hourly_rate_minor, depositMinor: r.deposit_minor,
  minRentalDays: r.min_rental_days, maxRentalDays: r.max_rental_days, minDriverAge: r.min_driver_age,
  status: r.status, isFeatured: r.is_featured, imageUrl: r.image_url, features: r.features,
  // null = the shop default delivery fee
  deliveryFreeKm: r.delivery_free_km != null ? Number(r.delivery_free_km) : null,
  deliveryPerKmMinor: r.delivery_per_km_minor, deliveryMinFeeMinor: r.delivery_min_fee_minor,
  fleetNo: r.fleet_no, currentKm: r.current_odometer_km,
  openBookings: r.open_bookings, updatedAt: r.updated_at, archived: Boolean(r.deleted_at),
});

export async function list({ includeArchived = false } = {}) {
  const { rows } = await pool.query(
    `${ADMIN_SELECT} WHERE ${includeArchived ? "true" : "v.deleted_at IS NULL"} ORDER BY v.status = 'ACTIVE' DESC, v.brand, v.model`,
  );
  return rows.map(dto);
}

export async function get(id, db = pool) {
  const { rows } = await db.query(`${ADMIN_SELECT} WHERE v.id = $1`, [id]);
  if (!rows[0]) throw NotFound("Vehicle");
  return dto(rows[0]);
}

export async function meta() {
  const [cats, locs, feats] = await Promise.all([
    pool.query("SELECT slug, name FROM vehicle_categories WHERE deleted_at IS NULL AND is_active ORDER BY sort_order, name"),
    pool.query("SELECT id, code, name FROM locations WHERE deleted_at IS NULL AND is_active ORDER BY sort_order, name"),
    pool.query("SELECT code, name, feature_group AS \"group\", icon FROM features ORDER BY feature_group, name"),
  ]);
  // The shop default delivery fee, shown as the placeholder of the per-car fields.
  return { categories: cats.rows, locations: locs.rows, features: feats.rows, deliveryDefaults: feePolicy(await getSettings()) };
}

async function categoryId(db, slug) {
  const { rows } = await db.query("SELECT id FROM vehicle_categories WHERE slug = $1 AND deleted_at IS NULL", [slug]);
  if (!rows[0]) throw NotFound("Category");
  return rows[0].id;
}

async function setImage(db, vehicleId, url, alt, userId) {
  const { rows } = await db.query(
    `INSERT INTO media (media_type, storage_provider, storage_key, file_url, thumbnail_url, mime_type, file_size_bytes, alt_text, uploaded_by)
     VALUES ('IMAGE', $4, $1, $1, $1, 'image/*', 0, $2, $3)
     ON CONFLICT (storage_key) DO UPDATE SET alt_text = EXCLUDED.alt_text RETURNING id`,
    [url, alt, userId, url.startsWith("/uploads/") ? storage.driver : "local"],
  );
  await db.query(
    "UPDATE vehicle_images SET deleted_at = now() WHERE vehicle_id = $1 AND role = 'PRIMARY' AND deleted_at IS NULL AND media_id <> $2",
    [vehicleId, rows[0].id],
  );
  await db.query(
    `INSERT INTO vehicle_images (vehicle_id, media_id, role) VALUES ($1, $2, 'PRIMARY')
     ON CONFLICT (vehicle_id, media_id) DO UPDATE SET deleted_at = NULL, role = 'PRIMARY'`,
    [vehicleId, rows[0].id],
  );
}

async function setFeatures(db, vehicleId, codes) {
  await db.query("DELETE FROM vehicle_features WHERE vehicle_id = $1", [vehicleId]);
  await db.query(
    "INSERT INTO vehicle_features (vehicle_id, feature_id) SELECT $1, id FROM features WHERE code = ANY($2::text[])",
    [vehicleId, codes],
  );
}

function assertPricePermission(auth, input) {
  if (PRICE_FIELDS.some((f) => f in input) && !auth.permissions.has("vehicles:price")) throw Forbidden("You cannot change prices");
}

export async function create(auth, input, ctx) {
  assertPricePermission(auth, input);
  return withTransaction(
    async (db) => {
      const catId = await categoryId(db, input.categorySlug);
      const { rows: loc } = await db.query(
        "SELECT id FROM locations WHERE is_active AND deleted_at IS NULL ORDER BY (location_type = 'HEADQUARTERS') DESC LIMIT 1",
      );
      let slug = slugify(`${input.brand}-${input.model}-${input.trim ?? ""}-${input.year}`);
      const { rows: taken } = await db.query("SELECT 1 FROM vehicles WHERE slug = $1 AND deleted_at IS NULL", [slug]);
      if (taken[0]) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

      const fields = Object.entries(COLUMNS).filter(([k, col]) => col && input[k] !== undefined);
      const cols = ["category_id", "slug", "home_location_id", "currency", "created_by", "updated_by", ...fields.map(([, c]) => c)];
      const vals = [catId, slug, loc[0].id, "THB", auth.user.id, auth.user.id, ...fields.map(([k]) => input[k])];
      const { rows } = await db.query(
        `INSERT INTO vehicles (${cols.join(", ")}) VALUES (${vals.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
        vals,
      );
      const id = rows[0].id;
      // Next fleet number unless staff chose one; the shop's standard service plan from day one.
      if (input.fleetNo == null) {
        await db.query("UPDATE vehicles SET fleet_no = (SELECT COALESCE(max(fleet_no), 0) + 1 FROM vehicles WHERE deleted_at IS NULL) WHERE id = $1", [id]);
      }
      await db.query(
        `INSERT INTO vehicle_maintenance (vehicle_id, maintenance_type, interval_km, interval_days, last_performed_at, last_performed_km, next_due_at, next_due_km)
         SELECT $1, p.type, p.km, p.days, now(), v.current_odometer_km,
                CASE WHEN p.days IS NOT NULL THEN now() + make_interval(days => p.days) END,
                CASE WHEN p.km IS NOT NULL THEN v.current_odometer_km + p.km END
           FROM vehicles v CROSS JOIN (VALUES ('OIL_CHANGE', 10000, 180), ('TIRE_ROTATION', 10000, NULL),
                                              ('BRAKE_SERVICE', 20000, NULL), ('INSPECTION', NULL, 365)) AS p(type, km, days)
          WHERE v.id = $1`,
        [id],
      );
      if (input.imageUrl) await setImage(db, id, input.imageUrl, `${input.brand} ${input.model}`, auth.user.id);
      if (input.features) await setFeatures(db, id, input.features);
      await recordAudit(db, ctx, { action: "vehicle.created", entityType: "vehicle", entityId: id, after: { slug, ...input } });
      return get(id, db);
    },
    { actorId: auth.user.id },
  );
}

export async function update(auth, id, input, ctx) {
  assertPricePermission(auth, input);
  return withTransaction(
    async (db) => {
      const before = await get(id, db);
      if (before.archived) throw NotFound("Vehicle");
      const set = ["updated_by = $2"];
      const params = [id, auth.user.id];
      for (const [k, col] of Object.entries(COLUMNS)) {
        if (input[k] === undefined) continue;
        params.push(k === "categorySlug" ? await categoryId(db, input[k]) : input[k]);
        set.push(`${k === "categorySlug" ? "category_id" : col} = $${params.length}`);
      }
      await db.query(`UPDATE vehicles SET ${set.join(", ")} WHERE id = $1`, params);
      if (input.imageUrl) await setImage(db, id, input.imageUrl, `${before.brand} ${before.model}`, auth.user.id);
      if (input.features) await setFeatures(db, id, input.features);
      const after = await get(id, db);
      const changed = Object.fromEntries(Object.keys(input).map((k) => [k, after[k]]));
      const action = PRICE_FIELDS.some((f) => f in input && input[f] !== before[f]) ? "vehicle.price_changed" : "vehicle.updated";
      await recordAudit(db, ctx, {
        action, entityType: "vehicle", entityId: id,
        before: Object.fromEntries(Object.keys(input).map((k) => [k, before[k]])), after: changed,
      });
      return after;
    },
    { actorId: auth.user.id },
  );
}

export async function archive(auth, id, ctx) {
  return withTransaction(
    async (db) => {
      const v = await get(id, db);
      if (v.openBookings > 0) {
        throw Conflict("VEHICLE_IN_USE", "This car has open bookings. Finish or cancel them before archiving.");
      }
      await db.query("UPDATE vehicles SET status = 'ARCHIVED', deleted_at = now(), deleted_by = $2 WHERE id = $1", [id, auth.user.id]);
      await recordAudit(db, ctx, { action: "vehicle.archived", entityType: "vehicle", entityId: id, before: { status: v.status } });
      return { id };
    },
    { actorId: auth.user.id },
  );
}
