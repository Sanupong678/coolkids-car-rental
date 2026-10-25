import express, { Router } from "express";
import { z } from "zod";
import { config } from "../../config/env.js";
import { requireAuth, requireOnboarded } from "../../middleware/auth.js";
import { bookingCreateLimiter, mapsLimiter, paymentLimiter } from "../../middleware/security.js";
import { validate } from "../../middleware/validate.js";
import { BadRequest } from "../../shared/errors.js";
import { IMAGE_TYPES, imageExtension } from "../../shared/images.js";
import { auditContext } from "../audit/audit.service.js";
import * as maps from "../maps/maps.service.js";
import * as slips from "../payments/slips.service.js";
import * as documents from "./documents.service.js";
import * as schemas from "./bookings.schemas.js";
import * as service from "./bookings.service.js";

// /api/v1 — customer booking flow, address search and the dev payment gateway.
export function bookingRoutes() {
  const router = Router();
  const noStore = (_req, res, next) => (res.set("Cache-Control", "no-store"), next());
  router.use(["/bookings", "/payments", "/maps", "/delivery"], noStore);

  router.get(
    "/maps/autocomplete",
    requireAuth,
    mapsLimiter,
    validate({ query: z.object({ q: z.string().trim().min(2).max(120), session: z.string().max(100).optional() }) }),
    async (req, res) => {
      const origin = await service.branchOrigin();
      res.json({ data: await maps.autocomplete(req.valid.query.q, req.valid.query.session, origin) });
    },
  );

  // Map pin → address text (address fields on the booking form).
  router.get(
    "/maps/reverse",
    requireAuth,
    mapsLimiter,
    validate({ query: z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }) }),
    async (req, res) => {
      res.json({ data: await maps.reverseGeocode(req.valid.query.lat, req.valid.query.lng) });
    },
  );

  // Search box on the map picker: place name / address → places with coordinates.
  router.get(
    "/maps/search",
    requireAuth,
    mapsLimiter,
    validate({ query: z.object({ q: z.string().trim().min(2).max(120) }) }),
    async (req, res) => {
      res.json({ data: await maps.searchPlaces(req.valid.query.q, await service.branchOrigin()) });
    },
  );

  // ?vehicle=<slug> prices the delivery with that car's fee and from its branch.
  router.post(
    "/delivery/quote",
    requireAuth,
    mapsLimiter,
    validate({ body: schemas.deliveryInput, query: z.object({ vehicle: z.string().regex(/^[a-z0-9-]+$/).max(120).optional() }) }),
    async (req, res) => {
      const quote = await service.deliveryQuote(req.valid.body, req.valid.query.vehicle);
      res.json({ data: { ...quote, mapsConfigured: config.mapsConfigured } });
    },
  );

  router.get("/bookings", requireAuth, async (req, res) => {
    res.json({ data: await service.listMyBookings(req.auth) });
  });

  router.post("/bookings", requireOnboarded, bookingCreateLimiter, validate({ body: schemas.createBookingSchema }), async (req, res) => {
    res.status(201).json({ data: await service.createBooking(req.auth, req.valid.body, auditContext(req)) });
  });

  router.get("/bookings/:number", requireAuth, validate({ params: schemas.numberParam }), async (req, res) => {
    res.json({ data: await service.getBooking(req.auth, req.valid.params.number) });
  });

  // Live delivery tracking (polled every few seconds by the status page).
  router.get("/bookings/:number/tracking", requireAuth, validate({ params: schemas.numberParam }), async (req, res) => {
    res.json({ data: await service.getTracking(req.auth, req.valid.params.number) });
  });

  // LINE flow: details + documents go to staff; payment opens once they approve.
  router.post("/bookings/:number/submit", requireAuth, paymentLimiter, validate({ params: schemas.numberParam }), async (req, res) => {
    res.json({ data: await service.submitForReview(req.auth, req.valid.params.number, auditContext(req)) });
  });

  // The customer's booking slip and receipts (PDF), e.g. from the LINE message link.
  router.get("/bookings/:number/documents", requireAuth, validate({ params: schemas.numberParam }), async (req, res) => {
    const b = await service.getBooking(req.auth, req.valid.params.number);
    res.json({ data: await documents.listDocuments(b.id) });
  });
  router.get(
    "/bookings/:number/documents/pdf",
    requireAuth,
    paymentLimiter,
    validate({ params: schemas.numberParam, query: z.object({ kind: z.enum(["booking", "receipt"]), receipt: z.uuid().optional() }) }),
    async (req, res) => {
      const b = await service.getBooking(req.auth, req.valid.params.number); // owner or staff, else 404
      const { body, filename } = await documents.documentPdf(b.id, req.valid.query.kind, req.valid.query.receipt);
      res.set({
        "Content-Type": "application/pdf", "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      });
      res.send(body);
    },
  );

  router.get("/bookings/:number/contract", requireAuth, validate({ params: schemas.numberParam }), async (req, res) => {
    res.json({ data: await service.getContract(req.auth, req.valid.params.number) });
  });

  router.get("/bookings/:number/contract.pdf", requireAuth, paymentLimiter, validate({ params: schemas.numberParam }), async (req, res) => {
    const { body, filename } = await service.contractPdf(req.auth, req.valid.params.number);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `${req.query.download ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    });
    res.send(body);
  });

  router.post(
    "/bookings/:number/contract/sign",
    requireAuth,
    paymentLimiter,
    validate({ params: schemas.numberParam, body: schemas.signSchema }),
    async (req, res) => {
      res.json({ data: await service.signBookingContract(req.auth, req.valid.params.number, req.valid.body, auditContext(req)) });
    },
  );

  router.post(
    "/bookings/:number/checkout",
    requireAuth,
    paymentLimiter,
    validate({ params: schemas.numberParam, body: schemas.checkoutSchema }),
    async (req, res) => {
      res.json({ data: await service.startCheckout(req.auth, req.valid.params.number, req.valid.body, auditContext(req)) });
    },
  );

  // After confirmation: the rent balance + security deposit by card / PromptPay (Stripe).
  router.post(
    "/bookings/:number/balance/checkout",
    requireAuth,
    paymentLimiter,
    validate({ params: schemas.numberParam, body: schemas.checkoutSchema }),
    async (req, res) => {
      res.json({ data: await service.startBalanceCheckout(req.auth, req.valid.params.number, req.valid.body, auditContext(req)) });
    },
  );

  router.post(
    "/bookings/:number/payment/verify",
    requireAuth,
    paymentLimiter,
    validate({ params: schemas.numberParam, body: schemas.verifySchema }),
    async (req, res) => {
      res.json({ data: await service.verifyCheckout(req.auth, req.valid.params.number, req.valid.body.sessionId) });
    },
  );

  // PromptPay: QR for the exact total, then the transfer slip (raw image body) is checked and the booking confirmed.
  router.get("/bookings/:number/promptpay", requireAuth, validate({ params: schemas.numberParam }), async (req, res) => {
    res.json({ data: await slips.promptpayInfo(req.auth, req.valid.params.number) });
  });
  router.post(
    "/bookings/:number/slip",
    requireAuth,
    paymentLimiter,
    express.raw({ type: Object.keys(IMAGE_TYPES), limit: "8mb" }),
    validate({ params: schemas.numberParam }),
    async (req, res) => {
      const contentType = req.get("content-type")?.split(";")[0];
      const ext = imageExtension(contentType, req.body);
      if (!ext) throw BadRequest("ส่งรูปสลิปเป็น JPEG, PNG หรือ WebP ขนาดไม่เกิน 8 MB");
      res.json({ data: await slips.submitSlip(req.auth, req.valid.params.number, { body: req.body, ext, contentType }, auditContext(req)) });
    },
  );

  // Identity document photos (private storage). Raw image body, one photo per kind.
  const docParams = z.object({ number: schemas.numberParam.shape.number, kind: z.enum(Object.keys(service.DOCUMENT_KINDS)) });
  router.put(
    "/bookings/:number/documents/:kind",
    requireAuth,
    paymentLimiter,
    express.raw({ type: Object.keys(IMAGE_TYPES), limit: "8mb" }),
    validate({ params: docParams }),
    async (req, res) => {
      const contentType = req.get("content-type")?.split(";")[0];
      const ext = imageExtension(contentType, req.body);
      if (!ext) throw BadRequest("ส่งรูป JPEG, PNG หรือ WebP ขนาดไม่เกิน 8 MB");
      const data = await service.uploadDocument(req.auth, req.valid.params.number, req.valid.params.kind, { body: req.body, ext, contentType }, auditContext(req));
      res.json({ data });
    },
  );
  router.get("/bookings/:number/documents/:kind", requireAuth, validate({ params: docParams }), async (req, res) => {
    const file = await service.readDocument(req.auth, req.valid.params.number, req.valid.params.kind);
    res.set({
      "Content-Type": file.contentType,
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "Content-Disposition": "inline",
    });
    res.send(file.body);
  });

  // Development gateway (refused in production by config + service).
  router.get("/payments/mock/:id", requireAuth, validate({ params: schemas.paymentParam }), async (req, res) => {
    res.json({ data: await service.mockPaymentInfo(req.auth, req.valid.params.id) });
  });
  router.post(
    "/payments/mock/:id/complete",
    requireAuth,
    validate({ params: schemas.paymentParam, body: z.object({ outcome: z.enum(["success", "fail"]) }) }),
    async (req, res) => {
      res.json({ data: await service.completeMockPayment(req.auth, req.valid.params.id, req.valid.body.outcome) });
    },
  );

  return router;
}
