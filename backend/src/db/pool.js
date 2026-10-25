import pg from "pg";
import { config } from "../config/env.js";

// BIGINT columns (money in minor units, identity ids) come back as JS numbers.
// Amounts are far below 2^53, and the API never does float arithmetic on them.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export const pool = new pg.Pool({
  host: config.DB_HOST,
  port: config.DB_PORT,
  database: config.DB_NAME,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  max: config.DB_POOL_MAX,
  idleTimeoutMillis: 30_000,
  application_name: "car-rental-api",
});

/**
 * Run `fn(client)` inside a transaction.
 * `actorId` is exposed to triggers as `app.actor_id` (status history, price history).
 * `isolation` lets callers opt into SERIALIZABLE for read-check-write flows.
 */
export async function withTransaction(fn, { actorId = null, isolation = "READ COMMITTED" } = {}) {
  const client = await pool.connect();
  try {
    await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
    if (actorId) await client.query("SELECT set_config('app.actor_id', $1, true)", [actorId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
