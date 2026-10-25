import { api } from './http'

// Back office. The server checks a permission on every call.
const BASE = import.meta.env.VITE_API_BASE ?? '/api/v1'

export const getOverview = (days) => api(`/admin/analytics/overview?days=${days}`).then((r) => r.data)
export const getOperations = (date) => api(`/admin/operations${date ? `?date=${date}` : ''}`).then((r) => r.data)
// `location` (optional) is the acting staff member's position at that moment.
export const setBookingStatus = (id, status, reason, location) =>
  api(`/admin/bookings/${id}/status`, { method: 'POST', body: { status, reason, location: location ?? undefined } }).then((r) => r.data)
export const listDatasets = () => api('/admin/exports').then((r) => r.data)
export const exportUrl = (name, from, to, ext = 'csv') => `${BASE}/admin/exports/${name}.${ext}?from=${from}&to=${to}`

export const listVehicles = () => api('/admin/vehicles').then((r) => r.data)
export const vehicleMeta = () => api('/admin/vehicles/meta').then((r) => r.data)
export const createVehicle = (body) => api('/admin/vehicles', { method: 'POST', body }).then((r) => r.data)
export const updateVehicle = (id, body) => api(`/admin/vehicles/${id}`, { method: 'PATCH', body }).then((r) => r.data)
export const archiveVehicle = (id) => api(`/admin/vehicles/${id}/archive`, { method: 'POST', body: {} }).then((r) => r.data)

/** Raw image upload (JPEG/PNG/WebP ≤ 8 MB) → { url } */
export async function uploadImage(file) {
  const res = await fetch(`${BASE}/admin/uploads`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': file.type }, body: file })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error?.message ?? 'Upload failed')
  return data.data
}

// Dispatch: month calendar, drivers and their live position, printable contract.
export const getDispatchSummary = () => api('/admin/dispatch/summary').then((r) => r.data)
export const getDispatchCalendar = (month) => api(`/admin/dispatch/calendar?month=${month}`).then((r) => r.data)
export const getDispatchStaff = (date) => api(`/admin/dispatch/staff?date=${date}`).then((r) => r.data)
export const assignDriver = (bookingId, staffId) =>
  api(`/admin/bookings/${bookingId}/driver`, { method: 'POST', body: { staffId } }).then((r) => r.data)
export const acceptJob = (bookingId, location) =>
  api(`/admin/bookings/${bookingId}/accept`, { method: 'POST', body: { location: location ?? undefined } }).then((r) => r.data)
export const markArrived = (bookingId, location) =>
  api(`/admin/bookings/${bookingId}/arrived`, { method: 'POST', body: { location: location ?? undefined } }).then((r) => r.data)
export const reportMyLocation = (body) => api('/admin/staff/me/location', { method: 'PUT', body }).then((r) => r.data)
// LINE bookings: staff check documents before the reservation fee is paid.
export const listApprovals = () => api('/admin/approvals').then((r) => r.data)
export const reviewBooking = (id, body) => api(`/admin/bookings/${id}/review`, { method: 'POST', body }).then((r) => r.data)

// PromptPay slips the bank check could not settle.
export const listSlips = (status) => api(`/admin/slips${status ? `?status=${status}` : ''}`).then((r) => r.data)
export const slipImageUrl = (id) => `${BASE}/admin/slips/${id}/image`
export const reviewSlip = (id, body) => api(`/admin/slips/${id}/review`, { method: 'POST', body }).then((r) => r.data)
export const getContractPrint = (bookingId) => api(`/admin/bookings/${bookingId}/contract-print`).then((r) => r.data)

// Operations board: money at hand-over, deposit back, odometer, contract to the customer.
const postJson = (path, body) => api(path, { method: 'POST', body }).then((r) => r?.data)
export const getLedger = (id) => api(`/admin/bookings/${id}/ledger`).then((r) => r.data)
export const collectPayment = (id, body) => postJson(`/admin/bookings/${id}/collect`, body)
export const returnDeposit = (id, body) => postJson(`/admin/bookings/${id}/deposit-return`, body)
export const recordMileage = (id, kind, km) => postJson(`/admin/bookings/${id}/mileage`, { kind, km })
export const sendContract = (id, via, email) => postJson(`/admin/bookings/${id}/send-contract`, { via, email: email || undefined })

// Booking timeline (cars × days) and service / document reminders.
export const getSchedule = (from, to) => api(`/admin/schedule?from=${from}&to=${to}`).then((r) => r.data)
export const getReminders = () => api('/admin/fleet/reminders').then((r) => r.data)
export const completeService = (planId, body) => postJson(`/admin/fleet/plans/${planId}/complete`, body)
export const updatePlan = (planId, body) => api(`/admin/fleet/plans/${planId}`, { method: 'PATCH', body })
export const saveVehicleDocument = (vehicleId, body) => postJson(`/admin/vehicles/${vehicleId}/documents`, body)
export const removeVehicleDocument = (id) => api(`/admin/fleet/documents/${id}`, { method: 'DELETE' })

// Back-office accounts (super admin): sub-admins and the pages they may open.
export const listAccounts = () => api('/admin/accounts').then((r) => r.data)
export const createAccount = (body) => api('/admin/accounts', { method: 'POST', body }).then((r) => r.data)
export const updateAccount = (id, body) => api(`/admin/accounts/${id}`, { method: 'PATCH', body }).then((r) => r.data)
// Who gets the new-booking e-mail (customer details + ID photos).
export const getNotifyEmails = () => api('/admin/notify-emails').then((r) => r.data)
export const saveNotifyEmails = (body) => api('/admin/notify-emails', { method: 'PUT', body }).then((r) => r.data)

// Booking slip (ใบจอง) and receipts (ใบเสร็จรับเงิน).
export const listBookingDocuments = (id) => api(`/admin/bookings/${id}/documents`).then((r) => r.data)
export const signBookingDocument = (id, body) => api(`/admin/bookings/${id}/documents/sign`, { method: 'POST', body })
export const sendBookingDocument = (id, body) => api(`/admin/bookings/${id}/documents/send`, { method: 'POST', body }).then((r) => r.data)
