import { config } from "../../config/env.js";

// SlipOK (slipok.com) reads the QR printed on a Thai bank transfer slip and asks
// the bank for the real transaction, so an edited or reused screenshot is caught.
// `log: true` makes SlipOK remember each slip (code 1012 on reuse) and `amount`
// makes it compare the transferred amount (code 1013). The receiving account is
// checked against the one set on the SlipOK branch (code 1014).
//
// verifySlip() never throws: it returns
//   { outcome: 'VERIFIED' | 'REJECTED' | 'UNAVAILABLE', code, message, slip, raw }
// UNAVAILABLE = SlipOK or the bank could not answer → a staff member checks it.

const ENDPOINT = "https://api.slipok.com/api/line/apikey";

// SlipOK error codes that mean "this slip is not a valid payment for us".
const REJECT = {
  1005: "ไฟล์ที่ส่งไม่ใช่รูปภาพ",
  1006: "รูปภาพไม่ชัด อ่านสลิปไม่ได้ กรุณาส่งรูปสลิปใหม่",
  1007: "ไม่พบ QR Code ในรูป กรุณาส่งรูปสลิปที่เห็น QR ชัดเจน",
  1008: "QR นี้ไม่ใช่สลิปโอนเงิน",
  1011: "ไม่พบรายการโอนนี้ในระบบธนาคาร",
  1012: "สลิปนี้เคยถูกใช้แล้ว",
  1013: "ยอดเงินในสลิปไม่ตรงกับยอดที่ต้องชำระ",
  1014: "บัญชีผู้รับในสลิปไม่ใช่บัญชีของร้าน",
};

const name = (party) => party?.displayName || party?.name || null;

function normalise(d) {
  if (!d) return null;
  const at = d.transTimestamp
    ? new Date(d.transTimestamp)
    : d.transDate && d.transTime
      ? new Date(`${d.transDate.slice(0, 4)}-${d.transDate.slice(4, 6)}-${d.transDate.slice(6, 8)}T${d.transTime}+07:00`)
      : null;
  return {
    transRef: d.transRef ? String(d.transRef) : null,
    amountMinor: typeof d.amount === "number" ? Math.round(d.amount * 100) : null,
    transferredAt: at && !Number.isNaN(at.getTime()) ? at : null,
    senderName: name(d.sender),
    senderBank: d.sendingBank ?? null,
    receiverName: name(d.receiver),
    receiverAccount: d.receiver?.account?.value ?? null,
    receiverProxy: d.receiver?.proxy?.value ?? null,
  };
}

/** Keeps what staff need to review a slip; drops anything else SlipOK returns. */
const sanitise = (body) => ({
  success: body?.success ?? null,
  code: body?.code ?? null,
  message: body?.message ?? body?.data?.message ?? null,
  data: body?.data ? normalise(body.data) : null,
});

export async function verifySlip({ image, contentType, amountMinor }) {
  if (!config.slipokConfigured) return { outcome: "UNAVAILABLE", code: "NOT_CONFIGURED", message: "Slip check is not configured", slip: null, raw: null };

  const form = new FormData();
  form.append("files", new Blob([image], { type: contentType }), "slip");
  form.append("log", "true");
  form.append("amount", String(amountMinor / 100));

  let res;
  let body;
  try {
    res = await fetch(`${ENDPOINT}/${encodeURIComponent(config.SLIPOK_BRANCH_ID)}`, {
      method: "POST",
      headers: { "x-authorization": config.SLIPOK_API_KEY },
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
    body = await res.json().catch(() => null);
  } catch (err) {
    return { outcome: "UNAVAILABLE", code: "NETWORK", message: err.message, slip: null, raw: null };
  }

  const raw = sanitise(body);
  if (res.ok && body?.success && body.data?.success !== false) {
    return { outcome: "VERIFIED", code: null, message: null, slip: normalise(body.data), raw };
  }
  const code = Number(body?.code);
  if (REJECT[code]) return { outcome: "REJECTED", code: String(code), message: REJECT[code], slip: normalise(body?.data), raw };
  // Quota, auth, bank downtime or "bank has not published this transfer yet" (1010).
  return { outcome: "UNAVAILABLE", code: Number.isFinite(code) ? String(code) : `HTTP_${res.status}`, message: body?.message ?? null, slip: null, raw };
}
