import { config } from "../../config/env.js";
import { createRequire } from "node:module";
import { RENTAL_RULES } from "../bookings/summary.js";

// Car photos flattened onto the hero grey as JPG (frontend/public/media/mail/cars): Gmail turns the
// transparent WebP cut-outs black. A car added later, without one yet, falls back to its WebP.
const MAIL_CARS = new Set(createRequire(import.meta.url)("./mail-cars.json"));

// The look shared by every HTML e-mail (receipt style): a light-grey hero with
// the status pill, the title and the car photo; white sections for the trip,
// the money and the message; help cards; a dark footer. E-mail apps ignore SVG
// and most modern CSS, so the layout is tables with inline styles and the icons
// are PNGs on the website (frontend/public/media/mail, drawn by
// scripts/mail-icons.js).

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const site = () => config.FRONTEND_URL.replace(/\/$/, "");
const icon = (name) => `${site()}/media/mail/${name}.png`;
export const absolute = (url) => (!url ? null : /^https?:\/\//.test(url) ? url : `${site()}${url.startsWith("/") ? "" : "/"}${url}`);

const TZ = "Asia/Bangkok";
const dayFmt = new Intl.DateTimeFormat("th-TH", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("th-TH", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const nowFmt = new Intl.DateTimeFormat("th-TH", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" });
const thb = (minor) => `฿${new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 }).format(Number(minor ?? 0) / 100)}`;

// status: badge image, pill colours, short label
const S = {
  ok: { badge: "ok", fg: "#15803d", bg: "#e7f6ec" },
  no: { badge: "no", fg: "#c62828", bg: "#fdecec" },
  wait: { badge: "wait", fg: "#c2710c", bg: "#fff3e0" },
  info: { badge: "doc", fg: "#1d4ed8", bg: "#e8effd" },
  grey: { badge: "cancel", fg: "#4b5563", bg: "#eef0f2" },
};
export const STATUS = {
  BOOKING_SUBMITTED: { ...S.info, label: "รอตรวจเอกสาร" },
  STAFF_NEW_BOOKING: { ...S.wait, badge: "staff", label: "รอตรวจเอกสาร" },
  BOOKING_APPROVED: { ...S.ok, label: "อนุมัติแล้ว" },
  DOCS_CHANGES_REQUESTED: { ...S.wait, label: "ขอแก้ไขเอกสาร" },
  SLIP_NEEDS_REVIEW: { ...S.wait, badge: "slip", label: "กำลังตรวจสลิป" },
  SLIP_REJECTED: { ...S.no, label: "สลิปไม่ผ่าน" },
  BOOKING_CONFIRMED: { ...S.ok, label: "ยืนยันการจองแล้ว" },
  BOOKING_PREPARING: { ...S.info, badge: "prep", label: "กำลังเตรียมรถ" },
  BOOKING_READY: { ...S.ok, badge: "ready", label: "รถพร้อมให้รับ" },
  BOOKING_IN_DELIVERY: { ...S.info, badge: "drive", label: "กำลังส่งรถ" },
  BOOKING_COMPLETED: { ...S.ok, label: "คืนรถเรียบร้อย" },
  BOOKING_CANCELLED: { ...S.grey, label: "ยกเลิกแล้ว" },
};

/** Rounded status pill with its small round icon (Accepted / Waiting / Declined style). */
export function pill(type) {
  const s = STATUS[type];
  if (!s) return "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate"><tr>
<td style="background:${s.bg};border-radius:999px;padding:6px 14px 6px 6px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:8px"><img src="${icon(`badge-${s.badge}`)}" width="22" height="22" alt="" style="display:block;border:0"></td>
<td style="color:${s.fg};font-size:14px;font-weight:700;white-space:nowrap">${esc(s.label)}</td></tr></table></td></tr></table>`;
}

const h2 = (text) => `<div style="font-size:20px;font-weight:700;color:#111;margin:0 0 14px">${esc(text)}</div>`;
const divider = `<div style="height:1px;background:#ececec;margin:22px 0"></div>`;

/** label · value row with a small grey icon in front (customer details). */
export function infoRows(rows) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">${rows
    .map(
      ([ic, k, v]) => `<tr>
<td style="width:30px;padding:9px 0;vertical-align:top"><img src="${icon(`row-${ic}`)}" width="20" height="20" alt="" style="display:block;border:0"></td>
<td style="padding:9px 12px 9px 0;color:#6b7280;font-size:14px;vertical-align:top;white-space:nowrap">${esc(k)}</td>
<td style="padding:9px 0;color:#111;font-size:14px;text-align:right;vertical-align:top">${esc(v)}</td></tr>`,
    )
    .join("")}</table>`;
}

/** The car, then pick-up → return as a little timeline (dot, line, square), like a trip receipt. */
export function tripSection(b) {
  const car = [b.brand, b.model].filter(Boolean).join(" ");
  const sub = [b.trim, b.model_year].filter(Boolean).join(" · ");
  const place = b.fulfillment_type === "DELIVERY" ? `ส่งถึงที่: ${b.delivery_address?.address ?? "-"}` : `รับที่สาขา ${b.branch_name ?? ""}`;
  const back = b.return_type && b.return_type !== "BRANCH" ? `รับรถคืนที่: ${b.return_address?.address ?? "-"}` : `คืนที่สาขา ${b.branch_name ?? ""}`;
  const stop = (marker, when, where, last) => `<tr>
<td style="width:22px;vertical-align:top;padding-top:4px"><div style="width:12px;height:12px;${marker};background:#111;margin:0 auto"></div>${
    last ? "" : `<div style="width:2px;height:54px;background:#111;margin:2px auto 0"></div>`
  }</td>
<td style="padding:0 0 ${last ? 0 : 14}px 10px;vertical-align:top"><div style="font-size:15px;font-weight:700;color:#111">${esc(when)}</div><div style="font-size:13px;color:#555;line-height:1.5">${esc(where)}</div></td></tr>`;
  const day = (d) => (d ? `${dayFmt.format(new Date(d))} · ${timeFmt.format(new Date(d))} น.` : "-");
  return `${h2("รายละเอียดการเช่า")}
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:16px"><tr>
<td style="width:30px;vertical-align:middle"><img src="${icon("row-car")}" width="22" height="22" alt="" style="display:block;border:0"></td>
<td style="vertical-align:middle"><div style="font-size:15px;font-weight:700;color:#111">${esc(car)}</div><div style="font-size:13px;color:#6b7280">${esc(sub)}</div></td>
<td style="text-align:right;vertical-align:middle;font-size:13px;color:#6b7280;white-space:nowrap">${esc(b.rental_days ?? "-")} วัน</td></tr></table>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%">${stop("border-radius:6px", `รับรถ ${day(b.pickup_at)}`, place)}${stop("border-radius:2px", `คืนรถ ${day(b.return_at)}`, back, true)}</table>`;
}

/** Total first, then the breakdown and what is paid / still due (receipt style). */
export function priceSection(b) {
  const p = b.pricing_snapshot ?? {};
  const deposit = Number(b.deposit_minor ?? 0);
  const total = Number(b.total_minor ?? 0) + deposit;
  const paid = b.payment?.status === "SUCCEEDED" ? Number(b.payment.amountMinor) : 0;
  const line = (k, v, opts = {}) =>
    `<tr><td style="padding:8px 0;font-size:${opts.big ? 22 : 15}px;${opts.big ? "font-weight:700;" : ""}color:${opts.muted ? "#6b7280" : "#111"}">${k}</td><td style="padding:8px 0;text-align:right;font-size:${
      opts.big ? 22 : 15
    }px;${opts.big || opts.bold ? "font-weight:700;" : ""}color:${opts.green ? "#15803d" : "#111"};white-space:nowrap">${v}</td></tr>`;
  const rows = [
    line("รวมทั้งหมด", thb(total), { big: true }),
    `<tr><td colspan="2" style="height:1px;background:#ececec;padding:0"></td></tr>`,
    line(`ค่าเช่า ${thb(p.daily ?? 0)} × ${esc(b.rental_days ?? 0)} วัน`, thb(p.rental ?? 0)),
    ...(Number(p.discount) ? [line("ส่วนลด", `−${thb(p.discount)}`, { green: true })] : []),
    ...(Number(p.delivery) ? [line("ค่าบริการส่งรถ", thb(p.delivery))] : []),
    ...(Number(p.returnPickup) ? [line("ค่าบริการรับรถคืน", thb(p.returnPickup))] : []),
    line("เงินประกัน (ได้คืนหลังคืนรถ)", thb(deposit)),
  ];
  // waiting for the reservation fee: show what to transfer now
  const feeDue = !paid && b.status === "PENDING" && b.amount_due_now_minor != null ? Number(b.amount_due_now_minor) : 0;
  const pay = [
    ...(feeDue ? [line(`<img src="${icon("row-money")}" width="20" height="20" alt="" style="vertical-align:-5px;border:0;margin-right:8px">โอนค่าจองตอนนี้`, thb(feeDue), { bold: true })] : []),
    ...(paid ? [line(`<img src="${icon("row-money")}" width="20" height="20" alt="" style="vertical-align:-5px;border:0;margin-right:8px">ชำระค่าจองแล้ว`, thb(paid), { green: true, bold: true })] : []),
    line(`<img src="${icon("row-receipt")}" width="20" height="20" alt="" style="vertical-align:-5px;border:0;margin-right:8px">ชำระวันรับรถ`, thb(total - paid - feeDue), { bold: true }),
  ];
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">${rows.join("")}</table>
${divider}${h2("การชำระเงิน")}<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">${pay.join("")}</table>`;
}

/** The message of this e-mail in a tinted box (what happened / what to do next). */
export function messageBox(type, text) {
  if (!text) return "";
  const s = STATUS[type] ?? S.info;
  return `<div style="background:${s.bg};border-radius:14px;padding:16px 18px;color:#222;font-size:15px;line-height:1.6;white-space:pre-line">${esc(text)}</div>`;
}

/** The PDFs attached to this e-mail, listed so nobody misses them. */
export function attachmentsBox(names) {
  if (!names?.length) return "";
  return `<div style="font-size:20px;font-weight:700;color:#111;margin:0 0 12px">เอกสารแนบ</div>${names
    .map(
      (n) => `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #ececec;border-radius:12px;margin-bottom:8px"><tr>
<td style="width:44px;padding:12px 0 12px 14px"><img src="${icon("row-file")}" width="22" height="22" alt="" style="display:block;border:0"></td>
<td style="padding:12px 14px 12px 0;font-size:14px;font-weight:700;color:#111">${esc(n)}<div style="font-size:12px;font-weight:400;color:#6b7280">PDF · แนบมากับอีเมลนี้</div></td></tr></table>`,
    )
    .join("")}`;
}

export function rulesBox() {
  return `<div style="background:#f6f7f9;border-radius:14px;padding:16px 18px"><div style="font-weight:700;color:#111;margin-bottom:8px">เงื่อนไขการเช่า</div>${RENTAL_RULES.map(
    (r) => `<div style="padding:4px 0 4px 16px;text-indent:-16px;color:#555;font-size:13px;line-height:1.55">• ${esc(r)}</div>`,
  ).join("")}</div>`;
}

const button = (label, href, dark) =>
  `<a href="${esc(href)}" style="display:block;text-align:center;background:${dark ? "#111" : "#f1f2f4"};color:${dark ? "#fff" : "#111"};text-decoration:none;padding:14px 18px;border-radius:12px;font-weight:700;font-size:15px">${esc(label)}</a>`;

function helpCards() {
  const card = (title, text, label, href, ic) => `<td style="width:50%;padding:0 6px;vertical-align:top">
<div style="border:1px solid #ececec;border-radius:14px;padding:16px">
<div style="font-size:16px;font-weight:700;color:#111;margin-bottom:6px">${esc(title)}</div>
<div style="font-size:13px;color:#555;line-height:1.5;margin-bottom:12px;min-height:40px">${esc(text)}</div>
<a href="${esc(href)}" style="display:block;text-align:center;background:#f1f2f4;color:#111;text-decoration:none;padding:10px;border-radius:10px;font-size:13px;font-weight:700"><img src="${icon(`row-${ic}`)}" width="16" height="16" alt="" style="vertical-align:-3px;border:0;margin-right:6px">${esc(label)}</a></div></td>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 -6px"><tr>
${card("ต้องการความช่วยเหลือ?", "ทีมงานพร้อมตอบทุกคำถามทาง LINE", "แชท LINE", "https://line.me/R/ti/p/@coolkidscar", "chat")}
${card("โทรหาเรา", "ทุกวัน 08:00 – 20:00 น.", "065-365-6514", "tel:0653656514", "phone")}</tr></table>`;
}

/**
 * The whole e-mail.
 * @param o { type, title, lead, booking (row, for the car photo / number), sections: [html], cta: { label, href }, note, staff }
 */
export function layout(o) {
  const b = o.booking ?? {};
  const photo = b.image_variants?.w640 ?? b.image_url;
  const flat = photo?.match(/([^/]+)\.webp$/)?.[1];
  const car = flat && MAIL_CARS.has(flat) ? `${site()}/media/mail/cars/${flat}.jpg` : absolute(photo);
  const preheader = o.lead ?? o.title;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.title)}</title></head>
<body style="margin:0;padding:0;background:#e9eaec;font-family:'Helvetica Neue',Arial,Helvetica,sans-serif;color:#111;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#e9eaec"><tr><td align="center" style="padding:16px 8px">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#fff;border-radius:18px;overflow:hidden">
<tr><td style="background:#f1f2f4;padding:26px 24px 28px">
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%"><tr>
    <td><img src="${icon("logo")}" width="170" alt="Coolkids Car Rental" style="display:block;width:170px;max-width:100%;height:auto;border:0"></td>
    <td style="text-align:right;font-size:12px;color:#6b7280;line-height:1.4">${esc(nowFmt.format(new Date()))}${b.booking_number ? `<br>${esc(b.booking_number)}` : ""}</td>
  </tr></table>
  <div style="height:22px"></div>
  ${pill(o.type)}
  <div style="font-size:28px;line-height:1.2;font-weight:800;color:#111;margin-top:14px">${esc(o.title)}</div>
  ${o.lead ? `<div style="font-size:15px;line-height:1.55;color:#374151;margin-top:10px">${esc(o.lead)}</div>` : ""}
  ${car ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-top:14px"><tr><td align="center" style="text-align:center"><img src="${esc(car)}" width="340" alt="${esc([b.brand, b.model].filter(Boolean).join(" "))}" style="display:inline-block;width:100%;max-width:340px;height:auto;border:0"></td></tr></table>` : ""}
</td></tr>
<tr><td style="padding:26px 24px 8px">
  ${o.sections.filter(Boolean).join(divider)}
  ${o.cta ? `<div style="margin-top:24px">${button(o.cta.label, o.cta.href, true)}</div>` : ""}
  ${o.note ? `<div style="margin-top:16px;font-size:12px;color:#9ca3af;text-align:center">${esc(o.note)}</div>` : ""}
</td></tr>
${o.staff ? "" : `<tr><td style="padding:16px 18px 26px">${helpCards()}</td></tr>`}
<tr><td style="background:#111;padding:24px">
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%"><tr>
    <td style="vertical-align:top;font-size:12px;color:#9ca3af;line-height:1.6">บริษัท คูลคิดส์ คาร์ เร้นท์ทอล จำกัด<br>รถเช่าขับเอง ดอนเมือง · ส่งรถทั่วกรุงเทพ</td>
    <td style="vertical-align:top;text-align:right;font-size:13px;line-height:2"><a href="${esc(site())}" style="color:#fff">coolkidscar.com</a><br><a href="https://line.me/R/ti/p/@coolkidscar" style="color:#fff">LINE @Coolkidscar</a></td>
  </tr></table>
  <img src="${icon("logo-white")}" width="140" alt="Coolkids Car Rental" style="display:block;width:140px;height:auto;border:0;margin-top:18px">
</td></tr>
</table></td></tr></table></body></html>`;
}

export { icon as mailIcon, thb };
