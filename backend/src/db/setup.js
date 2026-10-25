// One command to prepare a real shop database (the VPS / production):
// schema → roles, permissions, settings → Coolkids brand, branch and fleet
// (photos to R2 when configured) → the back-office admin when ADMIN_PASSWORD is set.
// No demo fleet, promotions, customers, bookings or drivers. Idempotent.
//   npm run db:setup
import { fileURLToPath } from "node:url";
import { migrate } from "./migrate.js";
import { pool } from "./pool.js";
import { seedReference } from "./seed.js";
import { seedCoolkids } from "./seed-coolkids.js";
import { seedAdmin } from "./seed-admin.js";

export async function setup({ log = console.log } = {}) {
  await migrate({ log });
  await seedReference();
  await seedCoolkids();
  if (process.env.ADMIN_PASSWORD) {
    await seedAdmin();
    log(`✓ back-office admin "${process.env.ADMIN_LOGIN || "admin"}" ready`);
  } else {
    log("! ADMIN_PASSWORD is not set — no username/password admin created (sign in with a BOOTSTRAP_SUPER_ADMINS Google account instead)");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  setup()
    .then(() => console.log("✓ database ready"))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
