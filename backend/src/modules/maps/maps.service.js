import { config } from "../../config/env.js";
import { AppError, BadRequest } from "../../shared/errors.js";

// Google Maps Platform, called server-side only (the key never reaches the
// browser): Places autocomplete for the address box, place details / geocoding
// for coordinates, Routes for traffic-aware distance and drive time from the
// branch. Without a key the quote falls back to a straight-line estimate from
// GPS coordinates the browser supplies.

const TIMEOUT_MS = 6000;
const ROAD_FACTOR = 1.35; // straight line → typical Bangkok road distance
const FALLBACK_KMH = 30; // average urban speed for the estimate

async function google(url, { method = "GET", body, fieldMask } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      "X-Goog-Api-Key": config.GOOGLE_MAPS_API_KEY,
      ...(fieldMask ? { "X-Goog-FieldMask": fieldMask } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AppError(502, "MAPS_ERROR", data.error?.message ?? "Google Maps request failed");
  return data;
}

/** Address suggestions near the branch. */
export async function autocomplete(input, sessionToken, origin) {
  if (!config.mapsConfigured) throw new AppError(503, "MAPS_NOT_CONFIGURED", "Address search is not configured");
  const data = await google("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    body: {
      input,
      sessionToken,
      languageCode: "th",
      includedRegionCodes: ["th"],
      locationBias: { circle: { center: { latitude: origin.lat, longitude: origin.lng }, radius: 50000 } },
    },
  });
  return (data.suggestions ?? [])
    .filter((s) => s.placePrediction)
    .map(({ placePrediction: p }) => ({
      placeId: p.placeId,
      main: p.structuredFormat?.mainText?.text ?? p.text?.text,
      secondary: p.structuredFormat?.secondaryText?.text ?? "",
      text: p.text?.text,
    }));
}

async function resolvePlace({ placeId, address, sessionToken }) {
  if (placeId) {
    const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`);
    if (sessionToken) url.searchParams.set("sessionToken", sessionToken);
    url.searchParams.set("languageCode", "th");
    const p = await google(url, { fieldMask: "id,formattedAddress,location" });
    return { placeId: p.id, address: p.formattedAddress, lat: p.location.latitude, lng: p.location.longitude };
  }
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.search = new URLSearchParams({ address, region: "th", language: "th", key: config.GOOGLE_MAPS_API_KEY }).toString();
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const data = await res.json();
  const hit = data.results?.[0];
  if (!hit) throw BadRequest("Address not found on Google Maps", { address: ["ไม่พบที่อยู่นี้ใน Google Maps"] });
  return { placeId: hit.place_id, address: hit.formatted_address, lat: hit.geometry.location.lat, lng: hit.geometry.location.lng };
}

// ---------------------------------------------------------------- reverse geocoding
// The map pin the customer drops → a Thai address. Google Geocoding when a key
// is set; otherwise OpenStreetMap Nominatim, whose free service allows about
// one request per second per application: calls are spaced and cached.

const NOMINATIM = "https://nominatim.openstreetmap.org/reverse";
const reverseCache = new Map(); // "lat,lng" rounded to ~1 m → result
let nominatimFree = 0; // earliest time the next Nominatim call may start

async function nominatimReverse(lat, lng) {
  const wait = nominatimFree - Date.now();
  nominatimFree = Math.max(Date.now(), nominatimFree) + 1100;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const url = new URL(NOMINATIM);
  url.search = new URLSearchParams({ format: "jsonv2", lat, lon: lng, zoom: 18, addressdetails: 1, "accept-language": "th" }).toString();
  const res = await fetch(url, {
    headers: { "User-Agent": `CoolkidsCarRental/1.0 (${config.FRONTEND_URL})` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new AppError(502, "MAPS_ERROR", "Address lookup failed");
  const d = await res.json();
  const a = d.address ?? {};
  // Thai order: number, building, road, sub-district, district, province, postcode.
  const parts = [
    [a.house_number, a.building ?? a.amenity ?? a.shop].filter(Boolean).join(" "),
    a.road && `ถนน${a.road.replace(/^ถนน/, "")}`,
    a.quarter ?? a.suburb ?? a.village,
    a.city_district ?? a.district ?? a.town,
    a.city ?? a.state ?? a.province,
    a.postcode,
  ].filter(Boolean);
  return parts.length >= 2 ? parts.join(" ") : (d.display_name ?? "").replace(/,?\s*(ประเทศไทย|Thailand)$/, "");
}

async function googleReverse(lat, lng) {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.search = new URLSearchParams({ latlng: `${lat},${lng}`, language: "th", region: "th", key: config.GOOGLE_MAPS_API_KEY }).toString();
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const data = await res.json().catch(() => ({}));
  const hit = data.results?.find((r) => !r.types?.includes("plus_code")) ?? data.results?.[0];
  if (!hit) throw BadRequest("No address at this point");
  return hit.formatted_address.replace(/\s*ประเทศไทย$/, "");
}

// ---------------------------------------------------------------- place search
// The search box on the map picker: a place name or address → up to 6 places with
// coordinates. Google Places Text Search with a key, else Nominatim (searched on
// submit only: its free service does not allow search-as-you-type).

async function nominatimSearch(q, near) {
  const wait = nominatimFree - Date.now();
  nominatimFree = Math.max(Date.now(), nominatimFree) + 1100;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({
    format: "jsonv2", q, countrycodes: "th", limit: 6, "accept-language": "th",
    // Prefer results around the branch (Bangkok and nearby provinces) without excluding the rest.
    viewbox: `${near.lng - 0.6},${near.lat + 0.6},${near.lng + 0.6},${near.lat - 0.6}`,
  }).toString();
  const res = await fetch(url, {
    headers: { "User-Agent": `CoolkidsCarRental/1.0 (${config.FRONTEND_URL})` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new AppError(502, "MAPS_ERROR", "Place search failed");
  return (await res.json()).map((p) => {
    const parts = String(p.display_name).replace(/,?\s*(ประเทศไทย|Thailand)$/, "").split(/,\s*/);
    return { name: p.name || parts[0], address: parts.slice(p.name ? 1 : 0).join(" "), lat: Number(p.lat), lng: Number(p.lon) };
  });
}

async function googleSearch(q, near) {
  const data = await google("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    fieldMask: "places.displayName,places.formattedAddress,places.location",
    body: {
      textQuery: q, languageCode: "th", regionCode: "th", pageSize: 6,
      locationBias: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 50000 } },
    },
  });
  return (data.places ?? []).map((p) => ({
    name: p.displayName?.text ?? "",
    address: (p.formattedAddress ?? "").replace(/\s*ประเทศไทย$/, ""),
    lat: p.location.latitude,
    lng: p.location.longitude,
  }));
}

export async function searchPlaces(q, near) {
  const places = config.mapsConfigured ? await googleSearch(q, near) : await nominatimSearch(q, near);
  // A long road comes back once per segment: keep one result per name + address.
  const seen = new Set();
  return places.filter((p) => !seen.has(`${p.name}|${p.address}`) && seen.add(`${p.name}|${p.address}`));
}

/** Address text for a map position. */
export async function reverseGeocode(lat, lng) {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (reverseCache.has(key)) return reverseCache.get(key);
  const address = config.mapsConfigured ? await googleReverse(lat, lng) : await nominatimReverse(lat, lng);
  const result = { address, lat, lng, source: config.mapsConfigured ? "google" : "osm" };
  if (reverseCache.size > 2000) reverseCache.delete(reverseCache.keys().next().value);
  reverseCache.set(key, result);
  return result;
}

async function route(origin, dest) {
  const data = await google("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    fieldMask: "routes.distanceMeters,routes.duration",
    body: {
      origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
      destination: { location: { latLng: { latitude: dest.lat, longitude: dest.lng } } },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
    },
  });
  const r = data.routes?.[0];
  if (!r) throw BadRequest("No driving route to this address");
  return { distanceMeters: r.distanceMeters, durationSeconds: Number.parseInt(r.duration, 10) };
}

function haversineMeters(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/**
 * Delivery fee from road distance: free within `freeKm`, then `perKmMinor` per
 * started km, never below `minFeeMinor` once chargeable.
 */
export function deliveryFee(distanceMeters, { freeKm, perKmMinor, minFeeMinor }) {
  const km = distanceMeters / 1000;
  if (km <= freeKm) return 0;
  return Math.max(minFeeMinor, Math.ceil(km - freeKm) * perKmMinor);
}

/**
 * Distance, drive time and fee from the branch to the customer.
 * @param input  { placeId? , address?, lat?, lng?, sessionToken? }
 * @param origin { lat, lng } branch coordinates
 */
export async function quote(input, origin, feePolicy) {
  let place;
  let leg;
  let source;
  if (config.mapsConfigured && (input.placeId || input.address)) {
    place = await resolvePlace(input);
    leg = await route(origin, place);
    source = "google";
  } else if (input.lat != null && input.lng != null) {
    place = { placeId: null, address: input.address ?? null, lat: input.lat, lng: input.lng };
    const meters = Math.round(haversineMeters(origin, place) * ROAD_FACTOR);
    leg = { distanceMeters: meters, durationSeconds: Math.round((meters / 1000 / FALLBACK_KMH) * 3600) };
    source = "estimate";
  } else {
    throw new AppError(422, "LOCATION_REQUIRED", "Pick the address from the list or share your location", {
      address: ["กรุณาเลือกที่อยู่จากรายการ หรือกดใช้ตำแหน่งปัจจุบัน"],
    });
  }
  return {
    ...place,
    distanceMeters: leg.distanceMeters,
    durationSeconds: leg.durationSeconds,
    feeMinor: deliveryFee(leg.distanceMeters, feePolicy),
    source,
  };
}
