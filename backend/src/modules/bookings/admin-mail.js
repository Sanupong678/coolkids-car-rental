import { config } from "../../config/env.js";
import { pool } from "../../db/pool.js";
import { logger } from "../../shared/logger.js";
import { sendMail } from "../../shared/mailer.js";
import * as storage from "../../shared/storage.js";
import { esc, infoRows, layout, mailIcon, priceSection, tripSection } from "../notifications/mail-look.js";
import { staffRecipients } from "../notifications/staff-recipients.js";
import { BOOKING_SELECT, DOCUMENT_KINDS } from "./bookings.service.js";
import { bookingSummaryText } from "./summary.js";

// E-mail to staff (notifications/staff-recipients) when a customer sends a booking for
// review: who the customer is, the trip, and their ID / licence photos shown in
// the message (inline images) so the owner can check them from Gmail on a phone.
// The photos are personal data: they go only to the configured staff addresses,
// and the back office stays the place where the booking is approved.

const TZ = "Asia/Bangkok";
const fmt = new Intl.DateTimeFormat("th-TH", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" });
const when = (d) => (d ? fmt.format(new Date(d)) : "—");
const baht = (minor) => `${new Intl.NumberFormat("th-TH").format(Number(minor ?? 0) / 100)} บาท`;
// icon per detail row (frontend/public/media/mail/row-*.png)
const ROW_ICONS = {
  "ชื่อ-นามสกุล": "user", โทร: "phone", อีเมล: "mail", เอกสาร: "id", "Facebook / IG": "globe", ที่พัก: "pin", พื้นที่ใช้รถ: "map",
  วัตถุประสงค์: "flag", รถ: "car", รับรถ: "calendar", คืนรถ: "flag", จำนวนวัน: "clock", ค่าเช่ารวม: "money", มัดจำ: "shield", หมายเหตุลูกค้า: "note",
};
// the trip and money already have their own sections
const CUSTOMER_ROWS = new Set(["ชื่อ-นามสกุล", "โทร", "อีเมล", "เอกสาร", "Facebook / IG", "ที่พัก", "พื้นที่ใช้รถ", "วัตถุประสงค์", "หมายเหตุลูกค้า"]);
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "application/pdf": "pdf" };

const mediaIdOf = (r, kind) => (DOCUMENT_KINDS[kind].attachment ? r.attachments?.[kind] : r[DOCUMENT_KINDS[kind].column]) ?? null;

async function loadPhotos(b) {
  const out = [];
  for (const kind of Object.keys(DOCUMENT_KINDS)) {
    const id = mediaIdOf(b, kind);
    if (!id) continue;
    const { rows } = await pool.query("SELECT storage_provider, storage_key, mime_type FROM media WHERE id = $1 AND deleted_at IS NULL", [id]);
    if (!rows[0]) continue;
    const file = await storage.get("private", rows[0].storage_key, rows[0].storage_provider);
    if (!file) continue;
    out.push({ kind, label: DOCUMENT_KINDS[kind].label, body: file.body, contentType: rows[0].mime_type });
  }
  return out;
}

/** The rows of customer and trip details, shared by the text and HTML versions. */
function detailRows(b) {
  const delivery = b.fulfillment_type === "DELIVERY" ? b.delivery_address?.address : null;
  return [
    ["ชื่อ-นามสกุล", b.legal_full_name],
    ["โทร", b.customer_phone],
    ["อีเมล", b.contact_email],
    ["เอกสาร", b.id_document_type === "PASSPORT" ? "พาสปอร์ต" : "บัตรประชาชน"],
    ["Facebook / IG", b.social_url],
    ["ที่พัก", b.stay_location],
    ["พื้นที่ใช้รถ", b.area_of_use],
    ["วัตถุประสงค์", { TRAVEL: "ท่องเที่ยว", REPLACEMENT: "ใช้แทนรถที่ซ่อม" }[b.rental_purpose] ?? b.rental_purpose],
    ["รถ", [b.brand, b.model, b.trim, b.model_year].filter(Boolean).join(" ")],
    ["รับรถ", `${when(b.pickup_at)} · ${delivery ? `ส่งถึงที่: ${delivery}` : `ที่สาขา ${b.branch_name ?? ""}`}`],
    ["คืนรถ", when(b.return_at)],
    ["จำนวนวัน", b.rental_days],
    ["ค่าเช่ารวม", baht(b.total_minor)],
    ["มัดจำ", baht(b.deposit_minor)],
    ["หมายเหตุลูกค้า", b.customer_notes],
  ].filter(([, v]) => v !== null && v !== undefined && v !== "");
}

export function renderAdminBookingMail(b, photos) {
  const link = `${config.FRONTEND_URL}/admin?tab=approvals`;
  const rows = detailRows(b);
  const subject = `[Coolkids] รอตรวจเอกสาร ${b.booking_number} · ${b.legal_full_name ?? ""} · ${b.brand} ${b.model}`;
  const text = [
    `มีลูกค้าส่งเอกสารรอตรวจ: ${b.booking_number}`,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    `เอกสารแนบ: ${photos.map((p) => p.label).join(", ") || "—"}`,
    "",
    bookingSummaryText(b),
    "",
    `อนุมัติ / ขอแก้ไขเอกสาร: ${link}`,
  ].join("\n");

  const docs = photos
    .map((p, i) =>
      p.contentType.startsWith("image/")
        ? `<div style="margin:0 0 18px"><div style="font-size:14px;font-weight:700;color:#111;margin-bottom:8px"><img src="${mailIcon(p.kind.includes("license") ? "row-car" : p.kind === "reference" ? "row-file" : "row-id")}" width="18" height="18" alt="" style="vertical-align:-4px;border:0;margin-right:6px">${esc(p.label)}</div><img src="cid:doc${i}@coolkids" alt="${esc(p.label)}" style="display:block;width:100%;max-width:552px;height:auto;border-radius:12px;border:1px solid #ececec"></div>`
        : `<div style="margin:0 0 12px;font-size:14px">${esc(p.label)} — ไฟล์แนบ</div>`,
    )
    .join("");
  const html = layout({
    type: "STAFF_NEW_BOOKING",
    title: "การจองใหม่ รอตรวจเอกสาร",
    lead: `${b.legal_full_name ?? "ลูกค้า"} ส่งข้อมูลและเอกสารมาแล้ว กรุณาตรวจและอนุมัติในหลังบ้าน`,
    booking: b,
    staff: true,
    sections: [
      `<div style="font-size:20px;font-weight:700;color:#111;margin:0 0 10px">ข้อมูลลูกค้า</div>${infoRows(
        rows.filter(([k]) => CUSTOMER_ROWS.has(k)).map(([k, v]) => [ROW_ICONS[k] ?? "note", k, v]),
      )}`,
      tripSection(b),
      priceSection(b),
      `<div style="font-size:20px;font-weight:700;color:#111;margin:0 0 14px">รูปบัตร / เอกสาร (${photos.length})</div>${docs || '<div style="color:#6b7280">ไม่มีรูปแนบ</div>'}`,
    ],
    cta: { label: "เปิดหน้าตรวจเอกสาร", href: link },
    note: "อีเมลนี้มีข้อมูลส่วนบุคคลของลูกค้า กรุณาอย่าส่งต่อ",
  });
  const attachments = photos.map((p, i) => ({
    filename: `${b.booking_number}-${p.kind}.${EXT[p.contentType] ?? "bin"}`,
    content: p.body,
    contentType: p.contentType,
    cid: `doc${i}@coolkids`,
  }));
  return { subject, text, html, attachments };
}

/**
 * Staff e-mail when a payment comes in through Stripe (card, Link, PromptPay QR): these leave
 * no slip in the back office, so this is how the shop knows. Never throws.
 */
export async function mailAdminsPaymentReceived(paymentId) {
  if (!config.mailConfigured || config.isTest) return;
  try {
    const to = await staffRecipients();
    if (!to.length) return;
    const { rows: pay } = await pool.query(
      `SELECT p.booking_id, p.is_balance, p.payment_method_type, p.payment_method_last4,
              p.amount_minor + COALESCE((SELECT sum(c.amount_minor) FROM payments c WHERE c.parent_payment_id = p.id), 0) AS charged_minor
         FROM payments p WHERE p.id = $1`,
      [paymentId],
    );
    if (!pay[0]) return;
    const { rows } = await pool.query(`${BOOKING_SELECT} WHERE b.id = $1`, [pay[0].booking_id]);
    const b = rows[0];
    if (!b) return;
    const what = pay[0].is_balance ? "ค่าเช่าและเงินประกัน" : "ค่าจอง";
    const how = { promptpay: "PromptPay (Stripe)", card: `บัตร${pay[0].payment_method_last4 ? ` ลงท้าย ${pay[0].payment_method_last4}` : ""} (Stripe)`, link: "Stripe Link" }[pay[0].payment_method_type] ?? "Stripe";
    const link = `${config.FRONTEND_URL}/admin?tab=operations&booking=${b.booking_number}`;
    const subject = `[Coolkids] รับ${what}แล้ว ${baht(pay[0].charged_minor)} · ${b.booking_number} · ${b.legal_full_name ?? ""}`;
    const rowsOut = [
      ["money", "ยอดที่รับ", baht(pay[0].charged_minor)],
      ["note", "รายการ", what],
      ["money", "ช่องทาง", how],
      ["user", "ลูกค้า", `${b.legal_full_name ?? "—"} · ${b.customer_phone ?? ""}`],
      ["car", "รถ", [b.brand, b.model, b.license_plate].filter(Boolean).join(" ")],
      ["calendar", "รับรถ", when(b.pickup_at)],
    ];
    const text = [`รับ${what}แล้ว: ${b.booking_number}`, "", ...rowsOut.map(([, k, v]) => `${k}: ${v}`), "", `เปิดในหลังบ้าน: ${link}`].join("\n");
    const html = layout({
      type: "STAFF_PAYMENT_RECEIVED",
      title: `รับ${what}แล้ว`,
      lead: `${b.legal_full_name ?? "ลูกค้า"} ชำระ${what} ${baht(pay[0].charged_minor)} ผ่าน ${how} เงินเข้าบัญชี Stripe แล้ว`,
      booking: b,
      staff: true,
      sections: [infoRows(rowsOut)],
      cta: { label: "เปิดการจองในหลังบ้าน", href: link },
    });
    for (const addr of to) await sendMail({ to: addr, subject, text, html });
  } catch (err) {
    logger.error({ err, paymentId }, "admin payment e-mail failed");
  }
}

/** Sends the staff e-mail for one booking. Never throws: a mail problem must not fail the customer's submit. */
export async function mailAdminsBookingSubmitted(number) {
  if (!config.mailConfigured || config.isTest) return;
  try {
    const to = await staffRecipients();
    if (!to.length) return;
    const { rows } = await pool.query(`${BOOKING_SELECT} WHERE b.booking_number = $1 AND b.deleted_at IS NULL`, [number]);
    if (!rows[0]) return;
    const mail = renderAdminBookingMail(rows[0], await loadPhotos(rows[0]));
    // one message per person, so nobody sees the other recipients
    for (const addr of to) await sendMail({ to: addr, ...mail });
  } catch (err) {
    logger.error({ err, number }, "admin booking e-mail failed");
  }
}
