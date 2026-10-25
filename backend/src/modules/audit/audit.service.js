// Append-only audit trail. Call inside the same transaction as the change it
// describes, so an action is never logged without happening (or vice versa).

const SENSITIVE_KEYS = /(_enc|_hmac|password|secret|token|document_number|license_number|address)$/i;

function scrub(state) {
  if (state == null || typeof state !== "object") return state ?? null;
  return Object.fromEntries(
    Object.entries(state).map(([k, v]) => [k, SENSITIVE_KEYS.test(k) ? "[redacted]" : v]),
  );
}

/**
 * @param db       pg client (transaction) or pool
 * @param ctx      request context: { actorUserId, actorRoles, ip, userAgent, requestId } — use auditContext(req)
 * @param entry    { action: "vehicle.price_changed", entityType, entityId, before?, after? }
 */
export async function recordAudit(db, ctx, { action, entityType, entityId, before = null, after = null }) {
  await db.query(
    `INSERT INTO audit_logs (actor_user_id, actor_roles, action, entity_type, entity_id,
                             previous_state, new_state, ip_address, user_agent, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      ctx.actorUserId ?? null,
      ctx.actorRoles ?? [],
      action,
      entityType,
      String(entityId),
      before ? JSON.stringify(scrub(before)) : null,
      after ? JSON.stringify(scrub(after)) : null,
      ctx.ip ?? null,
      ctx.userAgent?.slice(0, 500) ?? null,
      ctx.requestId ?? null,
    ],
  );
}

export const auditContext = (req) => ({
  actorUserId: req.auth?.user.id ?? null,
  actorRoles: req.auth?.roles ?? [],
  ip: req.ip,
  userAgent: req.get("user-agent"),
  requestId: req.id,
});
