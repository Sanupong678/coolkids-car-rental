import { Router } from "express";
import { z } from "zod";
import { config } from "../../config/env.js";
import { SESSION_COOKIE } from "../../middleware/auth.js";
import { authLimiter } from "../../middleware/security.js";
import { AppError } from "../../shared/errors.js";
import { validate } from "../../middleware/validate.js";
import { auditContext } from "../audit/audit.service.js";
import * as passwordAuth from "./password.service.js";

const OAUTH_COOKIE = "oauth_pending";
const OAUTH_COOKIE_PATH = "/api/v1/auth";

const sessionCookieOptions = (expires) => ({
  httpOnly: true,
  secure: config.isProd,
  sameSite: "lax", // sent on top-level navigation back from Google, not on cross-site subrequests
  path: "/",
  expires,
});

const loginSchema = z.object({
  login: z.string().trim().toLowerCase().min(1).max(254),
  password: z.string().min(1).max(200),
});
const registerSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  email: z.email().trim().toLowerCase().max(254),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{6,20}$/, "Invalid phone number").optional().or(z.literal("").transform(() => undefined)),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

/** @param authServices { google, facebook, line: AuthService } — one OAuth flow per provider. */
export function authRoutes({ authServices }) {
  const router = Router();
  router.use(authLimiter);

  // POST /api/v1/auth/login { login, password } → session cookie
  router.post("/login", validate({ body: loginSchema }), async (req, res) => {
    const session = await passwordAuth.login(req.valid.body, auditContext(req));
    res.cookie(SESSION_COOKIE, session.token, sessionCookieOptions(new Date(session.expiresAt)));
    res.status(204).end();
  });

  // POST /api/v1/auth/register { fullName, email, phone?, password } → session cookie
  router.post("/register", validate({ body: registerSchema }), async (req, res) => {
    const session = await passwordAuth.register(req.valid.body, auditContext(req));
    res.cookie(SESSION_COOKIE, session.token, sessionCookieOptions(new Date(session.expiresAt)));
    res.status(201).end();
  });

  for (const [name, authService] of Object.entries(authServices)) mountOAuth(router, name, authService);

  // POST /api/v1/auth/line/liff { idToken } → session cookie. Used when the site runs
  // inside the LINE app (LIFF, opened from the OA rich menu): no redirect round trip.
  router.post("/line/liff", validate({ body: z.object({ idToken: z.string().min(20).max(4096) }) }), async (req, res) => {
    const line = authServices.line;
    if (!line?.provider?.profileFromIdToken) throw new AppError(503, "OAUTH_NOT_CONFIGURED", "LINE sign-in is not configured on this server");
    const session = await line.signIn(await line.provider.profileFromIdToken(req.valid.body.idToken), auditContext(req));
    res.cookie(SESSION_COOKIE, session.token, sessionCookieOptions(new Date(session.expiresAt)));
    res.status(204).end();
  });

  router.post("/logout", async (req, res) => {
    await authServices.google.logout(req.auth?.sessionId);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.status(204).end();
  });

  // Lets the frontend show/hide sign-in options without exposing any secret.
  router.get("/providers", (_req, res) => {
    res.json({
      data: {
        google: config.googleConfigured, facebook: config.facebookConfigured, line: config.lineConfigured, password: true,
        liffId: config.lineConfigured && config.LIFF_ID ? config.LIFF_ID : null,
      },
    });
  });

  return router;
}

function mountOAuth(router, name, authService) {
  // GET /api/v1/auth/{google|facebook|line}?returnTo=/vehicles/123  → 302 to the provider
  router.get(
    `/${name}`,
    validate({ query: z.object({ returnTo: z.string().max(300).optional() }) }),
    async (req, res) => {
      const { url, pending } = await authService.startLogin({ returnTo: req.valid.query.returnTo });
      res.cookie(OAUTH_COOKIE, JSON.stringify(pending), {
        httpOnly: true, secure: config.isProd, sameSite: "lax", signed: true, path: OAUTH_COOKIE_PATH, maxAge: 10 * 60_000,
      });
      res.redirect(302, url);
    },
  );

  // GET /api/v1/auth/{provider}/callback?code=…&state=…  → sets session cookie, 302 to frontend
  router.get(`/${name}/callback`, async (req, res) => {
    const raw = req.signedCookies?.[OAUTH_COOKIE];
    res.clearCookie(OAUTH_COOKIE, { path: OAUTH_COOKIE_PATH });
    const fail = (code) => res.redirect(302, new URL(`/?auth_error=${code}`, config.FRONTEND_URL).toString());

    if (req.query.error) return fail("cancelled");
    if (typeof req.query.code !== "string" || typeof req.query.state !== "string") return fail("invalid_request");

    let pending = null;
    try {
      pending = raw ? JSON.parse(raw) : null;
    } catch {
      /* tampered or garbled cookie → treated as missing */
    }

    try {
      const result = await authService.completeLogin({
        code: req.query.code, state: req.query.state, pending, ctx: auditContext(req),
      });
      res.cookie(SESSION_COOKIE, result.token, sessionCookieOptions(new Date(result.expiresAt)));
      res.redirect(302, new URL(result.returnTo, config.FRONTEND_URL).toString());
    } catch (err) {
      // Provider token errors carry the reason in the response body (e.g. invalid_grant: "Bad Request").
      const provider = err.response?.data;
      req.log.warn(
        { err: { message: err.message, code: err.code, provider: provider?.error_description ?? provider?.error ?? undefined } },
        "oauth callback failed",
      );
      const codes = { ACCOUNT_DISABLED: "account_disabled", EMAIL_IN_USE: "email_in_use", EMAIL_REQUIRED: "email_required" };
      fail(codes[err.code] ?? "signin_failed");
    }
  });
}
