import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../../config/env.js";
import { AppError } from "../../shared/errors.js";

// Payment gateway adapters. Interface:
//   createCheckout({ payment, booking, customerEmail, successUrl, cancelUrl, expiresAt }) -> { providerPaymentId, url }
//   retrieve(providerPaymentId) -> { paid, methodType, last4, raw }
// Stripe Checkout accepts international cards (Visa/Mastercard/Amex/JCB/UnionPay),
// Apple/Google Pay and, for THB, PromptPay — so foreign and Thai customers both work.

const STRIPE = "https://api.stripe.com/v1";

/** Stripe wants application/x-www-form-urlencoded with bracketed nested keys. */
function form(obj, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function stripe(path, { method = "GET", body, idempotencyKey } = {}) {
  const res = await fetch(`${STRIPE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.STRIPE_SECRET_KEY}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: body ? form(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AppError(502, "PAYMENT_PROVIDER_ERROR", data.error?.message ?? "Payment provider error");
  return data;
}

const stripeProvider = {
  name: "stripe",

  async createCheckout({ payment, booking, customerEmail, successUrl, cancelUrl, expiresAt, locale }) {
    const session = await stripe("/checkout/sessions", {
      method: "POST",
      idempotencyKey: payment.idempotency_key,
      body: {
        mode: "payment",
        client_reference_id: booking.id,
        customer_email: customerEmail,
        locale: locale === "th" ? "th" : "auto",
        success_url: `${successUrl}${successUrl.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: cancelUrl,
        expires_at: Math.floor(expiresAt.getTime() / 1000),
        line_items: {
          0: {
            quantity: 1,
            price_data: {
              currency: payment.currency.toLowerCase(),
              unit_amount: payment.amount_minor,
              product_data: { name: `Coolkids ${booking.booking_number}`, description: booking.description },
            },
          },
        },
        metadata: { payment_id: payment.id, booking_id: booking.id, booking_number: booking.booking_number },
        payment_intent_data: { metadata: { payment_id: payment.id, booking_number: booking.booking_number } },
      },
    });
    return { providerPaymentId: session.id, url: session.url };
  },

  async retrieve(sessionId) {
    const s = await stripe(`/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=payment_intent.latest_charge`);
    const charge = s.payment_intent?.latest_charge;
    return {
      paid: s.payment_status === "paid",
      providerPaymentId: s.id,
      amountMinor: s.amount_total,
      currency: s.currency,
      methodType: charge?.payment_method_details?.type ?? null,
      last4: charge?.payment_method_details?.card?.last4 ?? null,
      raw: { id: s.id, status: s.status, payment_status: s.payment_status, payment_intent: s.payment_intent?.id ?? null },
    };
  },

  /** Verifies the Stripe-Signature header (HMAC-SHA256 over "t.payload", 5-minute tolerance). */
  verifyWebhook(rawBody, header) {
    if (!config.STRIPE_WEBHOOK_SECRET) return false;
    const parts = Object.fromEntries(String(header ?? "").split(",").map((p) => p.split("=")));
    const t = Number(parts.t);
    if (!t || Math.abs(Date.now() / 1000 - t) > 300 || !parts.v1) return false;
    const expected = createHmac("sha256", config.STRIPE_WEBHOOK_SECRET).update(`${t}.${rawBody}`).digest();
    const given = Buffer.from(parts.v1, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  },
};

// Local gateway for development: "checkout" is a page in our own frontend with
// pay / decline buttons. config/env.js refuses to boot it in production.
const mockProvider = {
  name: "mock",
  async createCheckout({ payment }) {
    return { providerPaymentId: `mock_${payment.id}`, url: `${config.FRONTEND_URL}/pay/mock/${payment.id}` };
  },
  async retrieve() {
    return { paid: false, methodType: null, last4: null, raw: {} };
  },
};

export const paymentProvider = () => (config.paymentProvider === "stripe" ? stripeProvider : mockProvider);
export { stripeProvider };
