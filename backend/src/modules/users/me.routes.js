import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { authLimiter as passwordLimiter } from "../../middleware/security.js";
import { validate } from "../../middleware/validate.js";
import { adminPagesFor } from "../admin/accounts.service.js";
import { auditContext } from "../audit/audit.service.js";
import { onboardingSchema, passwordChangeSchema, profilePatchSchema } from "./users.schemas.js";
import * as service from "./users.service.js";

// /api/v1/me — the signed-in user's own account.
export function meRoutes() {
  const router = Router();
  router.use(requireAuth);

  router.get("/", async (req, res) => {
    // adminPages: back-office menu items this account may open (super admin: all + account management).
    res.json({ data: { ...service.toMeDto(req.auth.user, req.auth), adminPages: await adminPagesFor(req.auth) } });
  });

  // Mandatory first-login step. Idempotent: re-submitting updates the answers.
  router.put("/onboarding", validate({ body: onboardingSchema }), async (req, res) => {
    const user = await service.completeOnboarding(auditContext(req), req.auth.user.id, req.valid.body);
    res.json({ data: service.toMeDto(user, req.auth) });
  });

  router.patch("/", validate({ body: profilePatchSchema }), async (req, res) => {
    const user = await service.updateProfile(auditContext(req), req.auth.user.id, req.valid.body);
    res.json({ data: service.toMeDto(user, req.auth) });
  });

  // Account settings page: sign-in methods + renter details (masked) from the latest booking.
  router.get("/account", async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ data: await service.accountDetails(req.auth.user.id) });
  });

  router.put("/password", passwordLimiter, validate({ body: passwordChangeSchema }), async (req, res) => {
    res.json({ data: await service.changePassword(auditContext(req), req.auth, req.valid.body) });
  });

  return router;
}
