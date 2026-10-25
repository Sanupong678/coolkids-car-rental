// Straight-line distances for delivery alerts and live ETAs.

const R = 6_371_000;
const rad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in metres between two { lat, lng } points. */
export function distanceMeters(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Roads are ~1.3× the straight line in Bangkok; below 10 km/h the car is stopped
// at lights, so a city average is used instead of the live speed.
const ROAD_FACTOR = 1.3;
const CITY_KMH = 30;

/** Minutes left to drive `meters` (straight line) at the current speed. */
export function minutesToDrive(meters, speedKmh) {
  const kmh = speedKmh && speedKmh >= 10 ? Math.min(speedKmh, 80) : CITY_KMH;
  return Math.max(1, Math.ceil(((meters * ROAD_FACTOR) / 1000 / kmh) * 60));
}
