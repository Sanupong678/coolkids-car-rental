import { randomUUID } from "node:crypto";
import { config } from "../../config/env.js";
import { pool, withTransaction } from "../../db/pool.js";
import { encryptPII, hmac, last4, sha256 } from "../../shared/crypto.js";
import { AppError, BadRequest, Conflict, Forbidden, NotFound } from "../../shared/errors.js";
import { distanceMeters, minutesToDrive } from "../../shared/geo.js";
import { getSettings, vehicleFeePolicy } from "../../shared/settings.js";
import * as storage from "../../shared/storage.js";
import { recordAudit } from "../audit/audit.service.js";
import { findVehicleForBooking } from "../catalogue/catalogue.repository.js";
import { buildSnapshot, issueContract, nextContractNumber, renderContract, signContract } from "../contracts/contracts.service.js";
import { renderPdf } from "../contracts/pdf.js";
import * as maps from "../maps/maps.service.js";
import { queueEmail } from "../notifications/email.service.js";
import { queueLine } from "../notifications/line.service.js";
import { bookingSummaries, bookingSummaryText } from "./summary.js";
import { mailAdminsBookingSubmitted } from "./admin-mail.js";
import { paymentProvider } from "../payments/providers.js";

// Web booking flow (spec 1.8): details → contract → payment → tracking.
//   PENDING (car held, unpaid) → CONFIRMED (paid) → PREPARING (documents)
//   → IN_DELIVERY (car on the way) | READY (branch pick-up) → ACTIVE (handed over) → COMPLETED.
// Every price is computed here; numbers sent by the browser are never trusted.

const HOUR = 3_600_000;
// A customer may hold at most this many unpaid bookings at once (stops fleet-locking abuse).
const MAX_OPEN_HOLDS = 3;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------- helpers

async function emit(db, aggregateId, eventType, payload) {
  await db.query(
    "INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload) VALUES ('booking', $1, $2, $3)",
    [aggregateId, eventType, JSON.stringify(payload)],
  );
}

/** In-app notification, plus LINE and e-mail copies for the types customers wait for (LINE_TYPES / EMAIL_TYPES). */
export async function notify(db, userId, { type, title, body, bookingId, data = {} }) {
  await db.query(
    `INSERT INTO notifications (user_id, notification_type, title, body, data, entity_type, entity_id)
     VALUES ($1, $2, $3, $4, $5, 'booking', $6)`,
    [userId, type, title, body, JSON.stringify(data), bookingId],
  );
  await queueLine(db, userId, { type, title, body, bookingId, data });
  await queueEmail(db, userId, { type, title, body, bookingId, data });
}

/** PENDING bookings past their payment window → EXPIRED (the status trigger releases the car). */
export async function expireStaleHolds() {
  const { rowCount } = await pool.query(
    "UPDATE bookings SET status = 'EXPIRED' WHERE status = 'PENDING' AND hold_expires_at < now()",
  );
  return rowCount;
}

export function rentalDaysBetween(pickupAt, returnAt, graceMinutes) {
  return Math.max(1, Math.ceil((returnAt - pickupAt - graceMinutes * 60_000) / DAY));
}

/** Quote = rental + delivery − promotion (+ tax when prices exclude VAT). */
export function priceBooking(vehicle, days, deliveryMinor, settings, returnMinor = 0) {
  const daily = vehicle.daily_rate_minor;
  let discountPerDay = 0;
  if (vehicle.promo_id && (!vehicle.promo_min_days || days >= vehicle.promo_min_days)) {
    if (vehicle.promo_type === "PERCENT") {
      discountPerDay = Math.floor((daily * vehicle.promo_value) / 10_000);
      if (vehicle.promo_max) discountPerDay = Math.min(discountPerDay, vehicle.promo_max);
    } else if (vehicle.promo_type === "FIXED_PER_DAY") {
      discountPerDay = Math.min(vehicle.promo_value, daily);
    }
  }
  const rental = daily * days;
  const discount = discountPerDay * days;
  const subtotal = rental + deliveryMinor + returnMinor;
  const tax = settings["pricing.tax_inclusive"] ? 0 : Math.round(((subtotal - discount) * settings["pricing.tax_rate_bps"]) / 10_000);
  return {
    daily,
    rental,
    delivery: deliveryMinor,
    returnPickup: returnMinor, // driving out to collect the car (return address other than the branch)
    discount,
    tax,
    subtotal,
    total: subtotal - discount + tax,
    deposit: vehicle.deposit_minor,
    promotionId: discount > 0 ? vehicle.promo_id : null,
  };
}

const ageOn = (dob, at) => {
  const b = new Date(dob);
  let age = at.getFullYear() - b.getFullYear();
  if (at < new Date(at.getFullYear(), b.getMonth(), b.getDate())) age -= 1;
  return age;
};

// ---------------------------------------------------------------- quote

/** Coordinates deliveries start from (the headquarters branch). */
export async function branchOrigin() {
  const { rows } = await pool.query(
    `SELECT latitude::float AS lat, longitude::float AS lng FROM locations
      WHERE is_active AND deleted_at IS NULL ORDER BY (location_type = 'HEADQUARTERS') DESC, sort_order LIMIT 1`,
  );
  if (!rows[0]) throw new AppError(500, "NO_BRANCH", "No active branch configured");
  return rows[0];
}

/**
 * Delivery distance / ETA / fee. With a vehicle: from that car's home branch at
 * that car's delivery fee (fleet form); without: from the headquarters at the shop default.
 */
export async function deliveryQuote(input, vehicleSlug) {
  const settings = await getSettings();
  const { rows } = vehicleSlug
    ? await pool.query(
        `SELECT v.delivery_free_km, v.delivery_per_km_minor, v.delivery_min_fee_minor,
                l.latitude::float AS lat, l.longitude::float AS lng
           FROM vehicles v JOIN locations l ON l.id = v.home_location_id
          WHERE v.slug = $1 AND v.deleted_at IS NULL`,
        [vehicleSlug],
      )
    : { rows: [] };
  const v = rows[0];
  const origin = v?.lat != null ? { lat: v.lat, lng: v.lng } : await branchOrigin();
  const policy = vehicleFeePolicy(settings, v);
  return { ...(await maps.quote(input, origin, policy)), policy };
}

// ---------------------------------------------------------------- create

/**
 * @param opts.staff the back-office user keying the booking in for this customer (auth is the customer then)
 */
export async function createBooking(auth, input, ctx, opts = {}) {
  const settings = await getSettings();
  const now = new Date();
  const pickupAt = new Date(input.pickupAt);
  const returnAt = new Date(input.returnAt);
  const c = input.customer;

  if (pickupAt < new Date(now.getTime() + settings["booking.min_lead_time_hours"] * HOUR)) {
    throw BadRequest("Pick-up time is too soon", { pickupAt: [`ต้องจองล่วงหน้าอย่างน้อย ${settings["booking.min_lead_time_hours"]} ชั่วโมง`] });
  }
  if (pickupAt > new Date(now.getTime() + settings["booking.max_advance_days"] * DAY)) {
    throw BadRequest("Pick-up date is too far ahead", { pickupAt: ["จองล่วงหน้าได้ไม่เกิน 1 ปี"] });
  }
  if (returnAt <= pickupAt) throw BadRequest("Return must be after pick-up", { returnAt: ["วันคืนรถต้องหลังวันรับรถ"] });
  if (new Date(c.licenseExpiry) < returnAt) {
    throw BadRequest("Driving licence expires before the rental ends", { "customer.licenseExpiry": ["ใบขับขี่หมดอายุก่อนวันคืนรถ"] });
  }

  // Network call happens before the transaction so no DB locks are held while waiting on Google.
  const delivery = input.fulfillment === "DELIVERY" ? await deliveryQuote(input.delivery, input.vehicleSlug) : null;
  // Collecting the car somewhere else costs the same per km as delivering it there.
  const returnType = input.returnType ?? "BRANCH";
  const collect = returnType === "ADDRESS" ? await deliveryQuote(input.returnAddress, input.vehicleSlug) : returnType === "SAME_AS_DELIVERY" ? delivery : null;

  await expireStaleHolds();

  const result = await withTransaction(
    async (db) => {
      const v = await findVehicleForBooking(db, input.vehicleSlug);
      if (!v) throw NotFound("Vehicle");

      const minAge = Math.max(v.min_driver_age, Number(settings["booking.min_driver_age"]));
      if (ageOn(c.dateOfBirth, pickupAt) < minAge) {
        throw BadRequest(`Driver must be at least ${minAge}`, { "customer.dateOfBirth": [`ผู้ขับขี่ต้องมีอายุ ${minAge} ปีขึ้นไป`] });
      }
      const days = rentalDaysBetween(pickupAt, returnAt, settings["pricing.extra_hour_grace_minutes"]);
      if (days < v.min_rental_days) throw BadRequest(`Minimum rental is ${v.min_rental_days} days`, { returnAt: [`เช่าขั้นต่ำ ${v.min_rental_days} วัน`] });
      if (v.max_rental_days && days > v.max_rental_days) throw BadRequest(`Maximum rental is ${v.max_rental_days} days`);

      const money = priceBooking(v, days, delivery?.feeMinor ?? 0, settings, collect?.feeMinor ?? 0);
      // "โอน = จอง": only the reservation fee is paid online, after staff approve the documents.
      money.dueNow = Math.min(Number(settings["booking.reservation_fee_minor"]), money.total);
      const userId = auth.user.id;

      // Serialise this customer's bookings, then cap how many unpaid holds they keep open.
      await db.query("SELECT pg_advisory_xact_lock(hashtext('booking-holds:' || $1))", [userId]);
      const { rows: holds } = await db.query(
        "SELECT count(*)::int AS n FROM bookings WHERE user_id = $1 AND status = 'PENDING' AND hold_expires_at > now()",
        [userId],
      );
      if (holds[0].n >= MAX_OPEN_HOLDS) {
        throw Conflict("TOO_MANY_HOLDS", "คุณมีการจองที่ยังไม่ชำระเงินหลายรายการ กรุณาชำระหรือรอให้หมดเวลาก่อนจองเพิ่ม");
      }

      // Identity documents are versioned and encrypted; the booking points at this exact version.
      await db.query("UPDATE customer_identities SET is_current = false WHERE user_id = $1 AND is_current", [userId]);
      const { rows: idRows } = await db.query(
        `INSERT INTO customer_identities (user_id, country_code, legal_full_name, date_of_birth, id_document_type,
           id_document_number_enc, id_document_number_last4, id_document_number_hmac,
           license_number_enc, license_number_last4, license_number_hmac, license_country_code, license_expiry,
           address_enc, phone)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
        [
          userId, c.countryCode, c.fullName, c.dateOfBirth, c.idType,
          encryptPII(c.idNumber), last4(c.idNumber), hmac(c.idNumber),
          encryptPII(c.licenseNumber), last4(c.licenseNumber), hmac(c.licenseNumber), c.licenseCountry, c.licenseExpiry,
          encryptPII(JSON.stringify({ line1: c.address, country: c.countryCode })), c.phone,
        ],
      );
      await db.query("UPDATE users SET phone = COALESCE(phone, $2) WHERE id = $1", [userId, c.phone]);

      const holdUntil = new Date(Date.now() + settings["booking.hold_minutes"] * 60_000);
      const deliveryAddress = delivery
        ? { address: delivery.address ?? input.delivery.address, placeId: delivery.placeId, lat: delivery.lat, lng: delivery.lng,
            notes: input.delivery.notes ?? null, source: delivery.source }
        : null;
      const returnAddress = returnType === "SAME_AS_DELIVERY"
        ? deliveryAddress
        : collect
          ? { address: collect.address ?? input.returnAddress.address, placeId: collect.placeId, lat: collect.lat, lng: collect.lng,
              notes: input.returnAddress.notes ?? null, source: collect.source }
          : null;
      const { rows: bRows } = await db.query(
        `INSERT INTO bookings (user_id, vehicle_id, customer_identity_id, pickup_location_id, return_location_id,
           fulfillment_type, delivery_address, pickup_at, return_at, status, hold_expires_at, currency, rental_days,
           subtotal_minor, discount_minor, tax_minor, total_minor, deposit_minor, pricing_snapshot, promotion_id,
           source, customer_notes, customer_country, delivery_distance_m, delivery_duration_s,
           review_status, amount_due_now_minor, area_of_use, stay_location, social_url, rental_purpose, contact_email,
           return_type, return_address, return_distance_m, return_duration_s, created_by_staff)
         VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,'PENDING',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$34,$19,$20,$21,$22,
                 'DRAFT',$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33)
         RETURNING id, booking_number`,
        [
          userId, v.id, idRows[0].id, v.home_location_id, input.fulfillment,
          deliveryAddress ? JSON.stringify(deliveryAddress) : null, pickupAt, returnAt, holdUntil, v.currency, days,
          money.subtotal, money.discount, money.tax, money.total, money.deposit,
          JSON.stringify({ engine: "coolkids-v1", ...money, taxRateBps: settings["pricing.tax_rate_bps"],
            taxInclusive: settings["pricing.tax_inclusive"], deliveryPolicy: delivery?.policy ?? vehicleFeePolicy(settings, v),
            delivery: delivery && { distanceMeters: delivery.distanceMeters, durationSeconds: delivery.durationSeconds, source: delivery.source },
            returnPlace: collect && { type: returnType, distanceMeters: collect.distanceMeters, durationSeconds: collect.durationSeconds, source: collect.source } }),
          money.promotionId, input.notes ?? null, c.countryCode,
          delivery?.distanceMeters ?? null, delivery?.durationSeconds ?? null,
          money.dueNow, input.areaOfUse ?? null, input.stayLocation ?? null, input.socialUrl ?? null, input.rentalPurpose ?? null,
          input.contactEmail ?? null,
          returnType, returnAddress ? JSON.stringify(returnAddress) : null, collect?.distanceMeters ?? null, collect?.durationSeconds ?? null,
          opts.staff?.user.id ?? null, opts.staff ? "ADMIN" : "WEB",
        ],
      );
      const booking = bRows[0];

      const items = [
        ["RENTAL", `ค่าเช่า ${v.brand} ${v.model} ${days} วัน`, days, money.daily, money.rental, null],
        ...(money.delivery ? [["DELIVERY_FEE", `ค่าส่งรถ ${(delivery.distanceMeters / 1000).toFixed(1)} กม.`, 1, money.delivery, money.delivery, null]] : []),
        ...(money.returnPickup ? [["RETURN_FEE", `ค่ารับรถคืน ${(collect.distanceMeters / 1000).toFixed(1)} กม.`, 1, money.returnPickup, money.returnPickup, null]] : []),
        ...(money.discount ? [["DISCOUNT", v.promo_name, 1, -money.discount, -money.discount, money.promotionId]] : []),
        ...(money.tax ? [["TAX", "VAT", 1, money.tax, money.tax, null]] : []),
      ];
      for (const [i, [type, desc, qty, unit, amount, promoId]] of items.entries()) {
        await db.query(
          `INSERT INTO booking_items (booking_id, item_type, description, promotion_id, quantity, unit_amount_minor, amount_minor, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [booking.id, type, desc, promoId, qty, unit, amount, i],
        );
      }

      // The EXCLUDE constraint rejects an overlapping hold → 409 VEHICLE_UNAVAILABLE.
      await db.query(
        `INSERT INTO vehicle_availability_blocks (vehicle_id, block_type, during, booking_id, created_by)
         VALUES ($1, 'BOOKING', tstzrange($2, $3::timestamptz + make_interval(mins => $4), '[)'), $5, $6)`,
        [v.id, pickupAt, returnAt, v.turnaround_minutes, booking.id, userId],
      );
      if (money.promotionId) {
        await db.query(
          "INSERT INTO promotion_redemptions (promotion_id, booking_id, user_id, discount_minor) VALUES ($1,$2,$3,$4)",
          [money.promotionId, booking.id, userId, money.discount],
        );
      }

      const contractNumber = await nextContractNumber(db);
      const snapshot = buildSnapshot({
        company: settings["company.legal"],
        contractNumber,
        issuedAt: now,
        customer: { ...c, email: auth.user.email },
        vehicle: v,
        booking: { pickupAt, returnAt, rentalDays: days, areaOfUse: input.areaOfUse, purpose: input.rentalPurpose },
        money,
        delivery: deliveryAddress,
        returnPlace: returnAddress,
      });
      await issueContract(db, { bookingId: booking.id, userId, contractNumber, snapshot });

      await emit(db, booking.id, "booking.created", { bookingNumber: booking.booking_number, totalMinor: money.total });
      await recordAudit(db, ctx, { action: "booking.created", entityType: "booking", entityId: booking.id,
        after: { vehicle: v.slug, pickupAt, returnAt, total: money.total, fulfillment: input.fulfillment, returnType,
          bookedByStaff: opts.staff?.user.id ?? null,
          termsAcknowledged: input.termsLocale ? { locale: input.termsLocale, at: now } : null } });
      return booking.booking_number;
    },
    { actorId: opts.staff?.user.id ?? auth.user.id },
  );
  return getBooking(opts.staff ?? auth, result);
}

// ---------------------------------------------------------------- read

const STAGE = {
  PENDING: "awaiting_payment", CONFIRMED: "confirmed", PREPARING: "preparing", READY: "ready",
  IN_DELIVERY: "delivering", ACTIVE: "arrived", COMPLETED: "completed",
  CANCELLED: "cancelled", REFUNDED: "cancelled", EXPIRED: "expired",
};

export const BOOKING_SELECT = `
  SELECT b.*, v.slug AS vehicle_slug, v.brand, v.model, v.trim, v.model_year, v.license_plate, v.fleet_no,
         img.file_url AS image_url, img.variants AS image_variants,
         ci.legal_full_name, ci.phone AS customer_phone, ci.id_document_type, ci.id_front_media_id, ci.id_back_media_id, ci.license_front_media_id,
         (SELECT json_object_agg(ba.kind, ba.media_id) FROM booking_attachments ba
           WHERE ba.booking_id = b.id AND ba.deleted_at IS NULL) AS attachments,
         l.name AS branch_name, l.latitude::float AS branch_lat, l.longitude::float AS branch_lng,
         ct.id AS contract_id, ct.contract_number, ct.status AS contract_status, ct.signed_at AS contract_signed_at,
         (SELECT json_build_object('status', p.status, 'provider', p.provider, 'methodType', p.payment_method_type,
                                   'last4', p.payment_method_last4, 'succeededAt', p.succeeded_at, 'amountMinor', p.amount_minor)
            FROM payments p WHERE p.booking_id = b.id AND NOT p.is_balance AND p.parent_payment_id IS NULL
            ORDER BY (p.status = 'SUCCEEDED') DESC, p.created_at DESC LIMIT 1) AS payment,
         -- what is still owed after confirmation: rent paid so far, deposit taken, the latest online balance payment
         (SELECT COALESCE(sum(p.amount_minor), 0) FROM payments p
           WHERE p.booking_id = b.id AND p.purpose = 'RENTAL' AND p.status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED')) AS rent_paid_minor,
         EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id AND p.purpose = 'DEPOSIT'
                  AND p.status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED')) AS deposit_paid,
         (SELECT json_build_object('status', p.status, 'succeededAt', p.succeeded_at, 'methodType', p.payment_method_type)
            FROM payments p WHERE p.booking_id = b.id AND p.is_balance ORDER BY (p.status = 'SUCCEEDED') DESC, p.created_at DESC LIMIT 1) AS balance_payment,
         (SELECT json_build_object('status', s.status, 'rejectReason', s.reject_reason, 'amountMinor', s.amount_minor,
                                   'transferredAt', s.transferred_at, 'createdAt', s.created_at)
            FROM payment_slips s WHERE s.booking_id = b.id ORDER BY s.created_at DESC LIMIT 1) AS slip,
         (SELECT json_agg(json_build_object('status', h.to_status, 'at', h.changed_at) ORDER BY h.changed_at)
            FROM booking_status_history h WHERE h.booking_id = b.id) AS timeline,
         (SELECT json_agg(json_build_object('type', i.item_type, 'description', i.description, 'quantity', i.quantity,
                                            'amountMinor', i.amount_minor) ORDER BY i.sort_order)
            FROM booking_items i WHERE i.booking_id = b.id) AS items
    FROM bookings b
    JOIN vehicles v ON v.id = b.vehicle_id
    JOIN locations l ON l.id = b.pickup_location_id
    LEFT JOIN customer_identities ci ON ci.id = b.customer_identity_id
    LEFT JOIN contracts ct ON ct.booking_id = b.id AND ct.status IN ('ISSUED','SIGNED')
    LEFT JOIN LATERAL (
      SELECT m.file_url, m.variants FROM vehicle_images vi JOIN media m ON m.id = vi.media_id
       WHERE vi.vehicle_id = v.id AND vi.role = 'PRIMARY' AND vi.deleted_at IS NULL LIMIT 1
    ) img ON true`;

export const navigationUrl = (from, to) =>
  to?.lat != null
    ? `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=driving`
    : to?.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(to.address)}` : null;

/** Still owed on a booking: rent (total − rent paid) and the deposit unless taken already. */
function balanceDue(r) {
  // Unpaid booking: the reservation fee is what the customer pays first, the rest at pick-up.
  const rentPaid = r.status === "PENDING" ? dueNow(r) : Number(r.rent_paid_minor ?? (r.payment?.status === "SUCCEEDED" ? r.payment.amountMinor : 0));
  return {
    rent: Math.max(0, Number(r.total_minor) - rentPaid),
    deposit: r.deposit_paid ? 0 : Number(r.deposit_minor),
  };
}
const BALANCE_STATUSES = ["CONFIRMED", "PREPARING", "READY", "IN_DELIVERY", "ACTIVE"];

export function bookingDto(r) {
  return {
    id: r.id,
    number: r.booking_number,
    status: r.status,
    stage: STAGE[r.status],
    createdAt: r.created_at,
    holdExpiresAt: r.status === "PENDING" ? r.hold_expires_at : null,
    pickupAt: r.pickup_at,
    returnAt: r.return_at,
    rentalDays: r.rental_days,
    fulfillment: r.fulfillment_type,
    branch: r.branch_name,
    vehicle: {
      slug: r.vehicle_slug, brand: r.brand, model: r.model, trim: r.trim, year: r.model_year, plate: r.license_plate, fleetNo: r.fleet_no,
      image: r.image_url ? { url: r.image_url, variants: r.image_variants } : null,
    },
    customer: { fullName: r.legal_full_name, phone: r.customer_phone, country: r.customer_country },
    returnPlace: {
      type: r.return_type ?? "BRANCH",
      address: r.return_address?.address ?? null, notes: r.return_address?.notes ?? null,
      lat: r.return_address?.lat ?? null, lng: r.return_address?.lng ?? null,
      distanceMeters: r.return_distance_m, durationSeconds: r.return_duration_s,
      mapsUrl: r.return_address ? navigationUrl({ lat: r.branch_lat, lng: r.branch_lng }, r.return_address) : null,
    },
    bookedByStaff: Boolean(r.created_by_staff),
    delivery: r.fulfillment_type === "DELIVERY"
      ? {
          address: r.delivery_address?.address, notes: r.delivery_address?.notes, lat: r.delivery_address?.lat, lng: r.delivery_address?.lng,
          distanceMeters: r.delivery_distance_m, durationSeconds: r.delivery_duration_s, etaAt: r.delivery_eta_at,
          deliveredAt: r.delivered_at, source: r.delivery_address?.source,
          mapsUrl: navigationUrl({ lat: r.branch_lat, lng: r.branch_lng }, r.delivery_address),
        }
      : null,
    money: {
      currency: r.currency, subtotalMinor: r.subtotal_minor, discountMinor: r.discount_minor, taxMinor: r.tax_minor,
      totalMinor: r.total_minor, depositMinor: r.deposit_minor, items: r.items ?? [],
      dueNowMinor: dueNow(r),
      // Balance at pick-up: rental + delivery + security deposit − what was paid so far (or, unpaid, the fee due now).
      payAtPickupMinor: balanceDue(r).rent + balanceDue(r).deposit,
    },
    // After confirmation the customer may settle the rent balance + deposit online (Stripe) instead of at pick-up.
    balance: BALANCE_STATUSES.includes(r.status)
      ? {
          rentDueMinor: balanceDue(r).rent,
          depositDueMinor: balanceDue(r).deposit,
          dueMinor: balanceDue(r).rent + balanceDue(r).deposit,
          payOnline: config.paymentProvider === "stripe" ? config.cardPaymentsEnabled : config.devToolsEnabled,
          payment: r.balance_payment ?? null,
        }
      : null,
    review: r.review_status
      ? { status: r.review_status, note: r.review_note, submittedAt: r.submitted_at, approvedAt: r.approved_at }
      : null,
    details: { areaOfUse: r.area_of_use, stayLocation: r.stay_location, socialUrl: r.social_url, purpose: r.rental_purpose, contactEmail: r.contact_email },
    contract: r.contract_id ? { number: r.contract_number, status: r.contract_status, signedAt: r.contract_signed_at } : null,
    payment: r.payment,
    slip: r.slip ?? null,
    // Ways this booking can still be paid (only while it waits for payment).
    payWith:
      r.status === "PENDING" && (!r.review_status || r.review_status === "APPROVED")
        ? { card: config.paymentProvider === "stripe" && config.cardPaymentsEnabled, promptpay: config.promptpayConfigured }
        : null,
    summary: SUMMARY_STATUSES.includes(r.status) ? bookingSummaryText(r) : null,
    // The same summary per site language (th / en / zh); `summary` stays the Thai one sent on LINE.
    summaries: SUMMARY_STATUSES.includes(r.status) ? bookingSummaries(r) : null,
    timeline: r.timeline ?? [],
    notes: r.customer_notes,
    documents: documentsDto(r),
  };
}

// ---------------------------------------------------------------- identity documents
// Photos of the renter's ID card / passport and driving licence, kept in private
// storage. The booking points at one identity version; uploads attach to it.

// Driver 1 photos live on the identity record (column); the second driver and a
// reference document (flight ticket, hotel booking, repair order …) are optional
// attachments of the booking itself.
export const DOCUMENT_KINDS = {
  id_front: { column: "id_front_media_id", label: "บัตรประชาชน / พาสปอร์ต (ด้านหน้า)" },
  id_back: { column: "id_back_media_id", label: "บัตรประชาชน (ด้านหลัง)" },
  license_front: { column: "license_front_media_id", label: "ใบขับขี่ (ด้านหน้า)" },
  driver2_id: { attachment: true, label: "บัตรประชาชน / พาสปอร์ต ผู้ขับคนที่ 2" },
  driver2_license: { attachment: true, label: "ใบขับขี่ ผู้ขับคนที่ 2" },
  reference: { attachment: true, label: "เอกสารอ้างอิง (ตั๋วเครื่องบิน / ที่พัก / ใบส่งซ่อม)" },
};
const OPTIONAL_KINDS = ["driver2_id", "driver2_license", "reference"];
const requiredKinds = (idType) => (idType === "PASSPORT" ? ["id_front", "license_front"] : ["id_front", "id_back", "license_front"]);
const allowedKinds = (idType) => [...requiredKinds(idType), ...OPTIONAL_KINDS];

const mediaIdOf = (r, kind) => (DOCUMENT_KINDS[kind].attachment ? r.attachments?.[kind] : r[DOCUMENT_KINDS[kind].column]) ?? null;

const SUMMARY_STATUSES = ["CONFIRMED", "PREPARING", "READY", "IN_DELIVERY", "ACTIVE", "COMPLETED"];

function documentsDto(r) {
  if (r.id_document_type === undefined) return null;
  const required = requiredKinds(r.id_document_type);
  const uploaded = Object.fromEntries(Object.keys(DOCUMENT_KINDS).map((k) => [k, Boolean(mediaIdOf(r, k))]));
  return { required, optional: OPTIONAL_KINDS, uploaded, complete: required.every((k) => uploaded[k]) };
}

// Customers may add or replace photos until the car is handed over.
const DOCS_OPEN = ["PENDING", "CONFIRMED", "PREPARING", "READY", "IN_DELIVERY"];

export async function uploadDocument(auth, number, kind, { body, ext, contentType }, ctx) {
  const doc = DOCUMENT_KINDS[kind];
  return withTransaction(
    async (db) => {
      const b = await loadBooking(db, number, auth, { lock: true });
      // the renter, or staff who may see identity documents (booking on the customer's behalf)
      if (b.user_id !== auth.user.id && !auth.permissions?.has("users:read_sensitive")) throw Forbidden("Only the renter can upload documents");
      if (!DOCS_OPEN.includes(b.status)) throw Conflict("DOCUMENTS_CLOSED", "This booking no longer accepts documents");
      if (!b.customer_identity_id) throw BadRequest("This booking has no renter details");
      if (!allowedKinds(b.id_document_type).includes(kind)) throw BadRequest("This document is not needed for this ID type");
      if (b.review_status === "SUBMITTED" || b.review_status === "APPROVED") {
        if (b.status === "PENDING") throw Conflict("UNDER_REVIEW", "เอกสารอยู่ระหว่างตรวจสอบ หากต้องแก้ไขกรุณาแจ้งแอดมินทาง LINE");
      }

      const key = doc.attachment
        ? `bookings/${b.id}/${kind}-${sha256(body).toString("hex").slice(0, 24)}.${ext}`
        : `identities/${b.customer_identity_id}/${kind}-${sha256(body).toString("hex").slice(0, 24)}.${ext}`;
      const provider = await storage.put("private", key, body, contentType);
      const { rows } = await db.query(
        `INSERT INTO media (media_type, storage_provider, storage_key, mime_type, file_size_bytes, checksum_sha256, is_private, uploaded_by)
         VALUES ('IMAGE', $1, $2, $3, $4, $5, true, $6)
         ON CONFLICT (storage_key) DO UPDATE SET deleted_at = NULL RETURNING id`,
        [provider, key, contentType, body.length, sha256(body), auth.user.id],
      );
      const prevId = mediaIdOf(b, kind);
      if (doc.attachment) {
        await db.query("UPDATE booking_attachments SET deleted_at = now() WHERE booking_id = $1 AND kind = $2 AND deleted_at IS NULL", [b.id, kind]);
        await db.query("INSERT INTO booking_attachments (booking_id, kind, media_id, uploaded_by) VALUES ($1, $2, $3, $4)", [
          b.id, kind, rows[0].id, auth.user.id,
        ]);
      } else {
        await db.query(`UPDATE customer_identities SET ${doc.column} = $2, verification_status = 'PENDING' WHERE id = $1`, [
          b.customer_identity_id, rows[0].id,
        ]);
      }
      if (prevId && prevId !== rows[0].id) {
        await db.query("UPDATE media SET deleted_at = now(), deleted_by = $2 WHERE id = $1", [prevId, auth.user.id]);
      }
      await recordAudit(db, ctx, { action: "identity.document_uploaded", entityType: "booking", entityId: b.id, after: { kind } });
      const after = doc.attachment ? { ...b, attachments: { ...b.attachments, [kind]: rows[0].id } } : { ...b, [doc.column]: rows[0].id };
      return documentsDto(after);
    },
    { actorId: auth.user.id },
  );
}

/**
 * Streams one document photo to its owner, or to staff allowed to see identity
 * documents. Never cached, never public.
 */
export async function readDocument(auth, number, kind) {
  const doc = DOCUMENT_KINDS[kind];
  const b = await loadBooking(pool, number, auth);
  if (b.user_id !== auth.user.id && !auth.permissions.has("users:read_sensitive")) throw NotFound("Document");
  const mediaId = mediaIdOf(b, kind);
  if (!mediaId || !doc) throw NotFound("Document");
  const { rows } = await pool.query("SELECT storage_provider, storage_key, mime_type FROM media WHERE id = $1 AND deleted_at IS NULL", [mediaId]);
  if (!rows[0]) throw NotFound("Document");
  const file = await storage.get("private", rows[0].storage_key, rows[0].storage_provider);
  if (!file) throw NotFound("Document");
  return { body: file.body, contentType: rows[0].mime_type };
}

export async function loadBooking(db, number, auth, { lock = false } = {}) {
  const { rows } = await db.query(`${BOOKING_SELECT} WHERE b.booking_number = $1 AND b.deleted_at IS NULL`, [number]);
  const r = rows[0];
  // Customers only see their own bookings; staff with bookings:read see all. Same 404 either way (no enumeration).
  if (!r || (r.user_id !== auth.user.id && !auth.permissions.has("bookings:read"))) throw NotFound("Booking");
  if (lock) await db.query("SELECT 1 FROM bookings WHERE id = $1 FOR UPDATE", [r.id]);
  return r;
}

// ---------------------------------------------------------------- review (LINE flow)

/** The customer sends details + documents for staff to check; the car stays held meanwhile. */
export async function submitForReview(auth, number, ctx) {
  const settings = await getSettings();
  await withTransaction(
    async (db) => {
      const b = await loadBooking(db, number, auth, { lock: true });
      if (b.user_id !== auth.user.id) throw Forbidden("Only the renter can submit this booking");
      if (b.status === "EXPIRED" || (b.status === "PENDING" && new Date(b.hold_expires_at) < new Date())) {
        throw Conflict("BOOKING_EXPIRED", "การจองหมดเวลาแล้ว กรุณาจองใหม่");
      }
      if (b.status !== "PENDING" || !["DRAFT", "CHANGES_REQUESTED"].includes(b.review_status)) {
        throw Conflict("ALREADY_SUBMITTED", "ส่งเอกสารแล้ว กรุณารอแอดมินตรวจสอบ");
      }
      if (!documentsDto(b).complete) throw Conflict("DOCUMENTS_REQUIRED", "กรุณาแนบรูปบัตรและใบขับขี่ของผู้ขับคนที่ 1 ให้ครบ");
      await db.query(
        `UPDATE bookings SET review_status = 'SUBMITTED', submitted_at = now(), review_note = NULL,
                hold_expires_at = GREATEST(hold_expires_at, now() + make_interval(hours => $2)) WHERE id = $1`,
        [b.id, Number(settings["booking.review_hold_hours"])],
      );
      await emit(db, b.id, "booking.submitted", { bookingNumber: b.booking_number });
      await notify(db, b.user_id, {
        type: "BOOKING_SUBMITTED", bookingId: b.id,
        title: "ได้รับข้อมูลและเอกสารแล้ว",
        body: `การจอง ${b.booking_number} (${b.brand} ${b.model})
เจ้าหน้าที่กำลังตรวจสอบเอกสาร เราล็อกรถไว้ให้ระหว่างนี้ เมื่อตรวจเสร็จจะแจ้งให้โอนค่าจองทันที`,
      });
      await recordAudit(db, ctx, { action: "booking.submitted", entityType: "booking", entityId: b.id });
    },
    { actorId: auth.user.id },
  );
  // after commit, in the background: staff get the details and photos by e-mail
  void mailAdminsBookingSubmitted(number);
  return getBooking(auth, number);
}

export async function getBooking(auth, number) {
  return bookingDto(await loadBooking(pool, number, auth));
}

/**
 * Live delivery tracking for the renter: where the car is (the driver's latest
 * fix on this trip), how far it still has to go and when it should arrive. The
 * driver's position is only shared while the car is on its way.
 */
export async function getTracking(auth, number) {
  const b = await loadBooking(pool, number, auth);
  if (b.fulfillment_type !== "DELIVERY") return { live: false, position: null };
  const { rows } = await pool.query(
    `SELECT a.status, u.full_name AS driver_name, s.phone AS driver_phone,
            t.latitude::float AS lat, t.longitude::float AS lng, t.speed_kmh::float AS speed_kmh, t.recorded_at
       FROM delivery_assignments a
       JOIN staff s ON s.id = a.staff_id
       JOIN users u ON u.id = s.user_id
       LEFT JOIN LATERAL (
         SELECT latitude, longitude, speed_kmh, recorded_at FROM delivery_tracking
          WHERE assignment_id = a.id AND event_type = 'LOCATION' ORDER BY recorded_at DESC LIMIT 1
       ) t ON true
      WHERE a.booking_id = $1 AND a.assignment_type = 'DELIVERY' AND a.status NOT IN ('FAILED','CANCELLED')
      ORDER BY a.created_at DESC LIMIT 1`,
    [b.id],
  );
  const a = rows[0];
  const live = b.status === "IN_DELIVERY";
  const dest = b.delivery_address?.lat != null ? { lat: b.delivery_address.lat, lng: b.delivery_address.lng } : null;
  const position = live && a?.lat != null ? { lat: a.lat, lng: a.lng, speedKmh: a.speed_kmh, at: a.recorded_at } : null;
  const remainingMeters = position && dest ? Math.round(distanceMeters(position, dest)) : null;
  return {
    live,
    status: b.status,
    driver: a && live ? { name: a.driver_name, phone: a.driver_phone } : null,
    position,
    destination: dest && { ...dest, address: b.delivery_address.address },
    branch: { lat: b.branch_lat, lng: b.branch_lng, name: b.branch_name },
    remainingMeters,
    etaAt: remainingMeters != null ? new Date(Date.now() + minutesToDrive(remainingMeters, position.speedKmh) * 60_000) : b.delivery_eta_at,
    nearAt: b.delivery_near_notified_at,
    arrivedAt: b.delivery_arrived_notified_at,
    deliveredAt: b.delivered_at,
  };
}

export async function listMyBookings(auth) {
  const { rows } = await pool.query(`${BOOKING_SELECT} WHERE b.user_id = $1 AND b.deleted_at IS NULL ORDER BY b.created_at DESC LIMIT 50`, [
    auth.user.id,
  ]);
  return rows.map(bookingDto);
}

// ---------------------------------------------------------------- contract

export async function liveContract(db, bookingId) {
  const { rows } = await db.query("SELECT * FROM contracts WHERE booking_id = $1 AND status IN ('ISSUED','SIGNED')", [bookingId]);
  if (!rows[0]) throw NotFound("Contract");
  return rows[0];
}

export async function getContract(auth, number) {
  const b = await loadBooking(pool, number, auth);
  const contract = await liveContract(pool, b.id);
  return { number: contract.contract_number, status: contract.status, signedAt: contract.signed_at, html: await renderContract(pool, contract) };
}

export const assertPayable = (b) => {
  if (b.status === "EXPIRED" || (b.status === "PENDING" && new Date(b.hold_expires_at) < new Date())) {
    throw Conflict("BOOKING_EXPIRED", "การจองหมดเวลาชำระเงินแล้ว กรุณาจองใหม่");
  }
  if (b.status !== "PENDING") throw Conflict("BOOKING_NOT_PENDING", "This booking is no longer awaiting payment");
  // Bookings from the review flow are paid only after staff approve the documents.
  if (b.review_status && b.review_status !== "APPROVED") throw Conflict("NOT_APPROVED", "รอแอดมินตรวจสอบเอกสารก่อนชำระเงิน");
};

/** What is paid online now: the reservation fee for reviewed bookings, otherwise the full total. */
export const dueNow = (b) => Number(b.amount_due_now_minor ?? b.total_minor);

export async function signBookingContract(auth, number, { signature }, ctx) {
  const png = Buffer.from(signature.replace(/^data:image\/png;base64,/, ""), "base64");
  const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (png.length < 67 || !png.subarray(0, 8).equals(PNG_MAGIC)) throw BadRequest("Invalid signature image");
  return withTransaction(
    async (db) => {
      const b = await loadBooking(db, number, auth, { lock: true });
      if (b.user_id !== auth.user.id) throw Forbidden("Only the renter can sign this contract");
      assertPayable(b);
      const contract = await liveContract(db, b.id);
      if (contract.status === "SIGNED") return getContractInTx(db, contract.id);
      await signContract(db, contract, { signaturePng: png, ip: ctx.ip, userAgent: ctx.userAgent, userId: auth.user.id });
      await recordAudit(db, ctx, { action: "contract.signed", entityType: "contract", entityId: contract.id, after: { booking: number } });
      return getContractInTx(db, contract.id);
    },
    { actorId: auth.user.id },
  );
}

/**
 * The agreement as an A4 PDF for its renter or staff. A signed contract is final,
 * so its PDF is rendered once and kept in private storage; an unsigned one is
 * rendered fresh each time and not stored.
 */
export async function contractPdf(auth, number) {
  const b = await loadBooking(pool, number, auth);
  const contract = await liveContract(pool, b.id);
  const filename = `${contract.contract_number}.pdf`;
  if (contract.status === "SIGNED" && contract.document_media_id) {
    const { rows } = await pool.query("SELECT storage_provider, storage_key FROM media WHERE id = $1 AND deleted_at IS NULL", [
      contract.document_media_id,
    ]);
    const file = rows[0] && (await storage.get("private", rows[0].storage_key, rows[0].storage_provider));
    if (file) return { body: file.body, filename };
  }
  const body = await renderPdf(await renderContract(pool, contract));
  if (contract.status === "SIGNED") {
    const key = `contracts/${contract.contract_number}.pdf`;
    const provider = await storage.put("private", key, body, "application/pdf");
    await withTransaction(async (db) => {
      const { rows } = await db.query(
        `INSERT INTO media (media_type, storage_provider, storage_key, mime_type, file_size_bytes, checksum_sha256, is_private)
         VALUES ('DOCUMENT', $1, $2, 'application/pdf', $3, $4, true)
         ON CONFLICT (storage_key) DO UPDATE SET storage_provider = EXCLUDED.storage_provider, file_size_bytes = EXCLUDED.file_size_bytes,
               checksum_sha256 = EXCLUDED.checksum_sha256, deleted_at = NULL
         RETURNING id`,
        [provider, key, body.length, sha256(body)],
      );
      await db.query("UPDATE contracts SET document_media_id = $2 WHERE id = $1", [contract.id, rows[0].id]);
    });
  }
  return { body, filename };
}

async function getContractInTx(db, contractId) {
  const { rows } = await db.query("SELECT * FROM contracts WHERE id = $1", [contractId]);
  return { number: rows[0].contract_number, status: rows[0].status, signedAt: rows[0].signed_at, html: await renderContract(db, rows[0]) };
}

// ---------------------------------------------------------------- payment

export async function startCheckout(auth, number, { locale }, ctx) {
  if (!config.cardPaymentsEnabled) throw new AppError(503, "CARD_PAYMENTS_DISABLED", "ชำระด้วยบัตรยังไม่เปิดให้บริการ กรุณาโอนผ่าน PromptPay");
  const provider = paymentProvider();
  const prepared = await withTransaction(
    async (db) => {
      const b = await loadBooking(db, number, auth, { lock: true });
      if (b.user_id !== auth.user.id) throw Forbidden();
      assertPayable(b);
      // Reviewed bookings need no e-signature (the PDF is sent for acknowledgement, signed on paper at pick-up).
      if (!b.review_status && (await liveContract(db, b.id)).status !== "SIGNED") {
        throw Conflict("CONTRACT_NOT_SIGNED", "Please accept and sign the rental agreement first");
      }

      // Gateways need ≥30 minutes on a checkout page, so the hold is extended to cover it.
      const { rows: h } = await db.query(
        "UPDATE bookings SET hold_expires_at = GREATEST(hold_expires_at, now() + interval '35 minutes') WHERE id = $1 RETURNING hold_expires_at",
        [b.id],
      );
      const { rows } = await db.query(
        `INSERT INTO payments (booking_id, user_id, purpose, provider, amount_minor, currency, idempotency_key)
         VALUES ($1, $2, 'RENTAL', $3, $4, $5, $6) RETURNING *`,
        [b.id, auth.user.id, provider.name, dueNow(b), b.currency, randomUUID()],
      );
      return { booking: b, payment: rows[0], holdUntil: new Date(h[0].hold_expires_at) };
    },
    { actorId: auth.user.id },
  );

  const { booking: b, payment } = prepared;
  const base = `${config.FRONTEND_URL}/bookings/${b.booking_number}`;
  const checkout = await provider.createCheckout({
    payment,
    booking: { ...b, description: `${b.brand} ${b.model} · ${b.rental_days} วัน` },
    customerEmail: auth.user.email.endsWith("@coolkids.local") ? undefined : auth.user.email,
    successUrl: `${base}?paid=1`,
    cancelUrl: `${base}?cancelled=1`,
    expiresAt: new Date(Math.min(prepared.holdUntil.getTime(), Date.now() + 23 * HOUR)),
    locale,
  });

  await withTransaction(async (db) => {
    await db.query("UPDATE payments SET provider_payment_id = $2, status = 'REQUIRES_ACTION' WHERE id = $1", [payment.id, checkout.providerPaymentId]);
    await db.query(
      `INSERT INTO payment_transactions (payment_id, transaction_type, status, amount_minor, currency, provider_transaction_id)
       VALUES ($1, 'INITIALIZE', 'PENDING', $2, $3, $4)`,
      [payment.id, payment.amount_minor, payment.currency, checkout.providerPaymentId],
    );
    await recordAudit(db, ctx, { action: "payment.initiated", entityType: "payment", entityId: payment.id, after: { provider: provider.name, amount: payment.amount_minor } });
  });
  return { url: checkout.url, provider: provider.name };
}

/**
 * Marks a payment captured and confirms its booking. Idempotent: webhook,
 * return-page verification and retries can all call it safely.
 */
export async function confirmPayment(paymentId, details = {}) {
  return withTransaction((db) => confirmPaymentTx(db, paymentId, details));
}

/** confirmPayment inside the caller's transaction (the slip check records the slip and the payment together). */
export async function confirmPaymentTx(
  db,
  paymentId,
  { methodType = null, last4: cardLast4 = null, raw = {}, webhookEventId = null, providerPaymentId, amountMinor, currency } = {},
) {
  const { rows } = await db.query("SELECT * FROM payments WHERE id = $1 FOR UPDATE", [paymentId]);
  const p = rows[0];
  if (!p) throw NotFound("Payment");
  if (p.status === "SUCCEEDED") return { alreadyConfirmed: true };
  // A balance checkout charges its linked rows (the deposit) in the same session.
  const { rows: linked } = await db.query("SELECT * FROM payments WHERE parent_payment_id = $1 FOR UPDATE", [p.id]);
  const chargedMinor = Number(p.amount_minor) + linked.reduce((t, x) => t + Number(x.amount_minor), 0);
  // The gateway's own record must match ours: same checkout session, full amount, same currency.
  // Anything else (tampered metadata, partial / wrong-currency payment) is never auto-confirmed.
  if (
    (providerPaymentId !== undefined && providerPaymentId !== p.provider_payment_id) ||
    (amountMinor !== undefined && Number(amountMinor) !== chargedMinor) ||
    (currency !== undefined && String(currency).toUpperCase() !== p.currency)
  ) {
    await emit(db, p.booking_id, "payment.mismatch", { paymentId: p.id, providerPaymentId, amountMinor, currency });
    throw new AppError(409, "PAYMENT_MISMATCH", "Payment does not match the booking; flagged for review");
  }

  await db.query(
    `UPDATE payments SET status = 'SUCCEEDED', succeeded_at = now(), payment_method_type = $2, payment_method_last4 = $3 WHERE id = $1`,
    [p.id, methodType, cardLast4],
  );
  await db.query(
    `INSERT INTO payment_transactions (payment_id, transaction_type, status, amount_minor, currency, provider_transaction_id, provider_response, webhook_event_id)
     VALUES ($1, 'CAPTURE', 'SUCCEEDED', $2, $3, $4, $5, $6)`,
    [p.id, p.amount_minor, p.currency, p.provider_payment_id, JSON.stringify(raw), webhookEventId],
  );
  for (const x of linked) {
    await db.query(
      "UPDATE payments SET status = 'SUCCEEDED', succeeded_at = now(), payment_method_type = $2, payment_method_last4 = $3 WHERE id = $1",
      [x.id, methodType, cardLast4],
    );
    await db.query(
      `INSERT INTO payment_transactions (payment_id, transaction_type, status, amount_minor, currency, provider_transaction_id, provider_response)
       VALUES ($1, 'CAPTURE', 'SUCCEEDED', $2, $3, $4, $5)`,
      [x.id, x.amount_minor, x.currency, p.provider_payment_id, JSON.stringify({ paidWith: p.id })],
    );
  }
  const { rows: bRows } = await db.query("SELECT id, status, user_id, booking_number FROM bookings WHERE id = $1 FOR UPDATE", [p.booking_id]);
  const b = bRows[0];
  if (p.is_balance) {
    await emit(db, b.id, "payment.balance_paid", { bookingNumber: b.booking_number, paymentId: p.id, amountMinor: chargedMinor });
    await notify(db, b.user_id, {
      type: "PAYMENT_RECEIVED", bookingId: b.id,
      title: "รับชำระค่าเช่าและเงินประกันแล้ว",
      body: `เลขที่การจอง ${b.booking_number}\nยอดที่ชำระ ${(chargedMinor / 100).toLocaleString("th-TH")} บาท\nวันรับรถไม่ต้องชำระเพิ่ม (เงินประกันคืนภายใน 24 ชม. หลังคืนรถ)`,
    });
  } else if (b.status === "PENDING") {
    await confirmBookingTx(db, b, p.id);
  } else {
    // Paid after the hold lapsed: money is in, car may be gone → staff must refund or rebook.
    await emit(db, b.id, "payment.needs_review", { bookingNumber: b.booking_number, paymentId: p.id, bookingStatus: b.status });
  }
  return { bookingNumber: b.booking_number };
}

/** PENDING → CONFIRMED, and the customer gets the full summary (as the shop used to type it in the chat). */
async function confirmBookingTx(db, b, paymentId = null, title = "ชำระเงินสำเร็จ ยืนยันการจองแล้ว ขอบคุณที่ใช้บริการ Coolkids") {
  await db.query("UPDATE bookings SET status = 'CONFIRMED' WHERE id = $1", [b.id]);
  await emit(db, b.id, "booking.confirmed", { bookingNumber: b.booking_number, paymentId });
  const { rows: full } = await db.query(`${BOOKING_SELECT} WHERE b.id = $1`, [b.id]);
  await notify(db, b.user_id, {
    type: "BOOKING_CONFIRMED", bookingId: b.id,
    title,
    body: `เลขที่การจอง ${b.booking_number}\n\n${bookingSummaryText(full[0])}\n\nสัญญาเช่า (PDF) ดาวน์โหลดได้จากลิงก์ด้านล่าง`,
  });
}

// ---------------------------------------------------------------- booked by staff (back office)

/** The customer's account: by their e-mail, else one keyed by their phone number (walk-in / phone customers). */
async function customerAccount(email, c) {
  const key = (email ?? `phone-${c.phone.replace(/\D/g, "")}@walkin.coolkids.local`).toLowerCase();
  return withTransaction(async (db) => {
    const { rows } = await db.query("SELECT id, email, full_name FROM users WHERE email = $1 AND deleted_at IS NULL", [key]);
    if (rows[0]) return rows[0];
    const { rows: made } = await db.query(
      "INSERT INTO users (email, full_name, phone) VALUES ($1, $2, $3) RETURNING id, email, full_name",
      [key, c.fullName, c.phone],
    );
    return made[0];
  });
}

/**
 * Back office: staff fill in the booking for a customer (by phone, LINE chat, walk-in).
 * Same checks, pricing and car hold as the customer's own form; the booking belongs
 * to the customer's account so it shows up when they sign in with that e-mail.
 */
export async function createStaffBooking(staff, input, ctx) {
  const { customerEmail, ...booking } = input;
  const customer = await customerAccount(customerEmail, booking.customer);
  const asCustomer = { user: customer, roles: [], permissions: new Set() };
  return createBooking(asCustomer, { ...booking, contactEmail: booking.contactEmail ?? customerEmail }, ctx, { staff });
}

/**
 * Staff confirm a booking the customer paid for outside the system (cash, bank transfer):
 * documents must be attached; what was received is recorded as a payment (0 = nothing yet),
 * and the booking is confirmed at once without the online payment step.
 */
export async function confirmOffline(staff, number, { paidMinor, method, note }, ctx) {
  await withTransaction(
    async (db) => {
      const b = await loadBooking(db, number, staff, { lock: true });
      if (b.status !== "PENDING") throw Conflict("BOOKING_NOT_PENDING", "การจองนี้ยืนยันไปแล้ว หรือถูกยกเลิก / หมดเวลา");
      if (!documentsDto(b).complete) throw Conflict("DOCUMENTS_REQUIRED", "แนบรูปบัตรและใบขับขี่ของผู้ขับคนที่ 1 ให้ครบก่อนยืนยัน");
      if (paidMinor > Number(b.total_minor) + Number(b.deposit_minor)) throw BadRequest("ยอดที่รับมากกว่ายอดรวมของการจอง");
      await db.query(
        `UPDATE bookings SET review_status = 'APPROVED', submitted_at = COALESCE(submitted_at, now()),
                approved_at = now(), approved_by = $2, review_note = $3 WHERE id = $1`,
        [b.id, staff.user.id, note ?? null],
      );
      let paymentId = null;
      if (paidMinor > 0) {
        // 'offline' (not 'counter'): money taken before hand-over, so the hand-over screen still collects the rest
        const { rows } = await db.query(
          `INSERT INTO payments (booking_id, user_id, purpose, provider, provider_payment_id, amount_minor, currency, status,
                                 succeeded_at, payment_method_type, idempotency_key)
           VALUES ($1, $2, 'RENTAL', 'offline', $3, $4, $5, 'SUCCEEDED', now(), $6, $7) RETURNING id`,
          [b.id, b.user_id, `offline_${randomUUID()}`, paidMinor, b.currency, method, randomUUID()],
        );
        paymentId = rows[0].id;
        await db.query(
          `INSERT INTO payment_transactions (payment_id, transaction_type, status, amount_minor, currency, provider_response)
           VALUES ($1, 'CAPTURE', 'SUCCEEDED', $2, $3, $4)`,
          [paymentId, paidMinor, b.currency, JSON.stringify({ recordedBy: staff.user.id, method, note: note ?? null })],
        );
      }
      await confirmBookingTx(db, b, paymentId, "ยืนยันการจองแล้ว ขอบคุณที่ใช้บริการ Coolkids");
      await recordAudit(db, ctx, {
        action: "booking.confirmed_offline", entityType: "booking", entityId: b.id, after: { paidMinor, method, note: note ?? null },
      });
    },
    { actorId: staff.user.id },
  );
  return getBooking(staff, number);
}

// ---------------------------------------------------------------- balance (rent + deposit) online

/**
 * Stripe checkout for what is still owed after confirmation: the rent balance and the
 * security deposit. Started by the customer ("ชำระค่าเช่าและเงินประกัน") or by staff at
 * hand-over (QR / link for the customer's phone). One session; the deposit is a linked row.
 */
export async function startBalanceCheckout(auth, number, { locale, byStaff = false }, ctx) {
  if (!config.cardPaymentsEnabled) throw new AppError(503, "CARD_PAYMENTS_DISABLED", "ชำระด้วยบัตรยังไม่เปิดให้บริการ");
  const provider = paymentProvider();
  const prepared = await withTransaction(
    async (db) => {
      const b = await loadBooking(db, number, auth, { lock: true });
      if (!byStaff && b.user_id !== auth.user.id) throw Forbidden();
      if (!BALANCE_STATUSES.includes(b.status)) throw Conflict("NOT_CONFIRMED", "ชำระส่วนที่เหลือได้หลังยืนยันการจองแล้วเท่านั้น");
      const due = balanceDue(b);
      if (due.rent + due.deposit <= 0) throw Conflict("NOTHING_DUE", "การจองนี้ชำระครบแล้ว");
      // Only one live balance checkout: older open ones are closed so the customer cannot pay twice.
      const { rows: open } = await db.query(
        `UPDATE payments SET status = 'CANCELLED' WHERE booking_id = $1 AND status IN ('INITIATED','REQUIRES_ACTION')
            AND (is_balance OR parent_payment_id IS NOT NULL) RETURNING provider_payment_id, is_balance`,
        [b.id],
      );
      const leadPurpose = due.rent > 0 ? "RENTAL" : "DEPOSIT";
      const { rows } = await db.query(
        `INSERT INTO payments (booking_id, user_id, purpose, provider, amount_minor, currency, idempotency_key, is_balance)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true) RETURNING *`,
        [b.id, b.user_id, leadPurpose, provider.name, due.rent > 0 ? due.rent : due.deposit, b.currency, randomUUID()],
      );
      const lead = rows[0];
      let child = null;
      if (due.rent > 0 && due.deposit > 0) {
        const { rows: c } = await db.query(
          `INSERT INTO payments (booking_id, user_id, purpose, provider, amount_minor, currency, idempotency_key, parent_payment_id)
           VALUES ($1, $2, 'DEPOSIT', $3, $4, $5, $6, $7) RETURNING *`,
          [b.id, b.user_id, provider.name, due.deposit, b.currency, randomUUID(), lead.id],
        );
        child = c[0];
      }
      const stale = open.filter((o) => o.is_balance && o.provider_payment_id).map((o) => o.provider_payment_id);
      return { booking: b, lead, child, due, stale };
    },
    { actorId: auth.user.id },
  );

  const { booking: b, lead, child, due } = prepared;
  for (const id of prepared.stale) await provider.expire?.(id).catch(() => {});
  const totalMinor = due.rent + due.deposit;
  const base = `${config.FRONTEND_URL}/bookings/${b.booking_number}`;
  const lines = [
    ...(due.rent ? [{ name: `ค่าเช่า ${b.brand} ${b.model} · ${b.rental_days} วัน`, amountMinor: due.rent }] : []),
    ...(due.deposit ? [{ name: "เงินประกัน (คืนภายใน 24 ชม. หลังคืนรถ)", amountMinor: due.deposit }] : []),
  ];
  const expiresAt = new Date(Date.now() + 23 * HOUR);
  const checkout = await provider.createCheckout({
    payment: { ...lead, amount_minor: totalMinor },
    booking: { ...b, description: `${b.brand} ${b.model} · ค่าเช่าและเงินประกัน` },
    lines,
    customerEmail: b.contact_email ?? undefined,
    successUrl: `${base}?paid=balance`,
    cancelUrl: base,
    expiresAt,
    locale,
  });

  await withTransaction(async (db) => {
    await db.query("UPDATE payments SET provider_payment_id = $2, status = 'REQUIRES_ACTION' WHERE id = $1", [lead.id, checkout.providerPaymentId]);
    if (child) {
      await db.query("UPDATE payments SET provider_payment_id = $2, status = 'REQUIRES_ACTION' WHERE id = $1", [child.id, `${checkout.providerPaymentId}#deposit`]);
    }
    await db.query(
      `INSERT INTO payment_transactions (payment_id, transaction_type, status, amount_minor, currency, provider_transaction_id)
       VALUES ($1, 'INITIALIZE', 'PENDING', $2, $3, $4)`,
      [lead.id, totalMinor, b.currency, checkout.providerPaymentId],
    );
    await recordAudit(db, ctx, {
      action: "payment.balance_initiated", entityType: "payment", entityId: lead.id,
      after: { provider: provider.name, rent: due.rent, deposit: due.deposit, byStaff },
    });
  });
  return { url: checkout.url, provider: provider.name, amountMinor: totalMinor, currency: b.currency, expiresAt };
}

export async function failPayment(paymentId, reason) {
  await pool.query(
    "UPDATE payments SET status = 'FAILED', failure_message = $2 WHERE id = $1 AND status IN ('INITIATED','REQUIRES_ACTION')",
    [paymentId, reason],
  );
}

/** Return-page check for gateways that redirect back (Stripe): asks the gateway, never trusts the query string. */
export async function verifyCheckout(auth, number, sessionId) {
  const b = await loadBooking(pool, number, auth);
  const { rows } = await pool.query("SELECT id, provider, status FROM payments WHERE booking_id = $1 AND provider_payment_id = $2", [b.id, sessionId]);
  const p = rows[0];
  if (!p) throw NotFound("Payment");
  if (p.status !== "SUCCEEDED" && p.provider === "stripe") {
    const result = await paymentProvider().retrieve(sessionId);
    if (result.paid) await confirmPayment(p.id, result);
  }
  return getBooking(auth, number);
}

export async function mockPaymentInfo(auth, paymentId) {
  const { rows } = await pool.query(
    `SELECT p.id, p.status, p.amount_minor, p.currency, p.provider, b.booking_number, b.user_id, v.brand, v.model
       FROM payments p JOIN bookings b ON b.id = p.booking_id JOIN vehicles v ON v.id = b.vehicle_id WHERE p.id = $1`,
    [paymentId],
  );
  const p = rows[0];
  if (!p || p.provider !== "mock" || p.user_id !== auth.user.id) throw NotFound("Payment");
  return { id: p.id, status: p.status, amountMinor: p.amount_minor, currency: p.currency, bookingNumber: p.booking_number, vehicle: `${p.brand} ${p.model}` };
}

export async function completeMockPayment(auth, paymentId, outcome) {
  if (!config.devToolsEnabled) throw NotFound("Payment"); // a free "paid" button must never exist on a real site
  const info = await mockPaymentInfo(auth, paymentId);
  if (outcome === "success") await confirmPayment(paymentId, { methodType: "card", last4: "4242", raw: { mock: true } });
  else await failPayment(paymentId, "Declined on mock gateway");
  return { bookingNumber: info.bookingNumber };
}
