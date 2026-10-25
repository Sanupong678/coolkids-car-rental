// Wheel positions on the fleet cut-outs (frontend/public/cars/<name>-*.webp),
// measured on the photos: [cx, cy, rx, ry] as % of the image width/height —
// the visible tyre ellipse around the hub. The carousel rotates the pixels
// inside each ellipse so the wheels roll with the car.
export const WHEELS = {
  'bmw-320d': { aspect: 1.4685, wheels: [[42.2, 71.1, 8, 14.8], [11.4, 64.2, 6, 12.8]] },
  'city-ehev': { aspect: 1.8817, wheels: [[38, 77, 9, 17], [8.3, 64, 4.5, 14.5]] },
  'civic-rs': { aspect: 2.2548, wheels: [[52, 72.5, 7.8, 22], [89.5, 69, 5.5, 18.5]] },
  'civic-el': { aspect: 2.2448, wheels: [[49.5, 75, 6, 20], [9.5, 68.5, 5.2, 18]] },
  'hrv-rs': { aspect: 1.9608, wheels: [[47.5, 76, 7, 18.6], [9.5, 70, 5.5, 18]] },
  'hrv-e': { aspect: 1.9191, wheels: [[44, 75, 9, 21], [8, 65, 5.5, 16.3]] },
  'almera': { aspect: 1.9227, wheels: [[57.5, 76, 6.5, 19], [93, 62.5, 3.5, 15]] },
  'corolla-cross': { aspect: 1.8547, wheels: [[43.5, 79, 6.5, 19.5], [9, 68, 5.3, 16.7]] },
  'yaris-ativ': { aspect: 1.6932, wheels: [[62.5, 77, 7, 19.8], [93.3, 52.5, 3.3, 12.2]] },
}

/** Rig for a vehicle image url like /cars/civic-rs-1200.webp, or null. */
export function wheelRig(url) {
  const name = url?.match(/\/cars\/(.+?)-\d+\.webp$/)?.[1]
  return (name && WHEELS[name]) || null
}
