// Cars booked through the admin only (vehicle.booking.web === false): the customer asks in
// the shop's LINE chat instead of booking on the site. Same message the LINE car card sends.
export const inquiryText = (v) => `สอบถามรายละเอียดการจองรถ ${[v.brand, v.model, v.trim, v.year].filter(Boolean).join(' ')}`

/** LINE chat with the shop, the inquiry already typed in when the OA's @id is known. */
export function lineChatUrl(contact, v) {
  const id = contact?.lineId
  if (id && v) return `https://line.me/R/oaMessage/${encodeURIComponent(id)}/?${encodeURIComponent(inquiryText(v))}`
  return contact?.line ?? (id ? `https://line.me/R/ti/p/${encodeURIComponent(id)}` : null)
}

export const lineOnly = (v) => Boolean(v?.booking && !v.booking.web)
