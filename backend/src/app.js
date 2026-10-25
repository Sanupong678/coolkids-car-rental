import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import { randomUUID } from "node:crypto";
import { config } from "./config/env.js";
import { pool } from "./db/pool.js";
import { logger } from "./shared/logger.js";
import { authenticate } from "./middleware/auth.js";
import { apiLimiter, isAllowedOrigin, verifyOrigin } from "./middleware/security.js";
import { errorHandler, notFoundHandler } from "./middleware/errors.js";
import { createGoogleProvider } from "./modules/auth/google.provider.js";
import { createFacebookProvider } from "./modules/auth/facebook.provider.js";
import { createLineProvider } from "./modules/auth/line.provider.js";
import { createAuthService } from "./modules/auth/auth.service.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { meRoutes } from "./modules/users/me.routes.js";
import { auditRoutes } from "./modules/audit/audit.routes.js";
import { catalogueRoutes } from "./modules/catalogue/catalogue.routes.js";
import { contentRoutes } from "./modules/cms/content.routes.js";
import { bookingRoutes } from "./modules/bookings/bookings.routes.js";
import { webhookRoutes } from "./modules/payments/webhooks.routes.js";
import { lineWebhookRoutes } from "./modules/line/line.routes.js";
import { lineDemoRoutes } from "./modules/line/demo.routes.js";
import { adminRoutes } from "./modules/admin/admin.routes.js";
import * as storage from "./shared/storage.js";

/**
 * Builds the Express app. Dependencies are injectable so tests can swap the
 * identity provider (and later the payment gateway / storage) for fakes.
 */
export function createApp({
  identityProvider = createGoogleProvider(),
  facebookProvider = createFacebookProvider(),
  lineProvider = createLineProvider(),
} = {}) {
  const app = express();
  app.set("trust proxy", 1); // behind one reverse proxy / load balancer → correct req.ip for rate limits & audit
  app.disable("x-powered-by");

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.headers["x-request-id"] || randomUUID(),
      autoLogging: !config.isTest,
      serializers: {
        // OAuth callbacks carry one-time codes in the query string: never write them to logs.
        req: (req) => ({ id: req.id, method: req.method, url: req.url.includes("/auth/") ? req.url.split("?")[0] : req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(helmet());
  app.use(cors({ origin: (origin, cb) => cb(null, isAllowedOrigin(origin)), credentials: true }));
  // Webhooks read the raw body for signature checks, so their parser runs before the JSON one.
  app.use("/api/v1/webhooks", express.raw({ type: "*/*", limit: "1mb" }));
  // Contract signatures are PNG data URLs; everything else stays under 100 kB.
  app.use("/api/v1/bookings", express.json({ limit: "600kb" }));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser(config.COOKIE_SECRET));
  app.use(verifyOrigin);
  app.use(authenticate);

  // Images uploaded from the back office (content-addressed → safe to cache forever).
  // Files written before switching to R2 are still on disk; everything else streams from the public bucket.
  // public car photos are shown in e-mails (Gmail, Apple Mail…) too, i.e. from other sites
  app.use("/uploads", (_req, res, next) => {
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  });
  app.use("/uploads", express.static(storage.LOCAL_PUBLIC_DIR, { immutable: true, maxAge: "365d", index: false, dotfiles: "deny" }));
  if (storage.driver === "r2") {
    app.get("/uploads/*path", async (req, res, next) => {
      try {
        const key = req.params.path.join("/");
        const file = await storage.get("public", key, "r2");
        if (!file) return res.status(404).end();
        res.set({ "Content-Type": file.contentType ?? "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable" });
        res.send(file.body);
      } catch (err) {
        if (/Unsafe storage key/.test(err.message)) return res.status(404).end();
        next(err);
      }
    });
  }

  app.get("/health", async (_req, res) => {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  });

  const authServices = {
    google: createAuthService({ provider: identityProvider }),
    facebook: createAuthService({ provider: facebookProvider }),
    line: createAuthService({ provider: lineProvider }),
  };
  const api = express.Router();
  api.use(apiLimiter);
  api.use("/auth", authRoutes({ authServices }));
  api.use("/me", meRoutes());
  api.use("/admin/audit-logs", auditRoutes());
  api.use("/content", contentRoutes());
  api.use("/", catalogueRoutes()); // /vehicles, /categories, /locations, /promotions
  api.use("/", bookingRoutes()); // /bookings, /delivery/quote, /maps, /payments/mock
  api.use("/webhooks", webhookRoutes());
  api.use("/webhooks", lineWebhookRoutes());
  api.use("/admin", adminRoutes());
  // LINE look-alike demo (/line-demo): developer machines only, never in production.
  if (config.devToolsEnabled) api.use("/dev/line", lineDemoRoutes()); // never on a public host, whatever NODE_ENV says
  app.use("/api/v1", api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
