// Demo delivery drivers for the dispatch dashboard (development only): three
// staff profiles with a last-known position around Don Mueang / Bangkok.
//   npm run db:seed:drivers
// Real drivers get a staff row from the back office and report their own position.
import { fileURLToPath } from "node:url";
import { config } from "../config/env.js";
import { pool, withTransaction } from "./pool.js";

const DRIVERS = [
  { code: "CK-DRV01", name: "สมชาย ขับดี", phone: "0810000001", lat: 13.9126, lng: 100.6068 },
  { code: "CK-DRV02", name: "วิทยา ส่งไว", phone: "0810000002", lat: 13.8199, lng: 100.5603 },
  { code: "CK-DRV03", name: "นภา ใจเย็น", phone: "0810000003", lat: 13.7466, lng: 100.5393 },
];

export async function seedDrivers() {
  if (config.isProd) throw new Error("Demo drivers are for development only");
  return withTransaction(async (db) => {
    for (const d of DRIVERS) {
      const email = `${d.code.toLowerCase()}@coolkids.local`;
      let { rows } = await db.query("SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL", [email]);
      if (!rows[0]) {
        ({ rows } = await db.query("INSERT INTO users (email, full_name, locale) VALUES ($1, $2, 'th') RETURNING id", [email, d.name]));
      }
      const { rows: staff } = await db.query(
        `INSERT INTO staff (user_id, employee_code, job_title, phone, home_location_id)
         VALUES ($1, $2, 'Delivery driver', $3, (SELECT id FROM locations WHERE code = 'CK-DMK'))
         ON CONFLICT (user_id) DO UPDATE SET phone = EXCLUDED.phone RETURNING id`,
        [rows[0].id, d.code, d.phone],
      );
      await db.query(
        `INSERT INTO staff_locations (staff_id, latitude, longitude, accuracy_m) VALUES ($1, $2, $3, 25)
         ON CONFLICT (staff_id) DO UPDATE SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, recorded_at = now()`,
        [staff[0].id, d.lat, d.lng],
      );
    }
    return DRIVERS.length;
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedDrivers()
    .then((n) => console.log(`✓ ${n} demo drivers ready`))
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
