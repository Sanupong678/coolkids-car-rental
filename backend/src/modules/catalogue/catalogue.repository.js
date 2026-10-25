import { pool } from "../../db/pool.js";

// Read-only queries for the public catalogue. Only ACTIVE, non-archived
// vehicles in active categories are ever exposed here.

const LIVE_VEHICLE = `v.status = 'ACTIVE' AND v.deleted_at IS NULL AND c.deleted_at IS NULL AND c.is_active`;

// Best auto-applied promotion currently running for vehicle `v` (expired or
// code-only promotions are never shown as automatic discounts — rule 11).
const BEST_PROMO = `
  LEFT JOIN LATERAL (
    SELECT pr.id, pr.slug, pr.name, pr.discount_type, pr.discount_value, pr.max_discount_minor,
           pr.min_rental_days, pr.ends_at
      FROM promotions pr
     WHERE pr.status = 'ACTIVE' AND pr.deleted_at IS NULL AND pr.code IS NULL
       AND now() >= pr.starts_at AND now() < pr.ends_at
       AND (pr.applies_to_all
            OR EXISTS (SELECT 1 FROM promotion_vehicles pv WHERE pv.promotion_id = pr.id AND pv.vehicle_id = v.id)
            OR EXISTS (SELECT 1 FROM promotion_categories pc WHERE pc.promotion_id = pr.id AND pc.category_id = v.category_id))
     ORDER BY CASE pr.discount_type
                WHEN 'PERCENT' THEN LEAST(v.daily_rate_minor * pr.discount_value / 10000,
                                          COALESCE(pr.max_discount_minor, v.daily_rate_minor))
                WHEN 'FIXED_PER_DAY' THEN LEAST(pr.discount_value, v.daily_rate_minor)
                ELSE 0 END DESC,
              pr.priority DESC
     LIMIT 1
  ) p ON true`;

const PRIMARY_IMAGE = `
  LEFT JOIN LATERAL (
    SELECT m.file_url, m.variants, m.alt_text
      FROM vehicle_images vi JOIN media m ON m.id = vi.media_id
     WHERE vi.vehicle_id = v.id AND vi.role = 'PRIMARY' AND vi.deleted_at IS NULL AND m.deleted_at IS NULL
     LIMIT 1
  ) img ON true`;

const CARD_COLUMNS = `
  v.id, v.slug, v.brand, v.model, v.trim, v.model_year, v.transmission, v.fuel_type, v.drive_type,
  v.seats, v.doors, v.luggage_liters, v.power_hp, v.range_km, v.currency, v.daily_rate_minor,
  v.deposit_minor, v.min_rental_days, v.is_featured,
  c.slug AS category_slug, c.name AS category_name,
  img.file_url AS image_url, img.variants AS image_variants, img.alt_text AS image_alt,
  p.id AS promo_id, p.slug AS promo_slug, p.name AS promo_name, p.discount_type AS promo_type,
  p.discount_value AS promo_value, p.max_discount_minor AS promo_max, p.min_rental_days AS promo_min_days,
  p.ends_at AS promo_ends_at`;

const ORDER_BY = {
  recommended: "v.is_featured DESC, c.sort_order, v.daily_rate_minor",
  price_asc: "v.daily_rate_minor ASC, v.id",
  price_desc: "v.daily_rate_minor DESC, v.id",
  newest: "v.model_year DESC, v.daily_rate_minor",
  power_desc: "v.power_hp DESC NULLS LAST, v.id",
};

export async function listVehicles(f) {
  const params = [];
  const where = [LIVE_VEHICLE];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replaceAll("?", `$${params.length}`));
  };

  if (f.category?.length) add("c.slug = ANY(?::text[])", f.category);
  if (f.brand?.length) add("lower(v.brand) = ANY(?::text[])", f.brand.map((b) => b.toLowerCase()));
  if (f.transmission?.length) add("v.transmission = ANY(?::text[])", f.transmission);
  if (f.fuel?.length) add("v.fuel_type = ANY(?::text[])", f.fuel);
  if (f.drive?.length) add("v.drive_type = ANY(?::text[])", f.drive);
  if (f.seats) add("v.seats >= ?", f.seats);
  if (f.yearMin) add("v.model_year >= ?", f.yearMin);
  if (f.priceMin != null) add("v.daily_rate_minor >= ?", f.priceMin);
  if (f.priceMax != null) add("v.daily_rate_minor <= ?", f.priceMax);
  if (f.price?.length) {
    const ranges = f.price.map((r) => {
      const [min, max] = r.split("-");
      params.push(Number(min));
      const lo = `v.daily_rate_minor >= $${params.length}`;
      if (!max) return `(${lo})`;
      params.push(Number(max));
      return `(${lo} AND v.daily_rate_minor <= $${params.length})`;
    });
    where.push(`(${ranges.join(" OR ")})`);
  }
  if (f.featured) where.push("v.is_featured");
  if (f.q) add("(v.brand || ' ' || v.model || ' ' || COALESCE(v.trim, '')) ILIKE '%' || ? || '%'", f.q);
  if (f.from) {
    params.push(f.from, f.to);
    const [a, b] = [params.length - 1, params.length];
    // Same overlap rule the EXCLUDE constraint uses, including the turnaround buffer.
    where.push(`NOT EXISTS (
      SELECT 1 FROM vehicle_availability_blocks b
       WHERE b.vehicle_id = v.id AND b.released_at IS NULL
         AND b.during && tstzrange($${a}::timestamptz, $${b}::timestamptz + make_interval(mins => v.turnaround_minutes), '[)'))`);
  }

  params.push(f.pageSize, (f.page - 1) * f.pageSize);
  const { rows } = await pool.query(
    `SELECT ${CARD_COLUMNS}, count(*) OVER () AS total_count
       FROM vehicles v JOIN vehicle_categories c ON c.id = v.category_id
       ${PRIMARY_IMAGE} ${BEST_PROMO}
      WHERE ${where.join(" AND ")}
      ORDER BY ${ORDER_BY[f.sort]}
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { rows, total: rows[0]?.total_count ?? 0 };
}

/** Facets for the filter sidebar, computed over the whole live fleet. */
export async function vehicleFacets() {
  const { rows } = await pool.query(
    `SELECT
       (SELECT json_agg(x ORDER BY x.name) FROM (
          SELECT v.brand AS name, count(*)::int AS count
            FROM vehicles v JOIN vehicle_categories c ON c.id = v.category_id
           WHERE ${LIVE_VEHICLE} GROUP BY v.brand) x) AS brands,
       (SELECT json_agg(x ORDER BY x.sort_order) FROM (
          SELECT c.slug, c.name, c.sort_order, count(v.id)::int AS count
            FROM vehicle_categories c
            LEFT JOIN vehicles v ON v.category_id = c.id AND v.status = 'ACTIVE' AND v.deleted_at IS NULL
           WHERE c.deleted_at IS NULL AND c.is_active GROUP BY c.id) x) AS categories,
       (SELECT json_build_object('min', min(v.daily_rate_minor), 'max', max(v.daily_rate_minor),
                                 'seatsMax', max(v.seats), 'yearMin', min(v.model_year), 'currency', min(v.currency))
          FROM vehicles v JOIN vehicle_categories c ON c.id = v.category_id WHERE ${LIVE_VEHICLE}) AS ranges`,
  );
  return rows[0];
}

export async function findVehicleBySlug(slug) {
  const { rows } = await pool.query(
    `SELECT ${CARD_COLUMNS},
            v.description, v.color, v.engine_displacement_cc, v.torque_nm, v.battery_kwh, v.fuel_economy_l_100km,
            v.length_mm, v.width_mm, v.height_mm, v.wheelbase_mm, v.max_rental_days, v.min_driver_age,
            v.hourly_rate_minor, v.delivery_free_km, v.delivery_per_km_minor, v.delivery_min_fee_minor,
            json_build_object('id', l.id, 'name', l.name, 'city', l.city, 'code', l.code) AS home_location,
            COALESCE((SELECT json_agg(json_build_object('code', f.code, 'name', f.name, 'group', f.feature_group,
                                                       'icon', f.icon, 'detail', vf.detail) ORDER BY f.feature_group, f.name)
                        FROM vehicle_features vf JOIN features f ON f.id = vf.feature_id
                       WHERE vf.vehicle_id = v.id), '[]') AS features,
            COALESCE((SELECT json_agg(json_build_object('url', m.file_url, 'variants', m.variants, 'alt', m.alt_text,
                                                       'role', vi.role) ORDER BY vi.role = 'PRIMARY' DESC, vi.sort_order)
                        FROM vehicle_images vi JOIN media m ON m.id = vi.media_id
                       WHERE vi.vehicle_id = v.id AND vi.deleted_at IS NULL AND m.deleted_at IS NULL), '[]') AS images,
            COALESCE((SELECT json_agg(json_build_object('url', m.file_url, 'format', a.format, 'config', a.viewer_config))
                        FROM vehicle_3d_assets a JOIN media m ON m.id = a.media_id
                       WHERE a.vehicle_id = v.id AND a.deleted_at IS NULL), '[]') AS models_3d
       FROM vehicles v
       JOIN vehicle_categories c ON c.id = v.category_id
       JOIN locations l ON l.id = v.home_location_id
       ${PRIMARY_IMAGE} ${BEST_PROMO}
      WHERE v.slug = $1 AND ${LIVE_VEHICLE}`,
    [slug],
  );
  return rows[0] ?? null;
}

/**
 * Day-by-day calendar for one vehicle, evaluated in the vehicle's home-location
 * timezone. A day takes the "worst" status of any live block touching it.
 */
export async function vehicleAvailability(vehicleId, from, to) {
  const { rows } = await pool.query(
    `WITH v AS (
       SELECT v.id, v.status, l.timezone FROM vehicles v JOIN locations l ON l.id = v.home_location_id
        WHERE v.id = $1 AND v.deleted_at IS NULL
     ), days AS (
       SELECT d::date AS day,
              tstzrange((d::date)::timestamp AT TIME ZONE v.timezone,
                        (d::date + 1)::timestamp AT TIME ZONE v.timezone, '[)') AS span,
              v.status AS vehicle_status, v.timezone
         FROM v, generate_series($2::date, $3::date, interval '1 day') AS g(d)
     )
     SELECT to_char(days.day, 'YYYY-MM-DD') AS date,
            CASE
              WHEN days.vehicle_status <> 'ACTIVE' THEN 'UNAVAILABLE'
              WHEN days.day < (now() AT TIME ZONE days.timezone)::date THEN 'UNAVAILABLE'
              WHEN bool_or(b.block_type = 'MAINTENANCE') THEN 'MAINTENANCE'
              WHEN bool_or(b.block_type = 'BOOKING') THEN 'BOOKED'
              WHEN bool_or(b.block_type = 'UNAVAILABLE') THEN 'UNAVAILABLE'
              ELSE 'AVAILABLE'
            END AS status
       FROM days
       LEFT JOIN vehicle_availability_blocks b
              ON b.vehicle_id = $1 AND b.released_at IS NULL AND b.during && days.span
      GROUP BY days.day, days.vehicle_status, days.timezone
      ORDER BY days.day`,
    [vehicleId, from, to],
  );
  return rows;
}

export async function listCategories() {
  const { rows } = await pool.query(
    `SELECT c.id, c.slug, c.name, c.description, m.file_url AS image_url, m.variants AS image_variants,
            count(v.id)::int AS available_count,
            min(v.daily_rate_minor) AS from_daily_minor, min(v.currency) AS currency
       FROM vehicle_categories c
       LEFT JOIN media m ON m.id = c.image_media_id
       LEFT JOIN vehicles v ON v.category_id = c.id AND v.status = 'ACTIVE' AND v.deleted_at IS NULL
      WHERE c.deleted_at IS NULL AND c.is_active
      GROUP BY c.id, m.id
      ORDER BY c.sort_order, c.name`,
  );
  return rows;
}

export async function listLocations() {
  const { rows } = await pool.query(
    `SELECT id, code, name, location_type, address_line1, address_line2, city, region, postal_code, country_code,
            latitude::float AS latitude, longitude::float AS longitude, timezone, phone, email,
            opening_hours, services, pickup_fee_minor, return_fee_minor
       FROM locations WHERE is_active AND deleted_at IS NULL ORDER BY sort_order, name`,
  );
  return rows;
}

export async function listActivePromotions() {
  const { rows } = await pool.query(
    `SELECT p.id, p.slug, p.name, p.description, p.terms, p.discount_type, p.discount_value, p.max_discount_minor,
            p.min_rental_days, p.max_rental_days, p.starts_at, p.ends_at, p.is_featured, p.currency,
            m.file_url AS banner_url,
            p.applies_to_all,
            COALESCE((SELECT json_agg(json_build_object('slug', c.slug, 'name', c.name))
                        FROM promotion_categories pc JOIN vehicle_categories c ON c.id = pc.category_id
                       WHERE pc.promotion_id = p.id), '[]') AS categories,
            COALESCE((SELECT json_agg(json_build_object('slug', v.slug, 'name', v.brand || ' ' || v.model))
                        FROM promotion_vehicles pv JOIN vehicles v ON v.id = pv.vehicle_id
                       WHERE pv.promotion_id = p.id), '[]') AS vehicles
       FROM promotions p LEFT JOIN media m ON m.id = p.banner_media_id
      WHERE p.status = 'ACTIVE' AND p.deleted_at IS NULL AND now() >= p.starts_at AND now() < p.ends_at
      ORDER BY p.is_featured DESC, p.priority DESC, p.ends_at`,
  );
  return rows;
}

/** Everything the booking service needs about a live vehicle, including its best running promotion. */
export async function findVehicleForBooking(db, slug) {
  const { rows } = await db.query(
    `SELECT ${CARD_COLUMNS}, v.license_plate, v.color, v.min_driver_age, v.max_rental_days, v.turnaround_minutes,
            v.home_location_id, l.name AS location_name, l.address_line1 AS location_address, l.city AS location_city,
            l.latitude::float AS location_lat, l.longitude::float AS location_lng, l.timezone
       FROM vehicles v
       JOIN vehicle_categories c ON c.id = v.category_id
       JOIN locations l ON l.id = v.home_location_id
       ${PRIMARY_IMAGE} ${BEST_PROMO}
      WHERE v.slug = $1 AND ${LIVE_VEHICLE}
      FOR SHARE OF v`,
    [slug],
  );
  return rows[0] ?? null;
}
