// Great-circle distance in km (straight line — road distance comes from the routing API).
export function distanceKm(a, b) {
  if (a?.lat == null || b?.lat == null) return null
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

export const fmtKm = (km) => (km == null ? '—' : km < 1 ? `${Math.round(km * 1000)} ม.` : `${km.toFixed(km < 10 ? 1 : 0)} กม.`)
