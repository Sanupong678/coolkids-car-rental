import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ quiet: true });

// All configuration enters through here and is validated once at boot.
// Secrets never leave the server: nothing in this file is sent to the frontend.
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
  APP_URL: z.url().default("http://localhost:5000"),          // public URL of this API
  FRONTEND_URL: z.url().default("http://localhost:5173"),     // allowed CORS / redirect origin
  // Extra site origins allowed to call the API, comma-separated (e.g. https://www.coolkidscar.com).
  ALLOWED_ORIGINS: z.string().default(""),

  DB_HOST: z.string().default("localhost"),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().default("car_rental"),
  DB_USER: z.string().default("postgres"),
  DB_PASSWORD: z.string().default(""),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),

  // Signs short-lived OAuth state cookies. 32+ random bytes.
  COOKIE_SECRET: z.string().min(32),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  // A session unused for this long is revoked and its cookie cleared → sign in again.
  STAFF_IDLE_HOURS: z.coerce.number().positive().default(12),
  CUSTOMER_IDLE_HOURS: z.coerce.number().positive().default(72),

  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  FACEBOOK_APP_ID: z.string().default(""),
  FACEBOOK_APP_SECRET: z.string().default(""),
  LINE_CHANNEL_ID: z.string().default(""),
  LINE_CHANNEL_SECRET: z.string().default(""),

  // Server-side key for Places autocomplete, geocoding and Routes (delivery ETA / fee).
  // Never sent to the browser. Empty → straight-line estimate from browser GPS.
  GOOGLE_MAPS_API_KEY: z.string().default(""),

  // S3-compatible object storage (Cloudflare R2 / Backblaze B2 / AWS S3). Empty → local folders.
  S3_ENDPOINT: z.string().default(""),
  S3_REGION: z.string().default("auto"),
  S3_ACCESS_KEY_ID: z.string().default(""),
  S3_SECRET_ACCESS_KEY: z.string().default(""),
  S3_BUCKET_PUBLIC: z.string().default(""),
  S3_BUCKET_PRIVATE: z.string().default(""),
  // Headless Chrome/Edge used to render contract PDFs. Empty → auto-detect.
  CHROME_PATH: z.string().default(""),

  // Payment gateway. "auto" = stripe when STRIPE_SECRET_KEY is set, otherwise the
  // local mock gateway (refused in production).
  PAYMENT_PROVIDER: z.enum(["auto", "stripe", "mock"]).default("auto"),
  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),

  // PromptPay transfer + slip check. PROMPTPAY_ID is the receiving phone number,
  // 13-digit tax/citizen id or 15-digit e-wallet id the QR pays into.
  PROMPTPAY_ID: z.string().regex(/^[0-9 -]*$/, "digits only").default(""),
  PROMPTPAY_NAME: z.string().default(""),
  // The shop's bank account number (e.g. K-Bank 226-1-92263-3). Slips that show only the
  // receiving account (no PromptPay id) can then confirm on their own; otherwise staff check them.
  PROMPTPAY_BANK_ACCOUNT: z.string().regex(/^[0-9 -]*$/, "digits only").default(""),
  // SlipOK (slipok.com) reads the slip's QR with the bank and returns the real
  // transfer. Empty → every slip waits for a staff member to check it.
  SLIPOK_BRANCH_ID: z.string().default(""),
  SLIPOK_API_KEY: z.string().default(""),

  // LINE Official Account (Messaging API channel) for push notifications, and the
  // LIFF app id (on the LINE Login channel) used by the rich menu.
  LINE_MESSAGING_ACCESS_TOKEN: z.string().default(""),
  LINE_MESSAGING_CHANNEL_SECRET: z.string().default(""), // verifies the chat-bot webhook

  // Outgoing e-mail (rental contract PDF to the customer). Gmail: smtp.gmail.com, port 465,
  // the shop's Gmail address and an App Password (Google account → Security → App passwords).
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  MAIL_FROM: z.string().default(""), // e.g. "Coolkids Car Rental <coolkidscar@gmail.com>"
  // Comma-separated staff addresses e-mailed when a customer sends a booking for review
  // (customer details + ID / licence photos). Empty → no e-mail.
  ADMIN_NOTIFY_EMAILS: z.string().default(""),
  LIFF_ID: z.string().default(""),

  // AES-256-GCM key for identity documents (base64, 32 bytes) and HMAC key for lookups.
  PII_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes base64"),
  PII_HMAC_KEY: z.string().min(32),

  // Comma-separated emails that receive super_admin on first sign-in (bootstrap only).
  BOOTSTRAP_SUPER_ADMINS: z.string().default(""),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:\n" + z.prettifyError(parsed.error));
  process.exit(1);
}

const env = parsed.data;
// Production must run over HTTPS with real secrets; refuse to boot otherwise.
if (env.NODE_ENV === "production") {
  const problems = [];
  if (!env.APP_URL.startsWith("https://") || !env.FRONTEND_URL.startsWith("https://")) problems.push("APP_URL and FRONTEND_URL must be https://");
  if (!env.DB_PASSWORD) problems.push("DB_PASSWORD is empty");
  if (env.COOKIE_SECRET.length < 48) problems.push("COOKIE_SECRET must be at least 48 characters");
  if (problems.length) {
    console.error(`Refusing to start in production:\n - ${problems.join("\n - ")}`);
    process.exit(1);
  }
}
const paymentProvider = env.PAYMENT_PROVIDER === "auto" ? (env.STRIPE_SECRET_KEY ? "stripe" : "mock") : env.PAYMENT_PROVIDER;
const promptpayDigits = env.PROMPTPAY_ID.replace(/\D/g, "");
if (promptpayDigits && ![10, 13, 15].includes(promptpayDigits.length)) {
  console.error("PROMPTPAY_ID must be a 10-digit phone number, a 13-digit tax id or a 15-digit e-wallet id");
  process.exit(1);
}
// Production needs at least one real way to pay. Card checkout is switched off
// (instead of falling back to the mock gateway) when only PromptPay is set up.
if (env.NODE_ENV === "production" && paymentProvider === "mock" && (env.PAYMENT_PROVIDER === "mock" || !promptpayDigits)) {
  console.error("Refusing to start: the mock payment gateway is for development only (set STRIPE_SECRET_KEY or PROMPTPAY_ID)");
  process.exit(1);
}

// Developer shortcuts (LINE demo page that acts as the admin, mock card "payments")
// must never reach a real site, even one started with the wrong NODE_ENV: they
// only run in development/test when the API itself is on a local address.
const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;
const appIsLocal = LOCAL_HOST.test(new URL(env.APP_URL).hostname);
const devToolsEnabled = env.NODE_ENV !== "production" && appIsLocal;
if (env.NODE_ENV !== "production" && !appIsLocal) {
  console.warn(`! NODE_ENV=${env.NODE_ENV} on a public URL (${env.APP_URL}): developer tools are off. Use NODE_ENV=production on a real server.`);
}

export const config = {
  ...env,
  isProd: env.NODE_ENV === "production",
  isTest: env.NODE_ENV === "test",
  devToolsEnabled,
  googleConfigured: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  facebookConfigured: Boolean(env.FACEBOOK_APP_ID && env.FACEBOOK_APP_SECRET),
  lineConfigured: Boolean(env.LINE_CHANNEL_ID && env.LINE_CHANNEL_SECRET),
  mapsConfigured: Boolean(env.GOOGLE_MAPS_API_KEY),
  // Tests always use local folders so they never touch the real bucket.
  s3Configured:
    env.NODE_ENV !== "test" &&
    Boolean(env.S3_ENDPOINT && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY && env.S3_BUCKET_PUBLIC && env.S3_BUCKET_PRIVATE),
  paymentProvider,
  cardPaymentsEnabled: paymentProvider === "stripe" || devToolsEnabled, // the mock gateway only on a developer machine
  promptpayConfigured: Boolean(promptpayDigits),
  slipokConfigured: Boolean(env.SLIPOK_BRANCH_ID && env.SLIPOK_API_KEY),
  lineMessagingConfigured: Boolean(env.LINE_MESSAGING_ACCESS_TOKEN),
  mailConfigured: Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS),
  adminNotifyEmails: env.ADMIN_NOTIFY_EMAILS.split(",").map((s) => s.trim()).filter(Boolean),
  allowedOrigins: [env.FRONTEND_URL, env.APP_URL, ...env.ALLOWED_ORIGINS.split(",")]
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean),
  bootstrapSuperAdmins: env.BOOTSTRAP_SUPER_ADMINS.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
};
