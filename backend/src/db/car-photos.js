// Moves the fleet photos that ship with the code (src/db/assets/cars, the
// Wikimedia cut-outs seeded by seed-coolkids.js) into the public R2 bucket, so
// every car image is served from Cloudflare like the ones staff upload.
// Idempotent; does nothing while storage is local.
//   npm run storage:cars
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as storage from "../shared/storage.js";
import { pool, withTransaction } from "./pool.js";

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), "assets", "cars");
const toR2 = (url) => url?.replace(/^\/cars\//, "/uploads/cars/");

/** Uploads each bundled /cars/* variant once and points its media row at R2. Returns rows moved. */
export async function carPhotosToR2(db) {
  if (storage.driver !== "r2") return 0;
  const { rows } = await db.query(
    `SELECT id, file_url, thumbnail_url, variants FROM media
      WHERE storage_provider = 'local' AND file_url LIKE '/cars/%' AND deleted_at IS NULL`,
  );
  for (const m of rows) {
    const urls = new Set([m.file_url, m.thumbnail_url, ...Object.values(m.variants ?? {})].filter((u) => u?.startsWith("/cars/")));
    let size = 0;
    for (const url of urls) {
      const file = url.slice("/cars/".length);
      const body = await readFile(path.join(ASSETS, file));
      await storage.put("public", `cars/${file}`, body, "image/webp");
      if (url === m.file_url) size = body.length;
    }
    await db.query(
      `UPDATE media SET storage_provider = 'r2', file_url = $2, thumbnail_url = $3, variants = $4, file_size_bytes = $5 WHERE id = $1`,
      [m.id, toR2(m.file_url), toR2(m.thumbnail_url),
        JSON.stringify(Object.fromEntries(Object.entries(m.variants ?? {}).map(([k, v]) => [k, toR2(v)]))), size],
    );
  }
  return rows.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  withTransaction(carPhotosToR2)
    .then((n) => console.log(storage.driver === "r2" ? `✓ ${n} car photo(s) moved to R2` : "Storage is local (S3_* not set) — nothing to move"))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
