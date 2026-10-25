import { api, ApiError } from './http'
import { t } from '@/i18n'

// Customer booking flow: details → contract → payment → tracking.
const post = (path, body) => api(path, { method: 'POST', body })

export const listMyBookings = () => api('/bookings').then((r) => r.data)
export const getBooking = (number) => api(`/bookings/${number}`).then((r) => r.data)
export const createBooking = (body) => post('/bookings', body).then((r) => r.data)
export const getContract = (number) => api(`/bookings/${number}/contract`).then((r) => r.data)
export const signContract = (number, signature) => post(`/bookings/${number}/contract/sign`, { accepted: true, signature }).then((r) => r.data)
export const startCheckout = (number, locale) => post(`/bookings/${number}/checkout`, { locale }).then((r) => r.data)
export const startBalanceCheckout = (number, locale) => post(`/bookings/${number}/balance/checkout`, { locale }).then((r) => r.data)
export const verifyPayment = (number, sessionId) => post(`/bookings/${number}/payment/verify`, { sessionId }).then((r) => r.data)
export const submitForReview = (number) => post(`/bookings/${number}/submit`, {}).then((r) => r.data)
// Booking slip and receipts of the customer's own booking (PDF).
export const getMyDocuments = (number) => api(`/bookings/${number}/documents`).then((r) => r.data)
export const myDocumentPdfUrl = (number, kind, receipt) => `${BASE}/bookings/${number}/documents/pdf?kind=${kind}${receipt ? `&receipt=${receipt}` : ''}`
export const getTracking = (number) => api(`/bookings/${number}/tracking`).then((r) => r.data)
export const getPromptpay = (number) => api(`/bookings/${number}/promptpay`).then((r) => r.data)
export const reverseGeocode = (lat, lng) => api(`/maps/reverse?lat=${lat}&lng=${lng}`).then((r) => r.data)
export const searchPlaces = (q) => api(`/maps/search?q=${encodeURIComponent(q)}`).then((r) => r.data)
export const quoteDelivery = (body, vehicleSlug) =>
  post(`/delivery/quote${vehicleSlug ? `?vehicle=${encodeURIComponent(vehicleSlug)}` : ''}`, body).then((r) => r.data)
export const getMockPayment = (id) => api(`/payments/mock/${id}`).then((r) => r.data)
export const completeMockPayment = (id, outcome) => post(`/payments/mock/${id}/complete`, { outcome }).then((r) => r.data)

// Identity document photos (private). Upload is a raw image body; viewing goes
// through the API so the private bucket is never exposed.
const BASE = import.meta.env.VITE_API_BASE ?? '/api/v1'
export const documentUrl = (number, kind) => `${BASE}/bookings/${number}/documents/${kind}`
export const contractPdfUrl = (number, { download = false } = {}) => `${BASE}/bookings/${number}/contract.pdf${download ? '?download=1' : ''}`
/** PromptPay slip (raw image) → { status: VERIFIED | NEEDS_REVIEW | REJECTED, reason, booking } */
export async function uploadSlip(number, blob) {
  const res = await fetch(`${BASE}/bookings/${number}/slip`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': blob.type }, body: blob })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data)
  return data.data
}
export async function uploadDocument(number, kind, blob) {
  const res = await fetch(documentUrl(number, kind), { method: 'PUT', credentials: 'include', headers: { 'Content-Type': blob.type }, body: blob })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error?.message ?? t('misc.uploadFail'))
  return data.data
}
