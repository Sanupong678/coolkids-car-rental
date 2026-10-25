import QRCode from "qrcode";

// Thai QR Payment (PromptPay) payload, EMVCo merchant-presented format.
// A dynamic QR carries the exact amount, so every banking app fills it in and
// the slip that comes back can be matched to one booking total.

const AID = "A000000677010111"; // PromptPay credit transfer
const tlv = (id, value) => `${id}${String(value.length).padStart(2, "0")}${value}`;

/** CRC-16/CCITT-FALSE, as the EMVCo spec requires for tag 63. */
function crc16(s) {
  let crc = 0xffff;
  for (const byte of Buffer.from(s, "utf8")) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Phone 0812345678 → tag 01 "0066812345678"; 13-digit tax id → tag 02; 15-digit e-wallet → tag 03. */
function account(id) {
  const digits = String(id).replace(/\D/g, "");
  if (digits.length === 10) return tlv("01", `0066${digits.slice(1)}`);
  if (digits.length === 13) return tlv("02", digits);
  if (digits.length === 15) return tlv("03", digits);
  throw new Error("Invalid PromptPay id");
}

export function promptpayPayload(id, amountMinor) {
  const body = [
    tlv("00", "01"),
    tlv("01", amountMinor ? "12" : "11"), // 12 = single-use amount, 11 = static
    tlv("29", tlv("00", AID) + account(id)),
    tlv("58", "TH"),
    tlv("53", "764"), // THB
    ...(amountMinor ? [tlv("54", (amountMinor / 100).toFixed(2))] : []),
  ].join("");
  const withCrcTag = `${body}6304`;
  return withCrcTag + crc16(withCrcTag);
}

/** The QR as an SVG data URL (shown and downloadable in the browser without any third-party script). */
export async function promptpayQr(id, amountMinor) {
  const svg = await QRCode.toString(promptpayPayload(id, amountMinor), { type: "svg", errorCorrectionLevel: "M", margin: 2 });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/** "0812345678" → "081-xxx-5678"; ids are shown masked to customers. */
export function maskPromptpayId(id) {
  const d = String(id).replace(/\D/g, "");
  return d.length === 10 ? `${d.slice(0, 3)}-xxx-${d.slice(6)}` : `${"x".repeat(d.length - 4)}${d.slice(-4)}`;
}

/**
 * Strict version of maskedAccountMatches(): true only when at least three digits
 * are visible, the length fits and every visible digit matches. A slip must pass
 * this (proxy or bank account) before it may confirm a booking without staff.
 */
export function maskedAccountConfirms(masked, id) {
  const m = String(masked ?? "").replace(/[^0-9xX*]/g, "").toLowerCase().replace(/\*/g, "x");
  let digits = String(id ?? "").replace(/\D/g, "");
  if (!digits || (m.match(/\d/g) ?? []).length < 3) return false;
  if (digits.length === 10 && m.length === 11 && m.startsWith("66")) digits = `66${digits.slice(1)}`;
  return m.length === digits.length && [...m].every((c, i) => c === "x" || c === digits[i]);
}

/**
 * Does the PromptPay proxy printed on a slip ("xxx-xxx-5678", "66xxxxx5678")
 * fit our id? Only for the proxy, never the bank account number behind it.
 * Banks mask different digits, so only the visible digits are compared,
 * position by position. No visible digits or another length → cannot tell → true.
 */
export function maskedAccountMatches(masked, id) {
  const m = String(masked ?? "").replace(/[^0-9xX*]/g, "").toLowerCase().replace(/\*/g, "x");
  if (!/\d/.test(m)) return true;
  let digits = String(id).replace(/\D/g, "");
  // Phone proxies are often printed in international form (66812345678).
  if (digits.length === 10 && m.length === 11 && m.startsWith("66")) digits = `66${digits.slice(1)}`;
  if (m.length !== digits.length) return true; // different numbering (bank account vs phone): leave it to the bank check
  return [...m].every((c, i) => c === "x" || c === digits[i]);
}
