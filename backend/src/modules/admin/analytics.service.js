import { config } from "../../config/env.js";
import { pool } from "../../db/pool.js";
import { BadRequest } from "../../shared/errors.js";

// Dashboard analytics straight from OLTP (fine at this fleet size; the `dw`
// star schema is the scale-out path). Conventions every number follows:
//   * days are Asia/Bangkok calendar days
//   * revenue = captured payments net of refunds, dated by capture time (cash basis);
//     security deposits are held money, not revenue, so they are left out
//   * a "booking" counts once it is paid (confirmed_at), dated by confirmation
//   * customers are pseudonymised in exports (keyed HMAC of user id), never named

const TZ = "Asia/Bangkok";
const WON = "('CONFIRMED','PREPARING','READY','IN_DELIVERY','ACTIVE','COMPLETED')";
const local = (col) => `(${col} AT TIME ZONE '${TZ}')::date`;
const todayLocal = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// sum()/avg() return NUMERIC, which pg hands back as strings; charts want numbers.
const NUMERIC_OID = 1700;
async function many(sql, params) {
  const { rows, fields } = await pool.query(sql, params);
  const numeric = fields.filter((f) => f.dataTypeID === NUMERIC_OID).map((f) => f.name);
  for (const r of rows) for (const k of numeric) if (r[k] != null) r[k] = Number(r[k]);
  return rows;
}
const one = async (sql, params) => (await many(sql, params))[0];

export function periodFor(days, to = todayLocal()) {
  if (!Number.isInteger(days) || days < 1 || days > 730) throw BadRequest("days must be 1–730");
  return { from: addDays(to, -(days - 1)), to, days };
}

async function kpis(from, to, days) {
  const prevFrom = addDays(from, -days);
  const prevTo = addDays(from, -1);
  const today = todayLocal();
  const r = await one(
    `SELECT
       (SELECT COALESCE(sum(amount_minor - amount_refunded_minor), 0) FROM payments
         WHERE succeeded_at IS NOT NULL AND purpose <> 'DEPOSIT' AND ${local("succeeded_at")} BETWEEN $1 AND $2) AS revenue,
       (SELECT COALESCE(sum(amount_minor - amount_refunded_minor), 0) FROM payments
         WHERE succeeded_at IS NOT NULL AND purpose <> 'DEPOSIT' AND ${local("succeeded_at")} BETWEEN $3 AND $4) AS revenue_prev,
       (SELECT COALESCE(sum(amount_minor - amount_refunded_minor), 0) FROM payments
         WHERE succeeded_at IS NOT NULL AND purpose <> 'DEPOSIT' AND ${local("succeeded_at")} = $5) AS revenue_today,
       (SELECT count(*) FROM bookings WHERE confirmed_at IS NOT NULL AND ${local("confirmed_at")} BETWEEN $1 AND $2)::int AS bookings,
       (SELECT count(*) FROM bookings WHERE confirmed_at IS NOT NULL AND ${local("confirmed_at")} BETWEEN $3 AND $4)::int AS bookings_prev,
       (SELECT count(*) FROM bookings WHERE confirmed_at IS NOT NULL AND ${local("confirmed_at")} = $5)::int AS bookings_today,
       (SELECT count(*) FROM bookings WHERE status IN ${WON} AND ${local("pickup_at")} = $5)::int AS pickups_today,
       (SELECT count(DISTINCT user_id) FROM bookings
         WHERE (status IN ${WON} AND ${local("pickup_at")} = $5) OR (confirmed_at IS NOT NULL AND ${local("confirmed_at")} = $5))::int AS customers_today,
       (SELECT count(*) FROM users u WHERE ${local("u.created_at")} = $5
           AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id))::int AS signups_today,
       (SELECT count(*) FROM bookings WHERE status = 'PENDING' AND hold_expires_at > now())::int AS pending_payment,
       (SELECT count(*) FROM bookings WHERE status IN ('CONFIRMED','PREPARING','READY'))::int AS to_deliver,
       (SELECT count(*) FROM bookings WHERE status = 'IN_DELIVERY')::int AS in_delivery,
       (SELECT avg(total_minor) FROM bookings WHERE confirmed_at IS NOT NULL AND ${local("confirmed_at")} BETWEEN $1 AND $2)::bigint AS aov,
       (SELECT avg(rental_days) FROM bookings WHERE confirmed_at IS NOT NULL AND ${local("confirmed_at")} BETWEEN $1 AND $2)::float AS avg_rental_days,
       (SELECT avg(EXTRACT(epoch FROM pickup_at - created_at) / 86400) FROM bookings
         WHERE confirmed_at IS NOT NULL AND ${local("confirmed_at")} BETWEEN $1 AND $2)::float AS avg_lead_days,
       (SELECT count(*) FILTER (WHERE status IN ('CANCELLED','REFUNDED'))::float / NULLIF(count(*) FILTER (WHERE confirmed_at IS NOT NULL OR status IN ('CANCELLED','REFUNDED')), 0)
          FROM bookings WHERE ${local("created_at")} BETWEEN $1 AND $2) AS cancellation_rate,
       (SELECT count(*) FILTER (WHERE confirmed_at IS NOT NULL)::float / NULLIF(count(*), 0)
          FROM bookings WHERE ${local("created_at")} BETWEEN $1 AND $2) AS checkout_conversion,
       (SELECT count(*) FILTER (WHERE customer_country <> 'TH')::float / NULLIF(count(*), 0)
          FROM bookings WHERE confirmed_at IS NOT NULL AND ${local("confirmed_at")} BETWEEN $1 AND $2) AS foreign_share,
       (SELECT count(*) FROM vehicles WHERE status = 'ACTIVE' AND deleted_at IS NULL)::int AS active_vehicles`,
    [from, to, prevFrom, prevTo, today],
  );
  const util = await one(
    `WITH w AS (SELECT ($1::date::timestamp AT TIME ZONE '${TZ}') AS lo, (($2::date + 1)::timestamp AT TIME ZONE '${TZ}') AS hi)
     SELECT COALESCE(sum(EXTRACT(epoch FROM LEAST(upper(b.during), w.hi) - GREATEST(lower(b.during), w.lo))) / 3600, 0)::float AS booked_hours
       FROM vehicle_availability_blocks b JOIN bookings bk ON bk.id = b.booking_id, w
      WHERE b.block_type = 'BOOKING' AND b.released_at IS NULL AND bk.status IN ${WON} AND b.during && tstzrange(w.lo, w.hi)`,
    [from, to],
  );
  const fleetHours = r.active_vehicles * days * 24;
  return { ...r, utilization: fleetHours ? util.booked_hours / fleetHours : null, booked_hours: util.booked_hours };
}

export async function overview(days) {
  const { from, to } = periodFor(days);
  const range = [from, to];
  const [k, series, byCategory, topVehicles, weekday, leadTime, rentalLength, nationality, paymentMethods, fulfillment, funnel, age, gender, delivery] =
    await Promise.all([
      kpis(from, to, days),
      many(
        `SELECT to_char(g.d, 'YYYY-MM-DD') AS date,
                COALESCE((SELECT sum(p.amount_minor - p.amount_refunded_minor) FROM payments p
                           WHERE p.succeeded_at IS NOT NULL AND p.purpose <> 'DEPOSIT' AND ${local("p.succeeded_at")} = g.d), 0) AS revenue,
                (SELECT count(*) FROM bookings b WHERE b.confirmed_at IS NOT NULL AND ${local("b.confirmed_at")} = g.d)::int AS bookings,
                (SELECT count(*) FROM bookings b WHERE b.cancelled_at IS NOT NULL AND ${local("b.cancelled_at")} = g.d)::int AS cancellations,
                (SELECT count(*) FROM users u WHERE ${local("u.created_at")} = g.d
                   AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id))::int AS signups
           FROM generate_series($1::date, $2::date, interval '1 day') AS g(d) ORDER BY g.d`,
        range,
      ),
      many(
        `SELECT c.name, count(*)::int AS bookings, sum(b.total_minor) AS revenue
           FROM bookings b JOIN vehicles v ON v.id = b.vehicle_id JOIN vehicle_categories c ON c.id = v.category_id
          WHERE b.status IN ${WON} AND ${local("b.confirmed_at")} BETWEEN $1 AND $2 GROUP BY c.name ORDER BY revenue DESC`,
        range,
      ),
      many(
        `SELECT v.brand || ' ' || v.model || COALESCE(' ' || v.trim, '') AS name, v.license_plate AS plate,
                count(*)::int AS bookings, sum(b.total_minor) AS revenue, sum(b.rental_days)::int AS rental_days
           FROM bookings b JOIN vehicles v ON v.id = b.vehicle_id
          WHERE b.status IN ${WON} AND ${local("b.confirmed_at")} BETWEEN $1 AND $2
          GROUP BY v.id ORDER BY revenue DESC LIMIT 8`,
        range,
      ),
      many(
        `SELECT g.dow, COALESCE(x.n, 0)::int AS bookings FROM generate_series(1, 7) AS g(dow)
           LEFT JOIN (SELECT EXTRACT(isodow FROM b.pickup_at AT TIME ZONE '${TZ}')::int AS dow, count(*) AS n FROM bookings b
                       WHERE b.status IN ${WON} AND ${local("b.confirmed_at")} BETWEEN $1 AND $2 GROUP BY 1) x ON x.dow = g.dow
          ORDER BY g.dow`,
        range,
      ),
      bucketed(
        "EXTRACT(epoch FROM b.pickup_at - b.created_at) / 86400",
        [[0, 1, "< 1 วัน"], [1, 3, "1–3 วัน"], [3, 7, "3–7 วัน"], [7, 14, "1–2 สัปดาห์"], [14, 30, "2–4 สัปดาห์"], [30, null, "30+ วัน"]],
        range,
      ),
      bucketed(
        "b.rental_days",
        [[1, 2, "1 วัน"], [2, 3, "2 วัน"], [3, 4, "3 วัน"], [4, 7, "4–6 วัน"], [7, 14, "7–13 วัน"], [14, 30, "14–29 วัน"], [30, null, "30+ วัน"]],
        range,
      ),
      many(
        `SELECT COALESCE(b.customer_country, '??') AS country, count(*)::int AS bookings, sum(b.total_minor) AS revenue
           FROM bookings b WHERE b.status IN ${WON} AND ${local("b.confirmed_at")} BETWEEN $1 AND $2
          GROUP BY 1 ORDER BY bookings DESC LIMIT 12`,
        range,
      ),
      many(
        `SELECT p.provider, COALESCE(p.payment_method_type, 'unknown') AS method, count(*)::int AS payments, sum(p.amount_minor) AS amount
           FROM payments p WHERE p.status = 'SUCCEEDED' AND ${local("p.succeeded_at")} BETWEEN $1 AND $2 GROUP BY 1, 2 ORDER BY amount DESC`,
        range,
      ),
      many(
        `SELECT b.fulfillment_type AS type, count(*)::int AS bookings, sum(b.total_minor) AS revenue
           FROM bookings b WHERE b.status IN ${WON} AND ${local("b.confirmed_at")} BETWEEN $1 AND $2 GROUP BY 1`,
        range,
      ),
      many(
        `SELECT b.status, count(*)::int AS bookings FROM bookings b WHERE ${local("b.created_at")} BETWEEN $1 AND $2 GROUP BY 1`,
        range,
      ),
      many(
        `SELECT CASE WHEN a < 25 THEN '20–24' WHEN a < 35 THEN '25–34' WHEN a < 45 THEN '35–44' WHEN a < 55 THEN '45–54' ELSE '55+' END AS band,
                count(*)::int AS bookings
           FROM (SELECT date_part('year', age(b.pickup_at, ci.date_of_birth)) AS a FROM bookings b
                   JOIN customer_identities ci ON ci.id = b.customer_identity_id
                  WHERE b.status IN ${WON} AND ${local("b.confirmed_at")} BETWEEN $1 AND $2) x
          GROUP BY 1 ORDER BY 1`,
        range,
      ),
      many(
        `SELECT COALESCE(u.gender, 'unknown') AS gender, count(*)::int AS bookings FROM bookings b JOIN users u ON u.id = b.user_id
          WHERE b.status IN ${WON} AND ${local("b.confirmed_at")} BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 2 DESC`,
        range,
      ),
      one(
        `SELECT count(*)::int AS deliveries,
                avg(b.delivery_distance_m) / 1000.0 AS avg_distance_km,
                avg(b.delivery_duration_s) / 60.0 AS avg_estimated_min,
                avg(EXTRACT(epoch FROM b.delivered_at - h.changed_at) / 60) AS avg_actual_min,
                avg(EXTRACT(epoch FROM b.delivered_at - b.delivery_eta_at) / 60) AS avg_eta_error_min
           FROM bookings b
           LEFT JOIN LATERAL (SELECT changed_at FROM booking_status_history
                               WHERE booking_id = b.id AND to_status = 'IN_DELIVERY' ORDER BY changed_at DESC LIMIT 1) h ON true
          WHERE b.fulfillment_type = 'DELIVERY' AND b.status IN ${WON} AND ${local("b.confirmed_at")} BETWEEN $1 AND $2`,
        range,
      ),
    ]);
  return {
    period: { from, to, days },
    currency: "THB",
    kpis: k,
    series,
    byCategory,
    topVehicles,
    weekday,
    leadTime,
    rentalLength,
    nationality,
    paymentMethods,
    fulfillment,
    funnel,
    demographics: { age, gender },
    delivery,
  };
}

async function bucketed(expr, buckets, range) {
  const cases = buckets
    .map(([lo, hi, label]) => `WHEN ${expr} >= ${lo}${hi == null ? "" : ` AND ${expr} < ${hi}`} THEN '${label}'`)
    .join(" ");
  const rows = await many(
    `SELECT CASE ${cases} END AS label, count(*)::int AS bookings FROM bookings b
      WHERE b.status IN ${WON} AND ${local("b.confirmed_at")} BETWEEN $1 AND $2 GROUP BY 1`,
    range,
  );
  const by = Object.fromEntries(rows.map((r) => [r.label, r.bookings]));
  return buckets.map(([, , label]) => ({ label, bookings: by[label] ?? 0 }));
}

// ---------------------------------------------------------------- exports

const CUSTOMER_KEY = "left(encode(hmac(b.user_id::text, $3, 'sha256'), 'hex'), 16)";

/** Flat, analysis-ready datasets. Columns are stable: add new ones at the end. */
export const DATASETS = {
  bookings: {
    description: "One row per booking (accumulating snapshot). Grain: booking.",
    sql: `SELECT b.booking_number, b.status, b.source, b.fulfillment_type,
                 b.created_at, b.confirmed_at, b.cancelled_at, b.pickup_at, b.return_at, b.actual_pickup_at, b.actual_return_at,
                 round(EXTRACT(epoch FROM b.pickup_at - b.created_at) / 86400, 2) AS lead_time_days, b.rental_days,
                 v.slug AS vehicle_slug, v.brand, v.model, v.model_year, c.slug AS category,
                 b.currency, b.subtotal_minor, b.discount_minor, b.tax_minor, b.total_minor, b.deposit_minor,
                 pr.slug AS promotion, b.delivery_distance_m, b.delivery_duration_s, b.delivery_eta_at, b.delivered_at,
                 ${CUSTOMER_KEY} AS customer_key, b.customer_country,
                 date_part('year', age(b.pickup_at, ci.date_of_birth))::int AS customer_age, u.gender AS customer_gender
            FROM bookings b JOIN vehicles v ON v.id = b.vehicle_id JOIN vehicle_categories c ON c.id = v.category_id
            JOIN users u ON u.id = b.user_id LEFT JOIN customer_identities ci ON ci.id = b.customer_identity_id
            LEFT JOIN promotions pr ON pr.id = b.promotion_id
           WHERE ${local("b.created_at")} BETWEEN $1 AND $2 ORDER BY b.created_at`,
  },
  payments: {
    description: "One row per payment attempt. Grain: payment.",
    sql: `SELECT p.id AS payment_id, b.booking_number, p.purpose, p.provider, p.status, p.amount_minor, p.amount_refunded_minor,
                 p.currency, p.payment_method_type, p.failure_code, p.created_at, p.succeeded_at, ${CUSTOMER_KEY} AS customer_key
            FROM payments p JOIN bookings b ON b.id = p.booking_id
           WHERE ${local("p.created_at")} BETWEEN $1 AND $2 ORDER BY p.created_at`,
  },
  status_history: {
    description: "Every booking status change (event log). Grain: transition.",
    sql: `SELECT b.booking_number, h.from_status, h.to_status, h.changed_at, h.reason
            FROM booking_status_history h JOIN bookings b ON b.id = h.booking_id
           WHERE ${local("h.changed_at")} BETWEEN $1 AND $2 AND $3::text IS NOT NULL ORDER BY h.changed_at`,
  },
  daily_kpis: {
    description: "Business KPIs per Bangkok calendar day. Grain: day.",
    sql: `SELECT g.d::date AS date,
                 COALESCE((SELECT sum(p.amount_minor - p.amount_refunded_minor) FROM payments p
                            WHERE p.succeeded_at IS NOT NULL AND p.purpose <> 'DEPOSIT' AND ${local("p.succeeded_at")} = g.d), 0) AS revenue_minor,
                 (SELECT count(*) FROM bookings b WHERE b.confirmed_at IS NOT NULL AND ${local("b.confirmed_at")} = g.d) AS bookings,
                 (SELECT count(*) FROM bookings b WHERE b.cancelled_at IS NOT NULL AND ${local("b.cancelled_at")} = g.d) AS cancellations,
                 (SELECT count(*) FROM bookings b WHERE b.status IN ${WON} AND ${local("b.pickup_at")} = g.d) AS pickups,
                 (SELECT count(*) FROM users u WHERE ${local("u.created_at")} = g.d) AS signups
            FROM generate_series($1::date, $2::date, interval '1 day') AS g(d) WHERE $3::text IS NOT NULL ORDER BY g.d`,
  },
  vehicles: {
    description: "Fleet master data with lifetime performance. Grain: vehicle.",
    sql: `SELECT v.slug, v.brand, v.model, v.trim, v.model_year, c.slug AS category, v.status, v.transmission, v.fuel_type,
                 v.seats, v.currency, v.daily_rate_minor, v.deposit_minor, v.current_odometer_km, v.created_at,
                 (SELECT count(*) FROM bookings b WHERE b.vehicle_id = v.id AND b.status IN ${WON}) AS lifetime_bookings,
                 (SELECT COALESCE(sum(b.total_minor), 0) FROM bookings b WHERE b.vehicle_id = v.id AND b.status IN ${WON}) AS lifetime_revenue_minor
            FROM vehicles v JOIN vehicle_categories c ON c.id = v.category_id
           WHERE $1::date IS NOT NULL AND $2::date IS NOT NULL AND $3::text IS NOT NULL ORDER BY v.brand, v.model`,
  },
  price_history: {
    description: "Daily-rate changes per vehicle (for price elasticity). Grain: price change.",
    sql: `SELECT v.slug AS vehicle_slug, h.daily_rate_minor, h.deposit_minor, h.currency, h.effective_from
            FROM vehicle_price_history h JOIN vehicles v ON v.id = h.vehicle_id
           WHERE ${local("h.effective_from")} <= $2 AND $1::date IS NOT NULL AND $3::text IS NOT NULL ORDER BY h.effective_from`,
  },
  deliveries: {
    description: "Delivery jobs with planned vs actual timing. Grain: delivery assignment.",
    sql: `SELECT b.booking_number, d.status, d.scheduled_at, d.started_at, d.eta_at, d.completed_at,
                 round(EXTRACT(epoch FROM d.completed_at - d.started_at) / 60, 1) AS actual_minutes,
                 round(b.delivery_duration_s / 60.0, 1) AS estimated_minutes, b.delivery_distance_m
            FROM delivery_assignments d JOIN bookings b ON b.id = d.booking_id
           WHERE ${local("d.created_at")} BETWEEN $1 AND $2 AND $3::text IS NOT NULL ORDER BY d.created_at`,
  },
};

export async function exportDataset(name, from, to) {
  const ds = DATASETS[name];
  if (!ds) throw BadRequest(`Unknown dataset ${name}`);
  const { rows, fields } = await pool.query(ds.sql, [from, to, config.PII_HMAC_KEY]);
  return { columns: fields.map((f) => f.name), rows };
}

const cell = (v) => {
  if (v == null) return "";
  let s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  // Text starting with = + - @ (or tab/CR) would run as a formula in Excel/Sheets: neutralise it.
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
export const toCsv = ({ columns, rows }) => [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\r\n");
