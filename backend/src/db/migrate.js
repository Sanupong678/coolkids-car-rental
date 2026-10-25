// Minimal forward-only migration runner.
// Each .sql file runs in its own transaction and is recorded with a checksum,
// so an edited, already-applied migration is detected instead of silently skipped.
//
//   node src/db/migrate.js            apply pending migrations
//   node src/db/migrate.js --status   list applied / pending
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

export async function migrate({ log = console.log } = {}) {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    // Serialise concurrent deploys.
    await client.query("SELECT pg_advisory_lock(hashtext('schema_migrations'))");

    const applied = new Map(
      (await client.query("SELECT version, checksum FROM schema_migrations")).rows.map((r) => [r.version, r.checksum]),
    );
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

    for (const file of files) {
      const sql = await readFile(path.join(dir, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      if (applied.has(file)) {
        if (applied.get(file) !== checksum) throw new Error(`Applied migration ${file} was modified`);
        continue;
      }
      log(`→ applying ${file}`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)", [file, checksum]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${err.message}`, { cause: err });
      }
    }
    log("✓ migrations up to date");
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('schema_migrations'))").catch(() => {});
    client.release();
  }
}

async function status() {
  const applied = new Set(
    (await pool.query("SELECT version FROM schema_migrations").catch(() => ({ rows: [] }))).rows.map((r) => r.version),
  );
  for (const f of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
    console.log(`${applied.has(f) ? "applied " : "PENDING "} ${f}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (process.argv.includes("--status") ? status() : migrate())
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
