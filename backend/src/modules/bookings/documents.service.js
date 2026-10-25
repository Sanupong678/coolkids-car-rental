import { config } from "../../config/env.js";
import { pool, withTransaction } from "../../db/pool.js";
import { decryptPII, sha256 } from "../../shared/crypto.js";
import { AppError, BadRequest, Conflict, NotFound } from "../../shared/errors.js";
import { sendMail } from "../../shared/mailer.js";
import { getSettings } from "../../shared/settings.js";
import * as storage from "../../shared/storage.js";
import { recordAudit } from "../audit/audit.service.js";
import { signatureDataUrl } from "../contracts/contracts.service.js";
import { escapeHtml as e } from "../contracts/render.js";
import { renderHtmlPdf } from "../contracts/pdf.js";
import { BOOKING_SELECT, notify } from "./bookings.service.js";

// The booking slip (ใบจอง) and receipts (ใบเสร็จรับเงิน) of a booking.
// One HTML page per document, built here from the booking's real data, is
// what staff preview, print, sign, download as PDF and send to the customer.
// Every captured payment gets exactly one receipt (RE + YYMMDD + -NNN).

const TZ = "Asia/Bangkok";
const thb = (minor) => `฿${new Intl.NumberFormat("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(minor) / 100)}`;
const day = (d) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(d));
const dayTime = (d) => `${day(d)} ${new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(d))}`;

/** Every captured payment of the booking gets its receipt (idempotent). */
async function ensureReceipts(db, bookingId) {
  await db.query(
    `INSERT INTO receipts (booking_id, payment_id, amount_minor, currency, issued_at)
     SELECT p.booking_id, p.id, p.amount_minor, p.currency, p.succeeded_at
       FROM payments p
      WHERE p.booking_id = $1 AND p.succeeded_at IS NOT NULL AND p.status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED')
        AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.payment_id = p.id)
      ORDER BY p.succeeded_at`,
    [bookingId],
  );
}

async function load(db, bookingId) {
  const { rows } = await db.query(`${BOOKING_SELECT} WHERE b.id = $1 AND b.deleted_at IS NULL`, [bookingId]);
  const b = rows[0];
  if (!b) throw NotFound("Booking");
  let address = null;
  if (b.customer_identity_id) {
    const { rows: ci } = await db.query("SELECT address_enc FROM customer_identities WHERE id = $1", [b.customer_identity_id]);
    try {
      address = ci[0]?.address_enc ? JSON.parse(decryptPII(ci[0].address_enc)).line1 : null;
    } catch {
      address = null;
    }
  }
  const { rows: receipts } = await db.query(
    `SELECT r.*, p.purpose, p.provider, p.payment_method_type FROM receipts r JOIN payments p ON p.id = r.payment_id
      WHERE r.booking_id = $1 ORDER BY r.issued_at, r.receipt_number`,
    [bookingId],
  );
  const { rows: sigs } = await db.query("SELECT doc_kind, receipt_id, party, media_id, signed_at FROM document_signatures WHERE booking_id = $1", [bookingId]);
  return { b, address, receipts, sigs, company: (await getSettings(db))["company.legal"] ?? {} };
}

const PURPOSE = (r, b) =>
  r.purpose === "DEPOSIT" ? "เงินมัดจำ" : r.provider !== "counter" && b.amount_due_now_minor ? "เงินจอง" : "ค่าเช่า";
const METHOD = { promptpay: "โอนพร้อมเพย์", cash: "เงินสด", transfer: "โอนเงิน", card: "บัตร" };

export async function listDocuments(bookingId) {
  return withTransaction(async (db) => {
    await ensureReceipts(db, bookingId);
    const { b, receipts, sigs } = await load(db, bookingId);
    const signed = (kind, receiptId) =>
      Object.fromEntries(["SHOP", "CUSTOMER"].map((p) => [p.toLowerCase(), sigs.some((s) => s.doc_kind === kind && (s.receipt_id ?? null) === (receiptId ?? null) && s.party === p)]));
    return {
      booking: { number: b.booking_number, signed: signed("BOOKING") },
      receipts: receipts.map((r) => ({
        id: r.id, number: r.receipt_number, amountMinor: Number(r.amount_minor), currency: r.currency, issuedAt: r.issued_at,
        purpose: PURPOSE(r, b), signed: signed("RECEIPT", r.id),
      })),
    };
  });
}

// ---------------------------------------------------------------- HTML

const CSS = `
@page { size: A4; margin: 14mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "IBM Plex Sans Thai", "Inter", system-ui, sans-serif; color: #111; font-size: 12.5px; line-height: 1.5; background: #fff; }
.doc { max-width: 720px; margin: 0 auto; padding: 18px 8px; }
.head { text-align: center; }
.head img { width: 64px; height: 64px; object-fit: contain; border-radius: 10px; background: #2b2d3a; padding: 6px; }
.head h1 { margin: 8px 0 2px; font-size: 17px; }
.head p { margin: 0; color: #444; font-size: 11.5px; }
.head h2 { margin: 12px 0 2px; font-size: 16px; }
hr { border: 0; border-top: 1px solid #222; margin: 14px 0; }
.boxes { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.box { border: 1px solid #222; border-radius: 10px; padding: 10px 12px; font-size: 11.5px; }
.box b { display: block; margin-bottom: 4px; font-size: 12px; }
dl.rows { display: grid; grid-template-columns: 140px 1fr; gap: 6px 10px; margin: 16px 0 0; }
dl.rows dt { color: #333; } dl.rows dd { margin: 0; font-weight: 600; }
.money { display: grid; gap: 6px; }
.money div { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.money b { font-size: 13px; }
.paid { margin-left: 6px; padding: 1px 8px; border-radius: 999px; background: #dcf5e7; color: #1f7a4a; font-size: 10px; font-weight: 600; }
.note { color: #555; font-size: 10.5px; }
table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 11.5px; }
th, td { border: 1px solid #222; padding: 6px 8px; text-align: left; }
th { background: #f3f4f6; } td.num, th.num { text-align: right; }
.total { margin-top: 10px; text-align: right; font-size: 14px; font-weight: 700; }
.sign { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 70px; text-align: center; font-size: 11.5px; }
.sign .line { position: relative; border-top: 1px solid #222; padding-top: 4px; }
.sign img { position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); max-height: 56px; max-width: 80%; }
.sign small { display: block; color: #555; }
`;

function page(title, body) {
  return `<!doctype html><html lang="th"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'">
<title>${e(title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;600;700&family=Inter:wght@400;600;700&display=block">
<style>${CSS}</style></head><body><div class="doc">${body}</div></body></html>`;
}

function header(c, title, lines) {
  const logo = `${config.FRONTEND_URL.replace(/\/$/, "")}/brand/logo-dark.webp`;
  return `<div class="head">
  <img src="${e(logo)}" alt="">
  <h1>${e(c.nameTh ?? c.name ?? "")}</h1>
  <p>เลขผู้เสียภาษี: ${e(c.taxId ?? "-")}</p>
  <p>${e(c.address ?? "")}</p>
  <p>โทร: ${e(c.phone ?? "")} • LINE: @Coolkidscar</p>
  <h2>${e(title)}</h2>
  ${lines.map((l) => `<p>${e(l)}</p>`).join("")}
</div><hr>`;
}

function parties(c, d) {
  const b = d.b;
  return `<div class="boxes">
  <div class="box"><b>ข้อมูลร้าน</b>ชื่อ: ${e(c.nameTh ?? c.name)}<br>ที่อยู่: ${e(c.address)}<br>โทร: ${e(c.phone)}<br>เลขผู้เสียภาษี: ${e(c.taxId)}</div>
  <div class="box"><b>ข้อมูลลูกค้า</b>ชื่อ: ${e(b.legal_full_name ?? "-")}<br>ที่อยู่: ${e(d.address ?? "-")}<br>โทร: ${e(b.customer_phone ?? "-")}<br>เลขผู้เสียภาษี: -</div>
</div>`;
}

async function signatures(db, d, kind, receiptId, left, right) {
  const img = async (party) => {
    const s = d.sigs.find((x) => x.doc_kind === kind && (x.receipt_id ?? null) === (receiptId ?? null) && x.party === party);
    const url = s ? await signatureDataUrl(db, s.media_id) : null;
    return url ? `<img src="${url}" alt="">` : "";
  };
  return `<div class="sign">
  <div class="line">${await img("SHOP")}${e(left[0])}<small>${e(left[1])}</small></div>
  <div class="line">${await img("CUSTOMER")}${e(right[0])}<small>${e(right[1] ?? "")}</small></div>
</div>`;
}

const carName = (b) => [b.brand, b.model, b.trim].filter(Boolean).join(" ");

async function bookingSlipHtml(db, d) {
  const { b, company: c } = d;
  const fee = d.receipts.filter((r) => PURPOSE(r, b) === "เงินจอง").reduce((t, r) => t + Number(r.amount_minor), 0);
  const due = Number(b.amount_due_now_minor ?? 0);
  const place = b.fulfillment_type === "DELIVERY" ? `ส่งรถถึงที่: ${b.delivery_address?.address ?? ""}` : "รับด้วยตนเอง";
  return page(`ใบจอง ${b.booking_number}`, `
${header(c, "ใบจอง", [`เลขที่: ${b.booking_number}`, `วันที่: ${day(b.created_at)}`])}
${parties(c, d)}
<dl class="rows">
  <dt>รถ:</dt><dd>${e(carName(b))}</dd>
  <dt>ทะเบียน:</dt><dd>${e(b.license_plate)}</dd>
  <dt>วันรับรถ:</dt><dd>${e(dayTime(b.pickup_at))}</dd>
  <dt>วันคืนรถ:</dt><dd>${e(dayTime(b.return_at))}</dd>
  <dt>รูปแบบรับรถ:</dt><dd>${e(place)}</dd>
</dl>
<hr>
<div class="money">
  <div><span>ค่าเช่า (${b.rental_days} วัน${Number(b.pricing_snapshot?.delivery) ? " รวมค่าส่ง" : ""}):</span><b>${thb(b.total_minor)}</b></div>
  ${due || fee ? `<div><span>เงินจอง:</span><b>${thb(fee || due)}${fee ? '<span class="paid">ชำระแล้ว</span>' : ""}</b></div>` : ""}
  <div><span>ค่ามัดจำ:</span><b>${thb(b.deposit_minor)}</b></div>
  <p class="note">* ค่ามัดจำแสดงเพื่อแจ้งให้ทราบ ไม่นำมาคำนวณในใบจองนี้ · เงินจองนำไปหักค่าเช่าวันรับรถ</p>
</div>
${await signatures(db, d, "BOOKING", null, ["ผู้ให้บริการ", c.nameTh ?? c.name], ["ผู้จอง", b.legal_full_name])}`);
}

async function receiptHtml(db, d, r) {
  const { b, company: c } = d;
  const what = PURPOSE(r, b);
  return page(`ใบเสร็จรับเงิน ${r.receipt_number}`, `
${header(c, "ใบเสร็จรับเงิน", [`เลขที่: ${r.receipt_number}`, `เลขที่จอง: ${b.booking_number}`, `วันที่: ${dayTime(r.issued_at)}`])}
${parties(c, d)}
<table>
  <tr><th>รายการ</th><th>รถ</th><th>รายละเอียด</th><th class="num">จำนวนเงิน</th></tr>
  <tr><td>${e(what)}</td><td>${e(`${carName(b)} ${b.license_plate}`)}</td>
      <td>${e(`${what} ${thb(r.amount_minor)}${METHOD[r.payment_method_type] ? ` · ${METHOD[r.payment_method_type]}` : ""}`)}</td>
      <td class="num">${thb(r.amount_minor)}</td></tr>
</table>
<p class="total">รวมทั้งสิ้น: ${thb(r.amount_minor)}</p>
${await signatures(db, d, "RECEIPT", r.id, ["ผู้ให้บริการ", c.nameTh ?? c.name], ["ผู้ชำระเงิน", b.legal_full_name])}`);
}

/** { html, filename } of the slip (kind 'booking') or one receipt. */
export async function documentHtml(bookingId, kind, receiptId) {
  return withTransaction(async (db) => {
    await ensureReceipts(db, bookingId);
    const d = await load(db, bookingId);
    if (kind === "booking") return { html: await bookingSlipHtml(db, d), filename: `ใบจอง-${d.b.booking_number}.pdf`, d };
    const r = d.receipts.find((x) => x.id === receiptId);
    if (!r) throw NotFound("Receipt");
    return { html: await receiptHtml(db, d, r), filename: `ใบเสร็จ-${r.receipt_number}.pdf`, d, receipt: r };
  });
}

export async function documentPdf(bookingId, kind, receiptId) {
  const doc = await documentHtml(bookingId, kind, receiptId);
  return { body: await renderHtmlPdf(doc.html), filename: doc.filename, doc };
}

/** The slip for a booking row that is not in the database (scripts/mail-samples): no receipts, no signatures. */
export async function sampleBookingSlipPdf(b) {
  const d = { b, address: null, receipts: [], sigs: [], company: (await getSettings())["company.legal"] ?? {} };
  return { body: await renderHtmlPdf(await bookingSlipHtml(null, d)), filename: `ใบจอง-${b.booking_number}.pdf` };
}

/** Signature of the shop (staff) or the customer on the slip or a receipt. */
export async function signDocument(auth, bookingId, { kind, receiptId, party, signature }, ctx) {
  const png = Buffer.from(signature.replace(/^data:image\/png;base64,/, ""), "base64");
  if (png.length < 67 || png.readUInt32BE(0) !== 0x89504e47) throw BadRequest("Invalid signature image");
  return withTransaction(
    async (db) => {
      const docKind = kind === "booking" ? "BOOKING" : "RECEIPT";
      if (docKind === "RECEIPT") {
        const { rows } = await db.query("SELECT 1 FROM receipts WHERE id = $1 AND booking_id = $2", [receiptId, bookingId]);
        if (!rows[0]) throw NotFound("Receipt");
      }
      const key = `documents/${bookingId}/${docKind.toLowerCase()}-${party.toLowerCase()}-${sha256(png).toString("hex").slice(0, 16)}.png`;
      const provider = await storage.put("private", key, png, "image/png");
      const { rows: m } = await db.query(
        `INSERT INTO media (media_type, storage_provider, storage_key, mime_type, file_size_bytes, checksum_sha256, is_private, uploaded_by)
         VALUES ('IMAGE', $1, $2, 'image/png', $3, $4, true, $5) ON CONFLICT (storage_key) DO UPDATE SET deleted_at = NULL RETURNING id`,
        [provider, key, png.length, sha256(png), auth.user.id],
      );
      await db.query(
        `INSERT INTO document_signatures (booking_id, doc_kind, receipt_id, party, media_id, signed_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (booking_id, doc_kind, receipt_id, party) DO UPDATE SET media_id = EXCLUDED.media_id, signed_by = EXCLUDED.signed_by, signed_at = now()`,
        [bookingId, docKind, docKind === "RECEIPT" ? receiptId : null, party, m[0].id, auth.user.id],
      );
      await recordAudit(db, ctx, { action: "document.signed", entityType: "booking", entityId: bookingId, after: { kind, receiptId, party } });
    },
    { actorId: auth.user.id },
  );
}

const realEmail = (x) => x && !/@(line\.coolkids\.invalid|coolkids\.local)$/i.test(x);

/** Slip or receipt to the customer: PDF by e-mail, or a LINE message with the download link. */
export async function sendDocument(auth, bookingId, { kind, receiptId, via, email }, ctx) {
  const label = kind === "booking" ? "ใบจอง" : "ใบเสร็จรับเงิน";
  if (via === "line") {
    const doc = await documentHtml(bookingId, kind, receiptId);
    const b = doc.d.b;
    const { rows: line } = await pool.query("SELECT 1 FROM user_identities WHERE user_id = $1 AND provider = 'line'", [b.user_id]);
    if (!line[0]) throw Conflict("NO_LINE", "ลูกค้าคนนี้ไม่ได้จองผ่าน LINE · ส่งทางอีเมลแทน");
    await withTransaction(async (db) => {
      await notify(db, b.user_id, {
        type: "CONTRACT_SENT", bookingId: b.id,
        title: `${label}ของคุณ`,
        body: `การจอง ${b.booking_number}${doc.receipt ? ` · ใบเสร็จ ${doc.receipt.receipt_number}` : ""}\nเปิดลิงก์ด้านล่างเพื่อดาวน์โหลด ${label} (PDF)`,
      });
      await recordAudit(db, ctx, { action: "document.sent", entityType: "booking", entityId: b.id, after: { kind, receiptId, via } });
    });
    return { sent: true, via, delivered: config.lineMessagingConfigured };
  }
  if (!config.mailConfigured) throw new AppError(503, "MAIL_NOT_CONFIGURED", "ยังไม่ได้ตั้งค่าอีเมลของร้าน (SMTP_* ใน .env) · ส่งทาง LINE หรือดาวน์โหลด PDF แทน");
  const { body, filename, doc } = await documentPdf(bookingId, kind, receiptId);
  const b = doc.d.b;
  const { rows: u } = await pool.query("SELECT email FROM users WHERE id = $1", [b.user_id]);
  const to = email || b.contact_email || (realEmail(u[0]?.email) ? u[0].email : null);
  if (!to) throw BadRequest("ไม่มีอีเมลของลูกค้า · กรอกอีเมลที่จะส่ง");
  await sendMail({
    to,
    subject: `${label} Coolkids · ${doc.receipt?.receipt_number ?? b.booking_number}`,
    text: `เรียนคุณ ${b.legal_full_name ?? ""}\n\nแนบ${label}สำหรับการจอง ${b.booking_number}\n\nขอบคุณที่ใช้บริการ Coolkids Car Rental · 065-365-6514 · LINE @Coolkidscar`,
    attachments: [{ filename, content: body, contentType: "application/pdf" }],
  });
  await withTransaction((db) => recordAudit(db, ctx, { action: "document.sent", entityType: "booking", entityId: b.id, after: { kind, receiptId, via, to } }));
  return { sent: true, via, to };
}
