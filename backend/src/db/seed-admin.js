// Back-office login: creates (or resets) the admin user, its password, the
// "admin" role and a staff profile (needed to own delivery assignments).
//   npm run db:seed:admin
// Login/password come from ADMIN_LOGIN / ADMIN_PASSWORD. In development the
// password defaults to "1234"; production refuses anything shorter than 12.
import { fileURLToPath } from "node:url";
import { config } from "../config/env.js";
import { hashPassword } from "../shared/password.js";
import { pool, withTransaction } from "./pool.js";

export async function seedAdmin({
  login = process.env.ADMIN_LOGIN || "admin",
  password = process.env.ADMIN_PASSWORD || (config.isProd ? "" : "1234"),
} = {}) {
  if (config.isProd && password.length < 12) {
    throw new Error("Set ADMIN_PASSWORD (12+ characters) before seeding the admin in production");
  }
  const hash = await hashPassword(password);
  return withTransaction(async (db) => {
    const email = `${login.toLowerCase()}@coolkids.local`;
    let { rows } = await db.query("SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL", [email]);
    if (!rows[0]) {
      ({ rows } = await db.query(
        "INSERT INTO users (email, full_name, locale) VALUES ($1, 'Coolkids Admin', 'th') RETURNING id",
        [email],
      ));
    }
    const userId = rows[0].id;
    await db.query(
      `INSERT INTO user_credentials (user_id, login, password_hash) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET login = EXCLUDED.login, password_hash = EXCLUDED.password_hash,
             failed_attempts = 0, locked_until = NULL, password_changed_at = now()`,
      [userId, login.toLowerCase(), hash],
    );
    await db.query(
      `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = 'admin' ON CONFLICT DO NOTHING`,
      [userId],
    );
    await db.query(
      `INSERT INTO staff (user_id, employee_code, job_title, home_location_id)
       SELECT $1, $2, 'Administrator', (SELECT id FROM locations WHERE code = 'CK-DMK')
        WHERE NOT EXISTS (SELECT 1 FROM staff WHERE user_id = $1)`,
      [userId, `CK-${login.toUpperCase()}`],
    );
    return { userId, login: login.toLowerCase() };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedAdmin()
    .then(({ login }) => console.log(`✓ admin login "${login}" ready`))
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
