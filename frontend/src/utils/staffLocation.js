import { reportMyLocation } from '@/api/admin'

// Staff positions are sent only at moments that matter — opening the back office
// and pressing a job button (รับงาน / ออกส่งรถ / ส่งมอบแล้ว …). The one exception
// is a driver on a delivery: TripSharing.vue streams their GPS until hand-over so
// the customer can follow the car. Nothing runs while idle.

/** One GPS fix, or null (no permission / no signal / too slow). Never throws. */
export function currentPosition({ timeout = 6000 } = {}) {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return Promise.resolve(null)
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude, accuracy: Math.round(coords.accuracy) }),
      () => resolve(null),
      { enableHighAccuracy: true, maximumAge: 60_000, timeout },
    )
  })
}

const KEY = 'ck.lastVisitPosition'
const VISIT_GAP_MS = 10 * 60_000

/** On entering the back office: report where this staff member is (at most every 10 minutes). */
export async function reportOnVisit() {
  try {
    if (Date.now() - Number(sessionStorage.getItem(KEY) ?? 0) < VISIT_GAP_MS) return
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    /* storage blocked: report anyway */
  }
  const pos = await currentPosition()
  if (pos) await reportMyLocation(pos).catch(() => {})
}
