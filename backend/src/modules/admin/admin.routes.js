import express, { Router } from "express";
import { createHash } from "node:crypto";
import QRCode from "qrcode";
import { z } from "zod";
import { requireAnyPermission, requirePermission } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { PERMISSIONS as P } from "../rbac/permissions.js";
import { BadRequest } from "../../shared/errors.js";
import { IMAGE_TYPES, imageExtension } from "../../shared/images.js";
import * as storage from "../../shared/storage.js";
import { auditContext } from "../audit/audit.service.js";
import * as analytics from "./analytics.service.js";
import * as dispatch from "./dispatch.service.js";
import * as operations from "./operations.service.js";
import * as slips from "../payments/slips.service.js";
import * as review from "./review.service.js";
import * as fleetops from "./fleetops.service.js";
import * as accounts from "./accounts.service.js";
import * as staffEmail from "../notifications/staff-recipients.js";
import * as documents from "../bookings/documents.service.js";
import * as bookings from "../bookings/bookings.service.js";
import { numberParam, offlineConfirmSchema, staffBookingSchema } from "../bookings/bookings.schemas.js";
import { PAGE_KEYS } from "../rbac/pages.js";
import * as vehicles from "./vehicles.service.js";


const minor = z.number().int().min(0).max(100_000_000);
const vehicleBase = z.object({
  categorySlug: z.string().regex(/^[a-z0-9-]+$/),
  brand: z.string().trim().min(1).max(40),
  model: z.string().trim().min(1).max(60),
  trim: z.string().trim().max(60).nullable().optional(),
  year: z.number().int().min(1990).max(2100),
  licensePlate: z.string().trim().min(2).max(20),
  color: z.string().trim().max(40).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  transmission: z.enum(["AUTOMATIC", "MANUAL"]),
  fuel: z.enum(["PETROL", "DIESEL", "HYBRID", "PLUG_IN_HYBRID", "ELECTRIC"]),
  drive: z.enum(["FWD", "RWD", "AWD", "4WD"]),
  seats: z.number().int().min(1).max(20),
  doors: z.number().int().min(1).max(6).nullable().optional(),
  luggageLiters: z.number().int().min(0).max(5000).nullable().optional(),
  engineCc: z.number().int().min(1).max(10000).nullable().optional(),
  powerHp: z.number().int().min(1).max(2000).nullable().optional(),
  torqueNm: z.number().int().min(1).max(3000).nullable().optional(),
  fuelEconomy: z.number().min(0.1).max(99).nullable().optional(),
  rangeKm: z.number().int().min(1).max(2000).nullable().optional(),
  dailyRateMinor: minor.min(100),
  hourlyRateMinor: minor.min(1).nullable().optional(),
  depositMinor: minor,
  minRentalDays: z.number().int().min(1).max(365),
  maxRentalDays: z.number().int().min(1).max(3650).nullable().optional(),
  minDriverAge: z.number().int().min(16).max(99),
  status: z.enum(["DRAFT", "ACTIVE", "MAINTENANCE", "OUT_OF_SERVICE"]),
  isFeatured: z.boolean(),
  imageUrl: z.string().regex(/^\/(uploads|cars)\/[\w./-]+$/).optional(),
  fleetNo: z.number().int().min(1).max(9999).nullable().optional(), // "#3" on the board and timeline
  // Delivery fee for this car; null = shop default.
  deliveryFreeKm: z.number().min(0).max(500).nullable().optional(),
  deliveryPerKmMinor: minor.nullable().optional(),
  deliveryMinFeeMinor: minor.nullable().optional(),
  features: z.array(z.string().regex(/^[a-z0-9_]+$/)).max(50).optional(),
});
const idParam = z.object({ id: z.uuid() });
// A staff member's position: sent with each action they take, and every ~15 s while they drive a delivery.
const position = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000).optional(),
  speed: z.number().min(0).max(100).nullable().optional(), // m/s
  heading: z.number().min(0).max(360).nullable().optional(),
});
const withPosition = (auth, location) => location && dispatch.updateMyLocation(auth, location).catch(() => {}); // accounts without a staff profile: ignore
const range = z.object({ from: z.iso.date(), to: z.iso.date() });


// /api/v1/admin — back office. Every route checks a permission; the frontend guard is UX only.
export function adminRoutes() {
  const router = Router();

  // ---- dashboard & analytics
  router.get(
    "/analytics/overview",
    requirePermission(P.ANALYTICS_READ, P.ANALYTICS_FINANCE),
    validate({ query: z.object({ days: z.coerce.number().int().min(1).max(730).default(30) }) }),
    async (req, res) => {
      res.set("Cache-Control", "no-store");
      res.json({ data: await analytics.overview(req.valid.query.days) });
    },
  );

  router.get("/exports", requirePermission(P.ANALYTICS_READ), (_req, res) => {
    res.json({ data: Object.entries(analytics.DATASETS).map(([name, d]) => ({ name, description: d.description })) });
  });

  router.get(
    "/exports/:dataset",
    requirePermission(P.ANALYTICS_READ, P.ANALYTICS_FINANCE),
    validate({ params: z.object({ dataset: z.string().regex(/^[a-z_]+(\.(csv|json))?$/) }), query: range }),
    async (req, res) => {
      const [name, ext = "csv"] = req.valid.params.dataset.split(".");
      const { from, to } = req.valid.query;
      if (from > to) throw BadRequest("from must not be after to");
      const data = await analytics.exportDataset(name, from, to);
      res.set("Cache-Control", "no-store");
      if (ext === "json") return res.json({ dataset: name, from, to, ...data });
      res.set("Content-Type", "text/csv; charset=utf-8");
      res.set("Content-Disposition", `attachment; filename="coolkids_${name}_${from}_${to}.csv"`);
      res.send(`﻿${analytics.toCsv(data)}`); // BOM so Excel opens Thai text correctly
    },
  );

  // ---- operations board
  router.get(
    "/operations",
    requirePermission(P.BOOKINGS_READ),
    validate({ query: z.object({ date: z.iso.date().optional() }) }),
    async (req, res) => {
      res.set("Cache-Control", "no-store");
      res.json({ data: { ...(await operations.board(req.valid.query.date)), next: operations.NEXT } });
    },
  );

  router.post(
    "/bookings/:id/status",
    requireAnyPermission(P.BOOKINGS_WRITE, P.DELIVERIES_UPDATE),
    validate({
      params: idParam,
      body: z.object({
        status: z.enum(["PREPARING", "READY", "IN_DELIVERY", "ACTIVE", "COMPLETED", "CANCELLED"]),
        reason: z.string().trim().max(300).optional(),
        location: position.optional(),
      }),
    }),
    async (req, res) => {
      if (req.valid.body.status === "CANCELLED" && !req.auth.permissions.has(P.BOOKINGS_CANCEL)) throw BadRequest("Not allowed to cancel");
      const { location, ...change } = req.valid.body;
      const data = await operations.changeStatus(req.auth, req.valid.params.id, change, auditContext(req));
      await withPosition(req.auth, location);
      res.json({ data });
    },
  );

  // ---- dispatch: month calendar, drivers, live positions, printable contract
  router.get("/dispatch/summary", requirePermission(P.BOOKINGS_READ), async (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ data: await dispatch.summary() });
  });

  router.get(
    "/dispatch/calendar",
    requirePermission(P.BOOKINGS_READ),
    validate({ query: z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }) }),
    async (req, res) => {
      res.set("Cache-Control", "no-store");
      res.json({ data: await dispatch.calendar(req.valid.query.month) });
    },
  );

  router.get(
    "/dispatch/staff",
    requirePermission(P.DELIVERIES_READ),
    validate({ query: z.object({ date: z.iso.date() }) }),
    async (req, res) => {
      res.set("Cache-Control", "no-store");
      const [staff, meId] = await Promise.all([dispatch.staffBoard(req.valid.query.date), dispatch.myStaffId(req.auth)]);
      res.json({ data: { staff, meId } });
    },
  );

  router.post(
    "/bookings/:id/driver",
    requirePermission(P.DELIVERIES_ASSIGN),
    validate({ params: idParam, body: z.object({ staffId: z.uuid() }) }),
    async (req, res) => {
      res.json({ data: await dispatch.assignDriver(req.auth, req.valid.params.id, req.valid.body.staffId, auditContext(req)) });
    },
  );

  router.post(
    "/bookings/:id/accept",
    requireAnyPermission(P.DELIVERIES_UPDATE, P.DELIVERIES_ASSIGN),
    validate({ params: idParam, body: z.object({ location: position.optional() }) }),
    async (req, res) => {
      const data = await dispatch.acceptJob(req.auth, req.valid.params.id, auditContext(req));
      await withPosition(req.auth, req.valid.body.location);
      res.json({ data });
    },
  );

  router.put(
    "/staff/me/location",
    requireAnyPermission(P.DELIVERIES_UPDATE, P.DELIVERIES_READ),
    validate({ body: position }),
    async (req, res) => {
      res.json({ data: await dispatch.updateMyLocation(req.auth, req.valid.body) });
    },
  );

  router.post(
    "/bookings/:id/arrived",
    requireAnyPermission(P.DELIVERIES_UPDATE, P.DELIVERIES_ASSIGN),
    validate({ params: idParam, body: z.object({ location: position.optional() }) }),
    async (req, res) => {
      await withPosition(req.auth, req.valid.body.location);
      res.json({ data: await dispatch.markArrived(req.auth, req.valid.params.id, auditContext(req)) });
    },
  );

  // ---- booking on a customer's behalf (phone / LINE chat / walk-in), paid outside the system
  router.post(
    "/bookings",
    requirePermission(P.BOOKINGS_WRITE, P.USERS_READ_SENSITIVE),
    validate({ body: staffBookingSchema }),
    async (req, res) => {
      res.status(201).json({ data: await bookings.createStaffBooking(req.auth, req.valid.body, auditContext(req)) });
    },
  );
  router.post(
    "/bookings/:number/confirm-offline",
    requirePermission(P.BOOKINGS_WRITE, P.USERS_READ_SENSITIVE, P.PAYMENTS_READ),
    validate({ params: numberParam, body: offlineConfirmSchema }),
    async (req, res) => {
      res.json({ data: await bookings.confirmOffline(req.auth, req.valid.params.number, req.valid.body, auditContext(req)) });
    },
  );
  // At hand-over: a Stripe link (and its QR) the customer pays the rent balance + deposit with on their phone.
  router.post(
    "/bookings/:number/balance-link",
    requirePermission(P.BOOKINGS_WRITE, P.PAYMENTS_READ),
    validate({ params: numberParam }),
    async (req, res) => {
      const link = await bookings.startBalanceCheckout(req.auth, req.valid.params.number, { locale: "th", byStaff: true }, auditContext(req));
      res.json({ data: { ...link, qr: await QRCode.toDataURL(link.url, { margin: 1, width: 320 }) } });
    },
  );

  // ---- back-office accounts (super admin only): sub-admins with a username, password and chosen pages
  const pagesField = z.array(z.enum(PAGE_KEYS)).max(PAGE_KEYS.length);
  const googleEmailField = z.email("อีเมลไม่ถูกต้อง").trim().toLowerCase().max(254);
  // who gets the new-booking e-mail (customer details + ID photos)
  router.get("/notify-emails", requirePermission(P.ROLES_MANAGE), async (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ data: await staffEmail.staffEmailSettings() });
  });
  router.put(
    "/notify-emails",
    requirePermission(P.ROLES_MANAGE),
    validate({ body: z.object({ muted: z.array(z.uuid()).max(200), extra: z.array(googleEmailField).max(20) }) }),
    async (req, res) => {
      res.json({ data: await staffEmail.saveStaffEmailSettings(req.auth, req.valid.body, auditContext(req)) });
    },
  );
  router.get("/accounts", requirePermission(P.ROLES_MANAGE), async (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ data: await accounts.listAccounts() });
  });
  router.post(
    "/accounts",
    requirePermission(P.ROLES_MANAGE),
    validate({
      body: z.object({
        fullName: z.string().trim().min(2).max(120),
        login: z.string().trim().min(3).max(60).regex(/^[A-Za-z0-9._@-]+$/, "ใช้ตัวอักษรอังกฤษ ตัวเลข . _ - @").optional(),
        password: z.string().min(8).max(200).optional(),
        email: googleEmailField.optional(), // sign in with this Google account (Gmail)
        phone: z.string().trim().regex(/^\+?[0-9 ()-]{6,20}$/).optional(),
        pages: pagesField,
      }).refine((b) => b.email || (b.login && b.password), { message: "ใส่ Gmail หรือชื่อผู้ใช้ + รหัสผ่าน อย่างน้อยหนึ่งอย่าง", path: ["email"] })
        .refine((b) => !b.login === !b.password, { message: "ชื่อผู้ใช้และรหัสผ่านต้องใส่คู่กัน", path: ["password"] }),
    }),
    async (req, res) => {
      res.status(201).json({ data: await accounts.createAccount(req.auth, req.valid.body, auditContext(req)) });
    },
  );
  router.patch(
    "/accounts/:id",
    requirePermission(P.ROLES_MANAGE),
    validate({
      params: idParam,
      body: z.object({
        fullName: z.string().trim().min(2).max(120).optional(),
        phone: z.string().trim().regex(/^\+?[0-9 ()-]{6,20}$/).optional(),
        email: googleEmailField.optional(),
        pages: pagesField.optional(),
        password: z.string().min(8).max(200).optional(),
        active: z.boolean().optional(),
      }),
    }),
    async (req, res) => {
      res.json({ data: await accounts.updateAccount(req.auth, req.valid.params.id, req.valid.body, auditContext(req)) });
    },
  );

  // ---- operations board: money at hand-over, deposit back, odometer, contract to the customer
  const baht = z.number().int().min(0).max(100_000_000);
  router.get("/bookings/:id/ledger", requirePermission(P.PAYMENTS_READ), validate({ params: idParam }), async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ data: await fleetops.ledger(req.valid.params.id) });
  });
  router.post(
    "/bookings/:id/collect",
    requirePermission(P.BOOKINGS_WRITE, P.PAYMENTS_READ),
    validate({ params: idParam, body: z.object({ method: z.enum(["cash", "transfer", "card"]), rentMinor: baht.optional(), depositMinor: baht.optional() }) }),
    async (req, res) => {
      res.json({ data: await fleetops.collectPayment(req.auth, req.valid.params.id, req.valid.body, auditContext(req)) });
    },
  );
  router.post(
    "/bookings/:id/deposit-return",
    requirePermission(P.PAYMENTS_REFUND),
    validate({ params: idParam, body: z.object({ refundMinor: baht, note: z.string().trim().min(2).max(500).optional() }) }),
    async (req, res) => {
      res.json({ data: await fleetops.returnDeposit(req.auth, req.valid.params.id, req.valid.body, auditContext(req)) });
    },
  );
  router.post(
    "/bookings/:id/mileage",
    requireAnyPermission(P.BOOKINGS_WRITE, P.DELIVERIES_UPDATE),
    validate({ params: idParam, body: z.object({ kind: z.enum(["PICKUP", "RETURN"]), km: z.number().int().min(0).max(2_000_000) }) }),
    async (req, res) => {
      res.json({ data: await fleetops.recordMileage(req.auth, req.valid.params.id, req.valid.body, auditContext(req)) });
    },
  );
  router.post(
    "/bookings/:id/send-contract",
    requirePermission(P.CONTRACTS_READ, P.BOOKINGS_WRITE),
    validate({ params: idParam, body: z.object({ via: z.enum(["line", "email"]), email: z.email().max(254).optional() }) }),
    async (req, res) => {
      res.json({ data: await fleetops.sendContract(req.auth, req.valid.params.id, req.valid.body, auditContext(req)) });
    },
  );

  // ---- booking slip (ใบจอง) and receipts (ใบเสร็จรับเงิน): preview, PDF, sign, send
  const docQuery = z.object({ kind: z.enum(["booking", "receipt"]), receipt: z.uuid().optional() })
    .refine((q) => q.kind === "booking" || q.receipt, "receipt id required");
  router.get("/bookings/:id/documents", requirePermission(P.CONTRACTS_READ), validate({ params: idParam }), async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ data: await documents.listDocuments(req.valid.params.id) });
  });
  router.get("/bookings/:id/documents/view", requirePermission(P.CONTRACTS_READ), validate({ params: idParam, query: docQuery }), async (req, res) => {
    const doc = await documents.documentHtml(req.valid.params.id, req.valid.query.kind, req.valid.query.receipt);
    res.set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" });
    res.send(doc.html);
  });
  router.get("/bookings/:id/documents/pdf", requirePermission(P.CONTRACTS_READ), validate({ params: idParam, query: docQuery }), async (req, res) => {
    const { body, filename } = await documents.documentPdf(req.valid.params.id, req.valid.query.kind, req.valid.query.receipt);
    res.set({
      "Content-Type": "application/pdf", "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    });
    res.send(body);
  });
  router.post(
    "/bookings/:id/documents/sign",
    requirePermission(P.CONTRACTS_READ, P.BOOKINGS_WRITE),
    validate({
      params: idParam,
      body: z.object({
        kind: z.enum(["booking", "receipt"]), receiptId: z.uuid().optional(), party: z.enum(["SHOP", "CUSTOMER"]),
        signature: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/).max(400_000),
      }),
    }),
    async (req, res) => {
      await documents.signDocument(req.auth, req.valid.params.id, req.valid.body, auditContext(req));
      res.status(204).end();
    },
  );
  router.post(
    "/bookings/:id/documents/send",
    requirePermission(P.CONTRACTS_READ, P.BOOKINGS_WRITE),
    validate({
      params: idParam,
      body: z.object({ kind: z.enum(["booking", "receipt"]), receiptId: z.uuid().optional(), via: z.enum(["line", "email"]), email: z.email().max(254).optional() }),
    }),
    async (req, res) => {
      res.json({ data: await documents.sendDocument(req.auth, req.valid.params.id, req.valid.body, auditContext(req)) });
    },
  );

  // ---- booking timeline (cars × days)
  router.get(
    "/schedule",
    requirePermission(P.BOOKINGS_READ),
    validate({ query: range.refine((r) => r.from <= r.to && (new Date(r.to) - new Date(r.from)) / 86_400_000 <= 120, "Up to 120 days") }),
    async (req, res) => {
      res.set("Cache-Control", "no-store");
      res.json({ data: await fleetops.schedule(req.valid.query.from, req.valid.query.to) });
    },
  );

  // ---- service & document reminders
  router.get("/fleet/reminders", requirePermission(P.MAINTENANCE_READ), async (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ data: await fleetops.reminders() });
  });
  router.post(
    "/fleet/plans/:id/complete",
    requirePermission(P.MAINTENANCE_WRITE),
    validate({ params: idParam, body: z.object({ km: z.number().int().min(0).max(2_000_000).optional(), note: z.string().trim().max(500).optional(), costMinor: baht.optional() }) }),
    async (req, res) => {
      await fleetops.completeService(req.auth, req.valid.params.id, req.valid.body, auditContext(req));
      res.status(204).end();
    },
  );
  router.patch(
    "/fleet/plans/:id",
    requirePermission(P.MAINTENANCE_WRITE),
    validate({ params: idParam, body: z.object({ intervalKm: z.number().int().min(100).max(200_000).nullable(), intervalDays: z.number().int().min(1).max(3650).nullable() }) }),
    async (req, res) => {
      await fleetops.updatePlan(req.auth, req.valid.params.id, req.valid.body, auditContext(req));
      res.status(204).end();
    },
  );
  router.post(
    "/vehicles/:id/documents",
    requirePermission(P.MAINTENANCE_WRITE),
    validate({
      params: idParam,
      body: z.object({
        type: z.enum(["COMPULSORY_INSURANCE", "ROAD_TAX", "INSURANCE", "LEASE_CONTRACT", "REGISTRATION", "INSPECTION", "OTHER"]),
        title: z.string().trim().max(120).optional(),
        reference: z.string().trim().max(120).optional(),
        expiresOn: z.iso.date(),
        notes: z.string().trim().max(1000).optional(),
        replaces: z.uuid().optional(),
      }),
    }),
    async (req, res) => {
      res.status(201).json({ data: await fleetops.saveDocument(req.auth, req.valid.params.id, req.valid.body, auditContext(req)) });
    },
  );
  router.delete("/fleet/documents/:id", requirePermission(P.MAINTENANCE_WRITE), validate({ params: idParam }), async (req, res) => {
    await fleetops.removeDocument(req.auth, req.valid.params.id, auditContext(req));
    res.status(204).end();
  });

  // ---- LINE bookings: staff check details + documents before the reservation fee is paid
  router.get("/approvals", requirePermission(P.BOOKINGS_READ, P.USERS_READ_SENSITIVE), async (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ data: await review.listApprovals() });
  });
  router.post(
    "/bookings/:id/review",
    requirePermission(P.BOOKINGS_WRITE, P.USERS_READ_SENSITIVE),
    validate({
      params: idParam,
      body: z.object({ decision: z.enum(["approve", "request_changes"]), note: z.string().trim().min(2).max(500).optional() }),
    }),
    async (req, res) => {
      res.json({ data: await review.decide(req.auth, req.valid.params.id, req.valid.body, auditContext(req)) });
    },
  );

  // ---- PromptPay slips the bank check could not settle
  router.get(
    "/slips",
    requirePermission(P.PAYMENTS_READ),
    validate({ query: z.object({ status: z.enum(["NEEDS_REVIEW", "VERIFIED", "REJECTED"]).optional() }) }),
    async (req, res) => {
      res.set("Cache-Control", "no-store");
      res.json({ data: await slips.listSlips(req.valid.query.status) });
    },
  );
  router.get("/slips/:id/image", requirePermission(P.PAYMENTS_READ), validate({ params: idParam }), async (req, res) => {
    const file = await slips.readSlipImage(req.valid.params.id);
    res.set({
      "Content-Type": file.contentType,
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "Content-Disposition": "inline",
    });
    res.send(file.body);
  });
  router.post(
    "/slips/:id/review",
    requirePermission(P.PAYMENTS_READ, P.BOOKINGS_WRITE),
    validate({
      params: idParam,
      body: z.object({
        decision: z.enum(["approve", "reject"]),
        reason: z.string().trim().min(2).max(300).optional(),
        transRef: z.string().trim().min(6).max(64).regex(/^[A-Za-z0-9]+$/).optional(),
      }),
    }),
    async (req, res) => {
      res.json({ data: await slips.reviewSlip(req.auth, req.valid.params.id, req.valid.body, auditContext(req)) });
    },
  );

  router.get("/bookings/:id/contract-print", requirePermission(P.CONTRACTS_READ), validate({ params: idParam }), async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ data: await dispatch.contractPrint(req.valid.params.id) });
  });

  // ---- fleet
  router.get("/vehicles/meta", requirePermission(P.VEHICLES_READ), async (_req, res) => {
    res.json({ data: await vehicles.meta() });
  });
  router.get("/vehicles", requirePermission(P.VEHICLES_READ), async (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ data: await vehicles.list() });
  });
  router.get("/vehicles/:id", requirePermission(P.VEHICLES_READ), validate({ params: idParam }), async (req, res) => {
    res.json({ data: await vehicles.get(req.valid.params.id) });
  });
  router.post("/vehicles", requirePermission(P.VEHICLES_WRITE), validate({ body: vehicleBase }), async (req, res) => {
    res.status(201).json({ data: await vehicles.create(req.auth, req.valid.body, auditContext(req)) });
  });
  router.patch(
    "/vehicles/:id",
    requirePermission(P.VEHICLES_WRITE),
    validate({ params: idParam, body: vehicleBase.partial().refine((v) => Object.keys(v).length > 0, "Nothing to update") }),
    async (req, res) => {
      res.json({ data: await vehicles.update(req.auth, req.valid.params.id, req.valid.body, auditContext(req)) });
    },
  );
  router.post("/vehicles/:id/archive", requirePermission(P.VEHICLES_ARCHIVE), validate({ params: idParam }), async (req, res) => {
    res.json({ data: await vehicles.archive(req.auth, req.valid.params.id, auditContext(req)) });
  });

  // ---- uploads: raw image body (Content-Type image/jpeg|png|webp), content-addressed file name
  router.post(
    "/uploads",
    requirePermission(P.VEHICLES_WRITE),
    express.raw({ type: Object.keys(IMAGE_TYPES), limit: "8mb" }),
    async (req, res) => {
      const buf = req.body;
      const ext = imageExtension(req.get("content-type"), buf);
      if (!ext) {
        throw BadRequest("Upload a JPEG, PNG or WebP image (max 8 MB)");
      }
      const name = `${createHash("sha256").update(buf).digest("hex").slice(0, 32)}.${ext}`;
      await storage.put("public", `vehicles/${name}`, buf, req.get("content-type").split(";")[0]);
      res.status(201).json({ data: { url: `/uploads/vehicles/${name}`, bytes: buf.length } });
    },
  );

  return router;
}
