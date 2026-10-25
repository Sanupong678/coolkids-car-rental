import { z } from "zod";

// "a,b,c" → ["a","b","c"]; also accepts repeated params (?x=a&x=b).
const list = (item) =>
  z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : v.split(",")).map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(item).max(20))
    .optional();

export const SORTS = ["recommended", "price_asc", "price_desc", "newest", "power_desc"];

export const vehicleListQuery = z
  .object({
    category: list(z.string().regex(/^[a-z0-9-]+$/)),
    brand: list(z.string().max(40)),
    transmission: list(z.enum(["AUTOMATIC", "MANUAL"])),
    fuel: list(z.enum(["PETROL", "DIESEL", "HYBRID", "PLUG_IN_HYBRID", "ELECTRIC"])),
    drive: list(z.enum(["FWD", "RWD", "AWD", "4WD"])),
    seats: z.coerce.number().int().min(1).max(20).optional(), // minimum seats
    yearMin: z.coerce.number().int().min(1950).max(2100).optional(),
    priceMin: z.coerce.number().int().min(0).optional(), // daily rate, minor units
    priceMax: z.coerce.number().int().min(0).optional(),
    // Stackable price buckets "min-max" / "min-" (open-ended), OR-ed together.
    price: list(z.string().regex(/^\d{1,9}-\d{0,9}$/)),
    q: z.string().trim().max(60).optional(),
    from: z.iso.datetime({ offset: true }).optional(), // only vehicles free for [from, to)
    to: z.iso.datetime({ offset: true }).optional(),
    featured: z.stringbool().optional(),
    sort: z.enum(SORTS).default("recommended"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(48).default(12),
  })
  .refine((q) => !q.from === !q.to, { message: "from and to must be given together", path: ["to"] })
  .refine((q) => !q.from || !q.to || new Date(q.to) > new Date(q.from), { message: "to must be after from", path: ["to"] });

export const availabilityQuery = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
  })
  .refine((q) => q.to >= q.from, { message: "to must not be before from", path: ["to"] })
  .refine((q) => (new Date(q.to) - new Date(q.from)) / 86_400_000 <= 120, { message: "Range is limited to 120 days", path: ["to"] });
