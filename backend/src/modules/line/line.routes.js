import { Router } from "express";
import { config } from "../../config/env.js";
import { handleEvents, verifySignature } from "./bot.service.js";

// POST /api/v1/webhooks/line — LINE Messaging API webhook (raw body, mounted
// before the JSON parser). LINE expects a quick 200; replies go out right after.
export function lineWebhookRoutes() {
  const router = Router();
  router.post("/line", async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!config.lineMessagingConfigured || !verifySignature(raw, req.get("x-line-signature"))) {
      return res.status(401).json({ error: { code: "BAD_SIGNATURE", message: "Invalid signature" } });
    }
    let body;
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      return res.status(400).json({ error: { code: "BAD_REQUEST", message: "Invalid JSON" } });
    }
    res.json({ ok: true });
    handleEvents(body.events).catch((err) => req.log?.error({ err }, "LINE webhook failed"));
  });
  return router;
}
