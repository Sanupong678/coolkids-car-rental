import { AppError } from "../../shared/errors.js";
import { decryptPII, sha256 } from "../../shared/crypto.js";
import * as storage from "../../shared/storage.js";
import { renderTemplate } from "./render.js";
import { TEMPLATE } from "./coolkids-rental.template.js";

// Rental contracts: built from the published template + a frozen data snapshot.
// Only the SHA-256 of the rendered HTML is stored (tamper evidence); the HTML is
// re-rendered on demand from snapshot + template version, so it is reproducible.

const TZ = "Asia/Bangkok";

const FUEL = { PETROL: "เบนซิน / Gasoline", DIESEL: "ดีเซล / Diesel", HYBRID: "ไฮบริด / Hybrid", PLUG_IN_HYBRID: "ปลั๊กอินไฮบริด / PHEV", ELECTRIC: "ไฟฟ้า / EV" };

export const fmtDateTime = (d) =>
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
    money: snapshotMoney(money),
    declarations: { hasOriginalLicense: "ใช่ / Yes", infoMatchesLicense: "ใช่ / Yes" },
    signature: { dataUrl: null, signedAt: null },
  };
}

/** The contract's money boxes. `discount` covers promotions and staff discounts alike. */
export const snapshotMoney = (money) => ({
  rental: baht(money.rental),
  deposit: baht(money.deposit),
  // the contract's one box covers both trips: delivering the car and collecting it
  delivery: baht(money.delivery + (money.returnPickup ?? 0)),
  discount: money.discount ? `−${baht(money.discount)}` : "—",
  paidOnline: baht(money.dueNow ?? money.total),
  totalPayable: baht(money.total + money.deposit),
});

/**
 * Staff changed a booking's details or price: the live contract is superseded by a new one
 * (new number, unsigned: a signed one has to be signed again). `makeSnapshot(old)` gives the
 * new merge data from the old snapshot.
 */
export async function reissueContract(db, { bookingId, userId }, makeSnapshot) {
  const { rows } = await db.query(
    "SELECT id, data_snapshot FROM contracts WHERE booking_id = $1 AND status IN ('ISSUED','SIGNED') FOR UPDATE",
    [bookingId],
  );
  const old = rows[0];
  const contractNumber = await nextContractNumber(db);
  const snapshot = {
    // the rental round it covers (2, 3, … after "ใช้งานต่อ") carries over to re-issues
    ...(old?.data_snapshot?.round ? { round: old.data_snapshot.round } : {}),
    ...makeSnapshot(old?.data_snapshot ?? null),
    contract: { number: contractNumber, issuedDate: fmtDate(new Date()) },
    signature: { dataUrl: null, signedAt: null },
  };
  if (old) await db.query("UPDATE contracts SET status = 'SUPERSEDED' WHERE id = $1", [old.id]);
  const made = await issueContract(db, { bookingId, userId, contractNumber, snapshot });
  if (old) await db.query("UPDATE contracts SET supersedes_contract_id = $2 WHERE id = $1", [made.id, old.id]);
  return made;
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

/**
 * The renter's full ID / passport and licence numbers for a booking, decrypted from
 * its identity record. The shop wants them in full on the contract (owner decision
 * 2026-10-26), but the stored snapshot keeps them masked, so they are only ever
 * filled in at display / print time. null when they cannot be read.
 */
export async function fullDocumentNumbers(db, bookingId) {
  const { rows } = await db.query(
    `SELECT ci.id_document_number_enc, ci.license_number_enc
       FROM bookings b JOIN customer_identities ci ON ci.id = b.customer_identity_id WHERE b.id = $1`,
    [bookingId],
  );
  if (!rows[0]) return null;
  try {
    return { idDoc: decryptPII(rows[0].id_document_number_enc), license: decryptPII(rows[0].license_number_enc) };
  } catch {
    return null; // e.g. encrypted under a retired key: the masked numbers stay
  }
}

/** Rendered contract HTML for display, with the stored signature image and the full document numbers inlined. */
export async function renderContract(db, contract) {
  const { rows } = await db.query("SELECT body FROM contract_templates WHERE id = $1", [contract.template_id]);
  const snapshot = structuredClone(contract.data_snapshot);
  if (contract.signature_media_id) snapshot.signature.dataUrl = await signatureDataUrl(db, contract.signature_media_id);
  const full = contract.booking_id ? await fullDocumentNumbers(db, contract.booking_id) : null;
  if (full && snapshot.renter) {
    snapshot.renter.idDocMasked = full.idDoc;
    snapshot.renter.licenseMasked = full.license;
  }
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
