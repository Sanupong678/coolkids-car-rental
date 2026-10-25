import { z } from "zod";

const country = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use a 2-letter country code");
const isoDate = z.iso.date();

export const deliveryInput = z
  .object({
    address: z.string().trim().min(3).max(300).optional(),
    placeId: z.string().trim().max(300).optional(),
    sessionToken: z.string().trim().max(100).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    notes: z.string().trim().max(300).optional(),
  })
  .refine((d) => d.placeId || d.address || (d.lat != null && d.lng != null), { message: "Address required", path: ["address"] });

export const createBookingSchema = z
  .object({
    vehicleSlug: z.string().regex(/^[a-z0-9-]+$/).max(120),
    pickupAt: z.iso.datetime({ offset: true }),
    returnAt: z.iso.datetime({ offset: true }),
    fulfillment: z.enum(["BRANCH_PICKUP", "DELIVERY"]),
    delivery: deliveryInput.optional(),
    notes: z.string().trim().max(500).optional(),
    // LINE flow extras (old chat form): where the car is used, where the renter stays, their Facebook / IG.
    areaOfUse: z.string().trim().min(2).max(120).optional(),
    stayLocation: z.string().trim().min(3).max(300).optional(),
    socialUrl: z.string().trim().max(300).regex(/^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/\S*)?$|^@?[\w.]{2,60}$/i, "ใส่ลิงก์ Facebook / IG หรือชื่อบัญชี").optional(),
    rentalPurpose: z.enum(["TRAVEL", "REPLACEMENT"]).optional(),
    // Language the renter read and acknowledged the rental terms in (popup before booking).
    termsLocale: z.enum(["th", "en", "zh"]).optional(),
    // Where to e-mail the contract (LINE sign-ins have no real e-mail).
    contactEmail: z.email().max(254).optional(),
    customer: z.object({
      fullName: z.string().trim().min(2).max(120),
      phone: z.string().trim().regex(/^\+?[0-9 ()-]{6,20}$/, "Invalid phone number"),
      countryCode: country,
      idType: z.enum(["NATIONAL_ID", "PASSPORT"]),
      idNumber: z.string().trim().min(5).max(30).regex(/^[A-Za-z0-9 -]+$/, "Letters and numbers only"),
      dateOfBirth: isoDate,
      licenseNumber: z.string().trim().min(4).max(30).regex(/^[A-Za-z0-9 -]+$/, "Letters and numbers only"),
      licenseCountry: country,
      licenseExpiry: isoDate,
      address: z.string().trim().min(5).max(300),
    }),
    // Both must be "yes" for insurance to apply (contract page 1).
    declarations: z.object({ hasOriginalLicense: z.literal(true), infoMatchesLicense: z.literal(true) }),
  })
  .refine((b) => b.fulfillment !== "DELIVERY" || b.delivery, { message: "Delivery address required", path: ["delivery"] })
  .refine((b) => b.customer.idType !== "NATIONAL_ID" || b.customer.countryCode !== "TH" || /^\d{13}$/.test(b.customer.idNumber.replace(/[ -]/g, "")), {
    message: "Thai ID card number must be 13 digits",
    path: ["customer", "idNumber"],
  });

export const signSchema = z.object({
  accepted: z.literal(true),
  signature: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/).max(400_000),
});

export const checkoutSchema = z.object({ locale: z.enum(["th", "en", "zh"]).default("th") });
export const verifySchema = z.object({ sessionId: z.string().min(5).max(255) });
// COOL-YYMMDD-NNN (bookings made before migration 0017: BK-YYYY-NNNNNN).
export const numberParam = z.object({ number: z.string().regex(/^(COOL-\d{6}-\d{3,5}|BK-\d{4}-\d{6})$/) });
export const paymentParam = z.object({ id: z.uuid() });
