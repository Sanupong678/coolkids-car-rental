import { AppError } from "../../shared/errors.js";
import { sha256 } from "../../shared/crypto.js";
import * as storage from "../../shared/storage.js";
import { renderTemplate } from "./render.js";
import { TEMPLATE } from "./coolkids-rental.template.js";

// Rental contracts: built from the published template + a frozen data snapshot.
// Only the SHA-256 of the rendered HTML is stored (tamper evidence); the HTML is
// re-rendered on demand from snapshot + template version, so it is reproducible.

const TZ = "Asia/Bangkok";

const FUEL = { PETROL: "เบนซิน / Gasoline", DIESEL: "ดีเซล / Diesel", HYBRID: "ไฮบริด / Hybrid", PLUG_IN_HYBRID: "ปลั๊กอินไฮบริด / PHEV", ELECTRIC: "ไฟฟ้า / EV" };

const fmtDateTime = (d) =>
  new Intl.DateTimeFormat("th-TH", { timeZone: TZ, day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })
    .format(new Date(d))
    .replace(" เวลา ", " @ ");
const fmtDate = (d) => new Intl.DateTimeFormat("th-TH", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" }).format(new Date(d));
const baht = (minor) => `${new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 }).format(minor / 100)} บาท/THB`;
const mask = (value) => {
  const v = String(value).replace(/\s/g, "");
  return v.length <= 4 ? v : `${"•".repeat(Math.min(v.length - 4, 9))}${v.slice(-4)}`;
};

export async function publishedTemplate(db) {
  const { rows } = await db.query(
    `SELECT id, code, version, body FROM contract_templates
      WHERE code = $1 AND locale = $2 AND status = 'PUBLISHED' ORDER BY version DESC LIMIT 1`,
    [TEMPLATE.code, TEMPLATE.locale],
  );
  if (!rows[0]) throw new AppError(500, "CONTRACT_TEMPLATE_MISSING", "Contract template is not published (run npm run db:seed:coolkids)");
  return rows[0];
}

/** Frozen merge data. Document numbers are masked: the snapshot never holds them in clear. */
export function buildSnapshot({ company, contractNumber, issuedAt, customer, vehicle, booking, money, delivery, returnPlace = null }) {
  return {
    company,
    contract: { number: contractNumber, issuedDate: fmtDate(issuedAt) },
    renter: {
      fullName: customer.fullName,
      address: customer.address,
      phone: customer.phone,
      email: customer.email,
      nationality: customer.countryCode,
      idDocLabel: customer.idType === "PASSPORT" ? "เลขหนังสือเดินทาง / Passport No." : "เลขประจำตัวประชาชน / ID Card Number",
      idDocMasked: mask(customer.idNumber),
      licenseMasked: mask(customer.licenseNumber),
    },
    vehicle: {
      make: vehicle.brand.toUpperCase(),
      model: [vehicle.model, vehicle.trim].filter(Boolean).join(" ").toUpperCase(),
      plate: vehicle.license_plate,
      fuel: FUEL[vehicle.fuel_type] ?? vehicle.fuel_type,
      // Which fuel box is ticked on the v3 contract.
      gasohol: ["PETROL", "HYBRID", "PLUG_IN_HYBRID"].includes(vehicle.fuel_type),
      diesel: vehicle.fuel_type === "DIESEL",
    },
    rental: {
      pickupAt: fmtDateTime(booking.pickupAt),
      returnAt: fmtDateTime(booking.returnAt),
      days: booking.rentalDays,
      area: booking.areaOfUse ?? (delivery?.address ? `${delivery.address} (ส่งรถถึงที่ / Delivery)` : `${vehicle.location_name}, ${vehicle.location_city}`),
      purpose: booking.purpose ?? null,
      returnPlace: returnPlace?.address ? `${returnPlace.address} (รับรถคืนถึงที่ / Collected)` : `${vehicle.location_name}`,
      executedAt: `${vehicle.location_name} (ทำสัญญาออนไลน์ / signed online)`,
    },
    money: {
      rental: baht(money.rental),
      deposit: baht(money.deposit),
      // the contract's one box covers both trips: delivering the car and collecting it
      delivery: baht(money.delivery + (money.returnPickup ?? 0)),
      discount: money.discount ? `−${baht(money.discount)}` : "—",
      paidOnline: baht(money.dueNow ?? money.total),
      totalPayable: baht(money.total + money.deposit),
    },
    declarations: { hasOriginalLicense: "ใช่ / Yes", infoMatchesLicense: "ใช่ / Yes" },
    signature: { dataUrl: null, signedAt: null },
  };
}

/** Reserves the contract number up front: it is printed inside the snapshot. */
export async function nextContractNumber(db) {
  const { rows } = await db.query(
    "SELECT 'RC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('contract_number_seq')::text, 6, '0') AS n",
  );
  return rows[0].n;
}

export async function issueContract(db, { bookingId, userId, contractNumber, snapshot }) {
  const template = await publishedTemplate(db);
  const { rows } = await db.query(
    `INSERT INTO contracts (contract_number, booking_id, user_id, template_id, data_snapshot, rendered_html_sha256, generated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $3) RETURNING id, contract_number`,
    [contractNumber, bookingId, userId, template.id, JSON.stringify(snapshot), sha256(renderTemplate(template.body, snapshot))],
  );
  return rows[0];
}

/** The renter's drawn signature (a private media row) as a data URL; null when missing. */
export async function signatureDataUrl(db, mediaId) {
  if (!mediaId) return null;
  const { rows } = await db.query("SELECT storage_provider, storage_key FROM media WHERE id = $1 AND deleted_at IS NULL", [mediaId]);
  if (!rows[0]) return null;
  const file = await storage.get("private", rows[0].storage_key, rows[0].storage_provider);
  return file ? `data:image/png;base64,${file.body.toString("base64")}` : null;
}

/** Rendered contract HTML for display, with the stored signature image inlined. */
export async function renderContract(db, contract) {
  const { rows } = await db.query("SELECT body FROM contract_templates WHERE id = $1", [contract.template_id]);
  const snapshot = structuredClone(contract.data_snapshot);
  if (contract.signature_media_id) snapshot.signature.dataUrl = await signatureDataUrl(db, contract.signature_media_id);
  return renderTemplate(rows[0].body, snapshot);
}

/** Click-wrap consent + drawn signature. The PNG is kept in private storage, never in a public URL. */
export async function signContract(db, contract, { signaturePng, ip, userAgent, userId }) {
  const key = `signatures/${contract.id}.png`;
  const provider = await storage.put("private", key, signaturePng, "image/png");
  const { rows: media } = await db.query(
    `INSERT INTO media (media_type, storage_provider, storage_key, mime_type, file_size_bytes, checksum_sha256, is_private, uploaded_by)
     VALUES ('IMAGE', $5, $1, 'image/png', $2, $3, true, $4) RETURNING id`,
    [key, signaturePng.length, sha256(signaturePng), userId, provider],
  );
  const signedAt = new Date();
  const snapshot = { ...contract.data_snapshot, signature: { dataUrl: null, signedAt: fmtDateTime(signedAt) } };
  const { rows } = await db.query("SELECT body FROM contract_templates WHERE id = $1", [contract.template_id]);
  const html = renderTemplate(rows[0].body, {
    ...snapshot,
    signature: { ...snapshot.signature, dataUrl: `data:image/png;base64,${signaturePng.toString("base64")}` },
  });
  await db.query(
    `UPDATE contracts SET status = 'SIGNED', signed_at = $2, signature_method = 'DRAWN', signature_media_id = $3,
            signer_ip = $4, signer_user_agent = $5, data_snapshot = $6, rendered_html_sha256 = $7
      WHERE id = $1`,
    [contract.id, signedAt, media[0].id, ip ?? null, userAgent?.slice(0, 500) ?? null, JSON.stringify(snapshot), sha256(html)],
  );
}
