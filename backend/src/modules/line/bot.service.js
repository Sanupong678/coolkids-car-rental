import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../../config/env.js";
import { pool } from "../../db/pool.js";
import { logger } from "../../shared/logger.js";
import { vehicleListQuery } from "../catalogue/catalogue.schemas.js";
import * as catalogue from "../catalogue/catalogue.service.js";

// LINE Official Account chat bot. The rich menu buttons send a keyword as a
// text message (or a postback); the bot answers with cards in the chat:
//   เลือกรถ     → a carousel of cars, "จองคันนี้" opens the date picker (LIFF)
//   โปรโมชั่น   → the running promotions
//   ติดต่อเรา   → phone, LINE, Facebook, TikTok
//   กรอกเอกสาร → a button to the customer's booking in progress
// Replies to a user's message are free (they do not use the OA's message quota).
// Any other message is left alone so staff can chat from LINE OA Manager.

const REPLY = "https://api.line.me/v2/bot/message/reply";
const RED = "#E2362C";

const KEYWORDS = [
  [/^(เลือกรถ|จองรถ|ดูรถ|รถเช่า|cars?)$/i, "cars"],
  [/^(โปรโมชั่น|โปรโมชัน|โปร|promotions?)$/i, "promotions"],
  [/^(ติดต่อ|ติดต่อเรา|ช่องทางการติดต่อ|contact)$/i, "contact"],
  [/^(กรอกเอกสาร|ส่งเอกสาร|เอกสาร|การจองของฉัน)$/i, "documents"],
];

/** X-Line-Signature = base64(HMAC-SHA256(channel secret, raw body)). */
export function verifySignature(rawBody, signature) {
  if (!config.LINE_MESSAGING_CHANNEL_SECRET || !signature) return false;
  const expected = createHmac("sha256", config.LINE_MESSAGING_CHANNEL_SECRET).update(rawBody).digest();
  const given = Buffer.from(String(signature), "base64");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** A page of the site opened inside LINE (LIFF) when configured, else the plain site. */
export const liffUrl = (path) => (config.LIFF_ID ? `https://liff.line.me/${config.LIFF_ID}${path}` : `${config.FRONTEND_URL}${path}`);

const absolute = (url) => (/^https?:\/\//.test(url) ? url : `${config.FRONTEND_URL}${url}`);
// LINE shows JPEG / PNG only: the fleet's WebP cut-outs have JPEG twins in /cars/line/.
const lineImage = (image) => {
  const url = image?.url;
  if (!url) return null;
  const m = url.match(/^\/cars\/(.+)-\d+\.webp$/);
  return absolute(m ? `/cars/line/${m[1]}.jpg` : url);
};
const baht = (minor) => `฿${new Intl.NumberFormat("th-TH").format(Math.round(minor / 100))}`;
const TRANSMISSION = { AUTOMATIC: "เกียร์ออโต้", MANUAL: "เกียร์ธรรมดา" };

const text = (t, extra = {}) => ({ type: "text", text: String(t), wrap: true, ...extra });
const uriButton = (label, uri, style = "primary") => ({
  type: "button", style, height: "sm", ...(style === "primary" ? { color: RED } : {}), action: { type: "uri", label, uri },
});

function carBubble(v) {
  const daily = v.price.discountedDailyMinor ?? v.price.dailyMinor;
  const img = lineImage(v.image);
  return {
    type: "bubble",
    size: "kilo",
    ...(img ? { hero: { type: "image", url: img, size: "full", aspectRatio: "20:13", aspectMode: "cover", action: { type: "uri", uri: liffUrl(`/book/${v.slug}`) } } } : {}),
    body: {
      type: "box", layout: "vertical", spacing: "sm",
      contents: [
        text(`${v.brand} ${v.model}`, { weight: "bold", size: "lg" }),
        text([v.trim, v.year].filter(Boolean).join(" · "), { size: "xs", color: "#8C8C8C" }),
        {
          type: "box", layout: "baseline", margin: "md",
          contents: [
            text(baht(daily), { weight: "bold", size: "xl", color: RED, flex: 0, wrap: false }),
            text(" / วัน", { size: "sm", color: "#8C8C8C", flex: 0, wrap: false }),
            ...(v.price.discountedDailyMinor ? [text(baht(v.price.dailyMinor), { size: "xs", color: "#AAAAAA", decoration: "line-through", flex: 0, margin: "md", wrap: false })] : []),
          ],
        },
        ...(v.promotion ? [text(`🔥 ${v.promotion.name}`, { size: "xs", color: RED })] : []),
        text(`${v.specs.seats} ที่นั่ง · ${TRANSMISSION[v.specs.transmission] ?? v.specs.transmission} · มัดจำ ${baht(v.price.depositMinor)}`, { size: "xs", color: "#666666" }),
      ],
    },
    footer: { type: "box", layout: "vertical", spacing: "sm", contents: [uriButton("จองคันนี้ / เลือกวัน", liffUrl(`/book/${v.slug}`))] },
  };
}

async function carsMessage() {
  const { data } = await catalogue.listVehicles(vehicleListQuery.parse({ pageSize: 11 }));
  if (!data.length) return { type: "text", text: "ขออภัย ตอนนี้ยังไม่มีรถว่างในระบบ ติดต่อแอดมินได้เลยครับ" };
  const more = {
    type: "bubble", size: "kilo",
    body: {
      type: "box", layout: "vertical", justifyContent: "center", spacing: "md",
      contents: [text("ดูรถทั้งหมด", { weight: "bold", size: "lg", align: "center" }), text("ค้นหาตามวันที่ว่างและประเภทรถ", { size: "sm", color: "#8C8C8C", align: "center" })],
    },
    footer: { type: "box", layout: "vertical", contents: [uriButton("เปิดรายการรถ", liffUrl("/book"), "secondary")] },
  };
  return { type: "flex", altText: "เลือกรถที่ต้องการจอง", contents: { type: "carousel", contents: [...data.map(carBubble), more] } };
}

async function promotionsMessage() {
  const promos = (await catalogue.promotions()).slice(0, 10);
  if (!promos.length) {
    return { type: "text", text: "ตอนนี้ยังไม่มีโปรโมชั่นพิเศษ ราคาเช่าดีที่สุดอยู่ในรายการรถแล้วครับ กด \"เลือกรถ\" เพื่อดูรถทั้งหมด" };
  }
  const off = (p) => (p.discount_type === "PERCENT" ? `ลด ${p.discount_value / 100}%` : p.discount_type === "FIXED_PER_DAY" ? `ลด ${baht(p.discount_value)} / วัน` : "ราคาพิเศษ");
  const bubbles = promos.map((p) => ({
    type: "bubble", size: "kilo",
    ...(p.banner_url && !/\.webp$/i.test(p.banner_url) ? { hero: { type: "image", url: absolute(p.banner_url), size: "full", aspectRatio: "20:13", aspectMode: "cover" } } : {}),
    body: {
      type: "box", layout: "vertical", spacing: "sm",
      contents: [
        text(p.name, { weight: "bold", size: "lg" }),
        text(off(p), { weight: "bold", size: "md", color: RED }),
        ...(p.description ? [text(p.description, { size: "sm", color: "#666666", maxLines: 4 })] : []),
        ...(p.min_rental_days ? [text(`เช่าขั้นต่ำ ${p.min_rental_days} วัน`, { size: "xs", color: "#8C8C8C" })] : []),
        text(`ถึง ${new Date(p.ends_at).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric" })}`, { size: "xs", color: "#8C8C8C" }),
      ],
    },
    footer: { type: "box", layout: "vertical", contents: [uriButton("เลือกรถในโปรนี้", liffUrl(p.vehicles?.length === 1 ? `/book/${p.vehicles[0].slug}` : "/book"))] },
  }));
  return { type: "flex", altText: "โปรโมชั่น Coolkids", contents: { type: "carousel", contents: bubbles } };
}

async function contactMessage() {
  const { rows } = await pool.query("SELECT value FROM website_content WHERE key = 'site.contact'");
  const c = rows[0]?.value ?? {};
  const buttons = [
    c.phone && uriButton(`โทร ${c.phone}`, `tel:${String(c.phone).replace(/\D/g, "")}`),
    c.facebook && uriButton("Facebook", c.facebook, "secondary"),
    c.tiktok && uriButton("TikTok", c.tiktok, "secondary"),
    c.instagram && uriButton("Instagram", c.instagram, "secondary"),
    uriButton("เว็บไซต์", config.FRONTEND_URL, "secondary"),
  ].filter(Boolean);
  return {
    type: "flex", altText: "ช่องทางการติดต่อ Coolkids",
    contents: {
      type: "bubble",
      body: {
        type: "box", layout: "vertical", spacing: "sm",
        contents: [
          text("ช่องทางการติดต่อ", { weight: "bold", size: "lg" }),
          text("Coolkids Car Rental · รถเช่าขับเอง ส่งรถถึงที่", { size: "sm", color: "#8C8C8C" }),
          ...(c.phone2 ? [text(`สำรอง ${c.phone2}`, { size: "sm", color: "#666666" })] : []),
        ],
      },
      footer: { type: "box", layout: "vertical", spacing: "sm", contents: buttons },
    },
  };
}

function documentsMessage() {
  return {
    type: "flex", altText: "กรอกข้อมูลและแนบเอกสาร",
    contents: {
      type: "bubble",
      body: {
        type: "box", layout: "vertical", spacing: "sm",
        contents: [
          text("กรอกข้อมูลและแนบเอกสาร", { weight: "bold", size: "lg" }),
          text("1. บัตรประชาชน + ใบขับขี่ (ผู้ขับท่านที่ 1)\n2. บัตรประชาชน + ใบขับขี่ (ผู้ขับท่านที่ 2 ถ้ามี)\n3. ที่พักปัจจุบัน หรือ โลเคชั่น\n4. เอกสารอ้างอิง เช่น ตั๋วเครื่องบิน การจองที่พัก ใบส่งซ่อมรถ\n5. เบอร์โทรศัพท์มือถือ\n6. หน้าเฟส หรือ ไอจี", { size: "sm", color: "#444444" }),
          text("ทางร้านรักษาข้อมูลลูกค้าตามกฎหมาย PDPA อย่างเคร่งครัด ไม่เปิดเผยแก่บุคคลภายนอก", { size: "xxs", color: "#8C8C8C", margin: "md" }),
        ],
      },
      footer: {
        type: "box", layout: "vertical", spacing: "sm",
        contents: [uriButton("การจองของฉัน / แนบเอกสาร", liffUrl("/continue")), uriButton("ยังไม่ได้เลือกรถ? เลือกรถ", liffUrl("/book"), "secondary")],
      },
    },
  };
}

const BUILD = { cars: carsMessage, promotions: promotionsMessage, contact: contactMessage, documents: documentsMessage };

/** Which card set an event asks for, or null (leave it to staff). */
export function intentOf(event) {
  if (event.type === "postback") return new URLSearchParams(event.postback?.data ?? "").get("action");
  if (event.type === "message" && event.message?.type === "text") {
    const t = event.message.text.trim();
    return KEYWORDS.find(([re]) => re.test(t))?.[1] ?? null;
  }
  return null;
}

async function reply(replyToken, messages) {
  const res = await fetch(REPLY, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.LINE_MESSAGING_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ replyToken, messages }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) logger.warn({ status: res.status, body: await res.text().catch(() => "") }, "LINE reply failed");
}

/** The bot's answer to one event, or null when staff should answer instead. */
export async function repliesFor(event) {
  const intent = intentOf(event);
  return intent && BUILD[intent] ? [await BUILD[intent]()] : null;
}

/** Handles one webhook delivery (already signature-checked). */
export async function handleEvents(events = []) {
  for (const event of events) {
    if (!event.replyToken) continue;
    try {
      const messages = await repliesFor(event);
      if (messages) await reply(event.replyToken, messages);
    } catch (err) {
      logger.error({ err, type: event.type }, "LINE bot reply failed");
    }
  }
}
