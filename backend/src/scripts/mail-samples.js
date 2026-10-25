// Sends one sample of every e-mail the system can send, to one address, so the
// shop can see them in Gmail. Made-up booking, no real customer data; a car
// photo stands in for the ID / licence photos.
//   node src/scripts/mail-samples.js someone@gmail.com
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.js";
import { pool } from "../db/pool.js";
import { sendMail } from "../shared/mailer.js";
import { renderAdminBookingMail } from "../modules/bookings/admin-mail.js";
import { bookingSummaryText } from "../modules/bookings/summary.js";
import { sampleBookingSlipPdf } from "../modules/bookings/documents.service.js";
import { EMAIL_TYPES, PDF_TYPES, renderCustomerMail } from "../modules/notifications/email.service.js";

const to = process.argv[2];
if (!to || !config.mailConfigured) {
  console.error(to ? "SMTP_* is not set in .env" : "usage: node src/scripts/mail-samples.js someone@gmail.com");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const photo = readFileSync(resolve(here, "../db/assets/cars/almera-640.webp"));
const number = "CK-SAMPLE-0001";
const b = {
  booking_number: number, legal_full_name: "(ตัวอย่าง) สมชาย ใจดี", customer_phone: "080-000-0000", contact_email: "sample@example.com",
  id_document_type: "THAI_ID", social_url: "facebook.com/sample", stay_location: "โรงแรมตัวอย่าง ดอนเมือง", area_of_use: "กรุงเทพ · ชลบุรี",
  rental_purpose: "TRAVEL", brand: "Honda", model: "Civic", trim: "e:HEV RS", model_year: 2026,
  pickup_at: "2026-10-28T03:00:00Z", return_at: "2026-11-03T03:00:00Z", fulfillment_type: "PICKUP", branch_name: "ดอนเมือง",
  rental_days: 6, total_minor: 1440000, deposit_minor: 500000, currency: "THB", items: [], customer_notes: "ขอรับรถช่วงเช้า",
  pricing_snapshot: { daily: 240000, rental: 1440000 }, payment: { status: "SUCCEEDED", amountMinor: 100000 },
  image_url: "/uploads/cars/ck-civic-rs-1200.webp", image_variants: { w640: "/uploads/cars/ck-civic-rs-640.webp" },
};
const photos = [
  { kind: "id_front", label: "บัตรประชาชน (ด้านหน้า) — รูปตัวอย่าง", body: photo, contentType: "image/webp" },
  { kind: "id_back", label: "บัตรประชาชน (ด้านหลัง) — รูปตัวอย่าง", body: photo, contentType: "image/webp" },
  { kind: "license_front", label: "ใบขับขี่ (ด้านหน้า) — รูปตัวอย่าง", body: photo, contentType: "image/webp" },
];

// the customer texts, as the booking code writes them
const car = `${b.brand} ${b.model}`;
const CUSTOMER = {
  BOOKING_SUBMITTED: ["ได้รับข้อมูลและเอกสารแล้ว", `การจอง ${number} (${car})\nเจ้าหน้าที่กำลังตรวจสอบเอกสาร เราล็อกรถไว้ให้ระหว่างนี้ เมื่อตรวจเสร็จจะแจ้งให้โอนค่าจองทันที`],
  BOOKING_APPROVED: ["เอกสารผ่านการตรวจสอบแล้ว", `การจอง ${number} (${car})\nกรุณาโอนค่าจอง 1,000 บาท ภายใน 12 ชั่วโมง เพื่อยืนยันการจอง (โอน = จอง)\nกดลิงก์ด้านล่างเพื่อสแกน QR และแนบสลิป`],
  DOCS_CHANGES_REQUESTED: ["ขอข้อมูล / เอกสารเพิ่มเติม", `การจอง ${number}: รูปใบขับขี่ไม่ชัด กรุณาถ่ายใหม่\nกดลิงก์ด้านล่างเพื่อแก้ไขแล้วส่งอีกครั้ง`],
  SLIP_NEEDS_REVIEW: ["ได้รับสลิปแล้ว", `การจอง ${number}: เจ้าหน้าที่กำลังตรวจสอบสลิป เราล็อกรถไว้ให้ระหว่างนี้`],
  SLIP_REJECTED: ["สลิปไม่ผ่านการตรวจสอบ", `การจอง ${number}: ยอดเงินในสลิปไม่ตรงกับค่าจอง กรุณาส่งสลิปใหม่ หรือติดต่อ LINE @Coolkidscar`],
  BOOKING_CONFIRMED: ["ชำระเงินสำเร็จ ยืนยันการจองแล้ว ขอบคุณที่ใช้บริการ Coolkids", `เลขที่การจอง ${number}\n\n${bookingSummaryText(b)}\n\nสัญญาเช่า (PDF) ดาวน์โหลดได้จากลิงก์ด้านล่าง`],
  BOOKING_PREPARING: ["กำลังเตรียมเอกสาร", `${number}: เจ้าหน้าที่รับงานแล้ว กำลังเตรียมเอกสารและรถของคุณ`],
  BOOKING_READY: ["รถพร้อมให้รับ", `${number}: รถพร้อมแล้ว รับได้ที่สาขาตามเวลานัด`],
  BOOKING_IN_DELIVERY: ["กำลังส่งรถ", `${number}: รถกำลังเดินทางไปหาคุณ`],
  BOOKING_COMPLETED: ["คืนรถเรียบร้อย", `${number}: ขอบคุณที่ใช้บริการ Coolkids`],
  BOOKING_CANCELLED: ["การจองถูกยกเลิก", `${number}: เจ้าหน้าที่ยกเลิกการจองของคุณ หากมีข้อสงสัยติดต่อ LINE @Coolkidscar`],
};

let i = 0;
const total = 1 + EMAIL_TYPES.size;
const tag = () => `[ตัวอย่าง ${++i}/${total}]`;

const admin = renderAdminBookingMail({ ...b, payment: null, status: "PENDING", amount_due_now_minor: 100000 }, photos);
await sendMail({ to, ...admin, subject: `${tag()} แอดมิน · ${admin.subject}` });
console.log(`sent ${i}/${total}: staff — new booking`);

for (const type of EMAIL_TYPES) {
  const [title, body] = CUSTOMER[type];
  // before payment the booking waits for the 1,000 THB fee; from "confirmed" on it is paid
  const before = ["BOOKING_SUBMITTED", "BOOKING_APPROVED", "DOCS_CHANGES_REQUESTED", "SLIP_NEEDS_REVIEW", "SLIP_REJECTED"].includes(type);
  const booking = before ? { ...b, payment: null, status: "PENDING", amount_due_now_minor: 100000 } : b;
  // the real e-mail also attaches the rental contract; the sample has no contract row, so only the slip
  const files = PDF_TYPES[type] ? [await sampleBookingSlipPdf({ ...booking, license_plate: "กข 1234", created_at: new Date() })] : [];
  const m = renderCustomerMail({ type, title, body, booking_number: number }, booking, files);
  await sendMail({ to, ...m, subject: `${tag()} ลูกค้า · ${m.subject}` });
  console.log(`sent ${i}/${total}: customer — ${type}`);
}
await pool.end();
