import { api } from './http'

// Catalogue + CMS reads. Query objects are serialised with arrays as CSV and
// empty values dropped, matching the backend zod schemas.
function qs(params = {}) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue
    sp.set(k, Array.isArray(v) ? v.join(',') : String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

export const getSiteContent = () => api('/content/site').then((r) => r.data)
export const getHomepage = () => api('/content/homepage').then((r) => r.data)
export const getCategories = () => api('/categories').then((r) => r.data)
export const getLocations = () => api('/locations').then((r) => r.data)
export const getPromotions = () => api('/promotions').then((r) => r.data)
export const getFacets = () => api('/vehicles/facets').then((r) => r.data)
export const listVehicles = (filters, { signal } = {}) => api(`/vehicles${qs(filters)}`, { signal })
export const getVehicle = (slug) => api(`/vehicles/${encodeURIComponent(slug)}`).then((r) => r.data)
export const getAvailability = (slug, from, to) =>
  api(`/vehicles/${encodeURIComponent(slug)}/availability${qs({ from, to })}`).then((r) => r.data)
