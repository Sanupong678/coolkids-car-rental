import { pool } from "../db/pool.js";

// Business settings live in system_settings (edited from the back office).
// Defaults here keep the API working on a database that has not been seeded.
export const SETTING_DEFAULTS = {
  "pricing.currency": "THB",
  "pricing.tax_rate_bps": 700,
  "pricing.tax_inclusive": true, // advertised prices include VAT
  "pricing.extra_hour_grace_minutes": 59,
  "booking.hold_minutes": 30,
  "booking.min_lead_time_hours": 2,
  "booking.max_advance_days": 365,
  "booking.min_driver_age": 20,
  // "โอน = จอง": paid once staff approve the documents; the rest is paid at pick-up.
  "booking.reservation_fee_minor": 100000,
  "booking.review_hold_hours": 24, // car held while staff check the documents
  "booking.payment_hold_hours": 12, // …and for this long after approval, for the transfer
  "delivery.free_km": 5,
  "delivery.per_km_minor": 2000,
  "delivery.min_fee_minor": 10000,
  "delivery.fallback_minutes": 45,
  // staff e-mail for new bookings: accounts switched off (user ids) and extra addresses (notifications/staff-recipients)
  "notify.booking_email": { muted: [], extra: [] },
  "company.legal": {
    name: "COOLKIDS CAR RENTAL CO., LTD.",
    nameTh: "บริษัท คูลคิดส์ คาร์ เร้นท์ทอล จำกัด", // on the booking slip and receipts
    address: "93/72 หมู่ 3 ต.บางเมือง อ.เมืองสมุทรปราการ จ.สมุทรปราการ 10270",
    phone: "065-365-6514",
    taxId: "0115569024211",
  },
};

export async function getSettings(db = pool) {
  const { rows } = await db.query("SELECT key, value FROM system_settings WHERE key = ANY($1::text[])", [
    Object.keys(SETTING_DEFAULTS),
  ]);
  return { ...SETTING_DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}

export const feePolicy = (s) => ({
  freeKm: Number(s["delivery.free_km"]),
  perKmMinor: Number(s["delivery.per_km_minor"]),
  minFeeMinor: Number(s["delivery.min_fee_minor"]),
});

/** A vehicle's own delivery fee (fleet form), falling back to the shop default for anything left empty. */
export function vehicleFeePolicy(s, v) {
  const base = feePolicy(s);
  const own = (value, fallback) => (value == null ? fallback : Number(value));
  return {
    freeKm: own(v?.delivery_free_km, base.freeKm),
    perKmMinor: own(v?.delivery_per_km_minor, base.perKmMinor),
    minFeeMinor: own(v?.delivery_min_fee_minor, base.minFeeMinor),
  };
}
