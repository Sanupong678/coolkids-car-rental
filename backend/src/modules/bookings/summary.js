// The booking summary Coolkids used to type into the LINE chat by hand, now
// filled from the booking: car, dates, places, price breakdown, what was paid
// and what is due at pick-up, then the shop's rental rules. Sent on LINE when
// the reservation fee is confirmed (Thai) and shown on the booking page in the
// customer's language (Thai / English / Chinese).

const TZ = "Asia/Bangkok";
const thbFmt = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 });
const baht = (minor) => thbFmt.format(Number(minor) / 100);
// 7/10/69 @08:30 — Buddhist-era short date, as on the shop's old messages; other languages use 07/10/2026.
const DATE_FMT = {
  th: new Intl.DateTimeFormat("th-TH-u-ca-buddhist", { timeZone: TZ, day: "numeric", month: "numeric", year: "2-digit" }),
  en: new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }),
};
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const when = (d, lang) => `${(DATE_FMT[lang] ?? DATE_FMT.en).format(new Date(d))} @${timeFmt.format(new Date(d))}`;

export const RENTAL_RULES = [
  "วันรับรถ น้ำมันทางร้านเติมเต็มถัง วันคืนรถ ลูกค้าเติมน้ำมันเต็มถังด้วยนะครับ หากไม่ได้เติม จะมีการหักจากเงินประกัน",
  "รับและคืนรถตามเวลาที่ระบุในสัญญา หากต้องการเปลี่ยนแปลงเวลารับหรือส่งคืนรถ ต้องแจ้งล่วงหน้า 4 ชม. เพื่อทำการจัดคิว เลทได้ ชั่วโมงละ 300 บาท",
  "หากมีการเปลี่ยนเวลาโดยไม่แจ้งล่วงหน้า ปรับ ชม.ละ 500 บาท",
  "ยกเลิกจองไม่คืนเงินทุกกรณี แจ้งก่อน 7 วัน สามารถเลื่อนคิวได้ 60 วัน",
  "สูบบุหรี่ กัญชา ในรถ หรือมีกลิ่นไม่พึงประสงค์ ปรับ 3,000 บาท ทุกกรณี",
  "เงินประกัน คืนภายใน 24 ชม. หลังจากรับ ตรวจเช็ครถเสร็จ",
  "มารับรถช้ากว่าเวลาที่นัดรับไว้ ปรับ 30 นาทีแรก 150 บาท + 200 บาท ทุก 30 นาที เปลี่ยนเวลาแจ้งก่อน 1 ชั่วโมง ฟรี",
];

// The same rules for customers reading in English / Chinese (the Thai text above is the one that counts).
const RULES = {
  th: RENTAL_RULES,
  en: [
    "The car is handed over with a full tank; please return it with a full tank, otherwise the fuel is deducted from the deposit.",
    "Pick up and return at the times in the agreement. To change a time, tell us at least 4 hours ahead so we can schedule it; late return is 300 THB per hour.",
    "Changing the time without notice costs 500 THB per hour.",
    "Reservation fees are not refundable. With at least 7 days’ notice the booking can be moved within 60 days.",
    "Smoking or cannabis in the car, or any unpleasant smell: 3,000 THB fine in every case.",
    "The deposit is returned within 24 hours after the car is returned and checked.",
    "Picking up later than agreed: 150 THB for the first 30 minutes + 200 THB for every further 30 minutes. Changing the time with 1 hour’s notice is free.",
  ],
  zh: [
    "取车时油箱已加满，还车时请加满油，否则将从押金中扣除油费。",
    "请按合同时间取车和还车。如需更改时间，请至少提前 4 小时通知以便安排；延迟还车每小时 300 泰铢。",
    "未提前通知而更改时间，每小时罚款 500 泰铢。",
    "订金一律不退。提前 7 天通知可在 60 天内改期。",
    "车内吸烟、吸食大麻或有异味，一律罚款 3,000 泰铢。",
    "还车并检查完毕后 24 小时内退还押金。",
    "晚于约定时间取车：首 30 分钟 150 泰铢，之后每 30 分钟 200 泰铢。提前 1 小时通知改时间免费。",
  ],
};

const L = {
  th: {
    car: "รุ่นรถ : ", pickup: "วันที่ เวลา รับรถ: ", ret: "วันที่ เวลา คืนรถ: ", area: "สถานที่ใช้รถ : ",
    from: "สถานที่รับรถ: ", to: "สถานที่ส่งคืนรถ : ", rental: "ค่าเช่า ", discount: "ส่วนลด ", deposit: "เงินประกัน ",
    delivery: "ค่าบริการรับส่งรถ ", returnFee: "ค่าบริการรับรถคืน ", total: "รวม ", paid: "ชำระค่าจองแล้ว ", due: "วันรับรถชำระ ", unit: " บาท",
    feeNote: "เงินจองจะถูกนำไปหักในค่าใช้จ่ายวันรับรถ",
  },
  en: {
    car: "Car: ", pickup: "Pick-up: ", ret: "Return: ", area: "Area of use: ",
    from: "Pick-up place: ", to: "Return place: ", rental: "Rental ", discount: "Discount ", deposit: "Deposit ",
    delivery: "Delivery ", returnFee: "Collection ", total: "Total ", paid: "Reservation fee paid ", due: "To pay at pick-up ", unit: " THB",
    feeNote: "The reservation fee is deducted from what you pay at pick-up.",
  },
  zh: {
    car: "车型：", pickup: "取车时间：", ret: "还车时间：", area: "用车地点：",
    from: "取车地点：", to: "还车地点：", rental: "租金 ", discount: "折扣 ", deposit: "押金 ",
    delivery: "送车费 ", returnFee: "上门取车费 ", total: "合计 ", paid: "已付订金 ", due: "取车时支付 ", unit: " 泰铢",
    feeNote: "订金将在取车当天从应付款中扣除。",
  },
};
const PLACES = { en: { "Coolkids ดอนเมือง": "Coolkids Don Mueang" }, zh: { "Coolkids ดอนเมือง": "Coolkids 廊曼" } };

/**
 * @param r a bookings row joined with vehicle (brand, model) and branch_name, plus its `payment` summary.
 * @param lang "th" (default — the text sent on LINE), "en" or "zh".
 */
export function bookingSummaryText(r, lang = "th") {
  const l = L[lang] ?? L.th;
  const p = r.pricing_snapshot ?? {};
  const rawPlace = r.fulfillment_type === "DELIVERY" ? r.delivery_address?.address : r.branch_name;
  const place = PLACES[lang]?.[rawPlace] ?? rawPlace;
  // where the car goes back: the branch unless the shop collects it from an address
  const rawBack = r.return_type && r.return_type !== "BRANCH" ? r.return_address?.address : r.branch_name;
  const back = PLACES[lang]?.[rawBack] ?? rawBack;
  const paid = r.payment?.status === "SUCCEEDED" ? Number(r.payment.amountMinor) : 0;
  const deposit = Number(r.deposit_minor);
  const total = Number(r.total_minor) + deposit; // rental + delivery − discount + deposit
  const lines = [
    `${l.car}${[r.brand, r.model].filter(Boolean).join(" ")}`,
    `${l.pickup}${when(r.pickup_at, lang)}`,
    `${l.ret}${when(r.return_at, lang)}`,
    "",
    `${l.area}${r.area_of_use ?? "-"}`,
    `${l.from}${place ?? "-"}`,
    `${l.to}${back ?? "-"}`,
    "",
    `${l.rental}${baht(p.daily ?? 0)}*${r.rental_days}=${baht(p.rental ?? 0)}${l.unit}`,
    ...(Number(p.discount) ? [`${l.discount}${baht(p.discount)}${l.unit}`] : []),
    `${l.deposit}${baht(deposit)}${l.unit}`,
    ...(Number(p.delivery) ? [`${l.delivery}${baht(p.delivery)}${l.unit}`] : []),
    ...(Number(p.returnPickup) ? [`${l.returnFee}${baht(p.returnPickup)}${l.unit}`] : []),
    `${l.total}${baht(total)}${l.unit}`,
    ...(paid ? [`${l.paid}${baht(paid)}${l.unit}`] : []),
    "",
    `${l.due}${baht(total - paid)}${l.unit}`,
    "",
    ...(RULES[lang] ?? RULES.th).flatMap((rule) => [rule, ""]),
    l.feeNote,
  ];
  return lines.join("\n").trim();
}

/** The summary in every language the site offers: { th, en, zh }. */
export const bookingSummaries = (r) => Object.fromEntries(Object.keys(L).map((lang) => [lang, bookingSummaryText(r, lang)]));
