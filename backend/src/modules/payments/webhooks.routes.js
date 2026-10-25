import { Router } from "express";
import { pool } from "../../db/pool.js";
import { confirmPayment } from "../bookings/bookings.service.js";
import { stripeProvider } from "./providers.js";

// POST /api/v1/webhooks/stripe — raw body (mounted before the JSON parser in app.js).
// Verified events are stored in the inbox first; UNIQUE(provider, event id) makes replays no-ops.
export function webhookRoutes() {
  const router = Router();

  router.post("/stripe", async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    if (!stripeProvider.verifyWebhook(raw, req.get("stripe-signature"))) {
      return res.status(400).json({ error: { code: "BAD_SIGNATURE", message: "Invalid signature" } });
    }
    const event = JSON.parse(raw);
    const { rows } = await pool.query(
      `INSERT INTO payment_webhook_events (provider, provider_event_id, event_type, signature_verified, payload)
       VALUES ('stripe', $1, $2, true, $3) ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING id`,
      [event.id, event.type, raw],
    );
    if (!rows[0]) return res.json({ received: true, duplicate: true });

    try {
      const session = event.data?.object;
      const paymentId = session?.metadata?.payment_id;
      if (paymentId && ["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type) && session.payment_status === "paid") {
        await confirmPayment(paymentId, {
          raw: { id: session.id, event: event.type },
          webhookEventId: rows[0].id,
          providerPaymentId: session.id,
          amountMinor: session.amount_total,
          currency: session.currency,
        });
      }
      await pool.query("UPDATE payment_webhook_events SET processed_at = now(), attempts = attempts + 1 WHERE id = $1", [rows[0].id]);
    } catch (err) {
      await pool.query("UPDATE payment_webhook_events SET processing_error = $2, attempts = attempts + 1 WHERE id = $1", [
        rows[0].id, err.message,
      ]);
      req.log?.error({ err }, "stripe webhook processing failed");
      return res.status(500).json({ error: { code: "WEBHOOK_FAILED", message: "Will retry" } });
    }
    res.json({ received: true });
  });

  return router;
}
