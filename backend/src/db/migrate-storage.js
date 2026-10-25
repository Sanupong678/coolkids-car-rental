// Copies files that are still on local disk into the configured object store
// (Cloudflare R2 / S3) and flips their media rows to the new provider.
//   npm run storage:migrate
// Safe to re-run: rows already on R2 are skipped; local files are left in place
// (delete them yourself once you have checked the site).
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";
import * as storage from "../shared/storage.js";

export async function migrateStorage({ log = console.log } = {}) {
  if (storage.driver !== "r2") throw new Error("S3_* is not configured in .env — nothing to migrate to");
  const { rows } = await pool.query(
    "SELECT id, storage_key, mime_type, is_private FROM media WHERE storage_provider = 'local' AND deleted_at IS NULL ORDER BY created_at",
  );
  let moved = 0;
  let skipped = 0;
  for (const m of rows) {
    // Public uploads are keyed by their URL ("/uploads/vehicles/x.jpg"); seed images under /cars are frontend assets.
    const isUpload = m.storage_key.startsWith("/uploads/");
    if (!m.is_private && !isUpload) {
      skipped++;
      continue;
    }
    const visibility = m.is_private ? "private" : "public";
    const key = isUpload ? m.storage_key.slice("/uploads/".length) : m.storage_key;
    const file = await storage.get(visibility, key, "local");
    if (!file) {
      log(`  ! missing on disk: ${m.storage_key}`);
      skipped++;
      continue;
    }
    await storage.put(visibility, key, file.body, m.mime_type === "image/*" ? undefined : m.mime_type);
    await pool.query("UPDATE media SET storage_provider = 'r2' WHERE id = $1", [m.id]);
    moved++;
  }
  log(`✓ ${moved} file(s) copied to R2, ${skipped} skipped`);
  return { moved, skipped };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrateStorage()
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
