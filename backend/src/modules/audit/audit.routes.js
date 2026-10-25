import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { requirePermission } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { PERMISSIONS } from "../rbac/permissions.js";

const querySchema = z.object({
  entityType: z.string().max(50).optional(),
  entityId: z.string().max(100).optional(),
  actorUserId: z.uuid().optional(),
  action: z.string().max(80).optional(),
  before: z.coerce.number().int().positive().optional(), // keyset cursor: id of the last row seen
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// /api/v1/admin/audit-logs — read-only; the table itself rejects UPDATE/DELETE.
export function auditRoutes() {
  const router = Router();

  router.get("/", requirePermission(PERMISSIONS.AUDIT_READ), validate({ query: querySchema }), async (req, res) => {
    const q = req.valid.query;
    const { rows } = await pool.query(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.previous_state, a.new_state, a.occurred_at,
              a.actor_user_id, a.actor_roles, u.full_name AS actor_name, host(a.ip_address) AS ip_address
         FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE ($1::text IS NULL OR a.entity_type = $1)
          AND ($2::text IS NULL OR a.entity_id = $2)
          AND ($3::uuid IS NULL OR a.actor_user_id = $3)
          AND ($4::text IS NULL OR a.action = $4)
          AND ($5::bigint IS NULL OR a.id < $5)
        ORDER BY a.id DESC
        LIMIT $6`,
      [q.entityType ?? null, q.entityId ?? null, q.actorUserId ?? null, q.action ?? null, q.before ?? null, q.limit],
    );
    res.json({ data: rows, page: { nextCursor: rows.length === q.limit ? rows.at(-1).id : null } });
  });

  return router;
}
