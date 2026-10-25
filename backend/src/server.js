import { config } from "./config/env.js";
import { createApp } from "./app.js";
import { pool } from "./db/pool.js";
import { logger } from "./shared/logger.js";
import { expireStaleHolds } from "./modules/bookings/bookings.service.js";
import { sendPendingEmail } from "./modules/notifications/email.service.js";
import { sendPendingLine } from "./modules/notifications/line.service.js";

const app = createApp();
const server = app.listen(config.PORT, () => {
  logger.info(`API listening on ${config.APP_URL} (${config.NODE_ENV})`);
  if (!config.googleConfigured) logger.warn("GOOGLE_CLIENT_ID/SECRET not set — Google sign-in disabled");
  if (!config.facebookConfigured) logger.warn("FACEBOOK_APP_ID/SECRET not set — Facebook sign-in disabled");
  if (!config.lineConfigured) logger.warn("LINE_CHANNEL_ID/SECRET not set — LINE sign-in disabled");
  if (!config.mapsConfigured) logger.warn("GOOGLE_MAPS_API_KEY not set — delivery ETA uses straight-line estimates");
  logger.info(`payment gateway: ${config.cardPaymentsEnabled ? config.paymentProvider : "cards off"}`);
  if (config.promptpayConfigured && !config.slipokConfigured) logger.warn("SLIPOK_* not set — PromptPay slips wait for a staff member to check them");
  if (!config.lineMessagingConfigured) logger.warn("LINE_MESSAGING_ACCESS_TOKEN not set — no LINE push notifications");
});

// Unpaid holds release their car when the payment window lapses.
const expiry = setInterval(() => {
  expireStaleHolds()
    .then((n) => n && logger.info(`expired ${n} unpaid booking hold(s)`))
    .catch((err) => logger.error({ err }, "hold expiry failed"));
}, 60_000);
expiry.unref();

// LINE push messages queued by notify() (retries anything LINE could not take yet).
const linePush = setInterval(() => {
  sendPendingLine().catch((err) => logger.error({ err }, "LINE push failed"));
}, 20_000);
linePush.unref();

// Customer e-mails queued by notify() (retries anything the mail server could not take yet).
const mailPush = setInterval(() => {
  sendPendingEmail().catch((err) => logger.error({ err }, "customer e-mail failed"));
}, 60_000);
mailPush.unref();

// Graceful shutdown: stop accepting connections, finish in-flight requests, close the pool.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    logger.info(`${signal} received, shutting down`);
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
