import { NotFound } from "../../shared/errors.js";
import { getSettings, vehicleFeePolicy } from "../../shared/settings.js";
import * as repo from "./catalogue.repository.js";

/**
 * Display price for listing cards: base daily rate and, when a running
 * auto-applied promotion targets the vehicle, the discounted daily rate.
 * This is advertising only — the booking quote is computed by the pricing
 * engine at checkout (business rules 12–13).
 */
export function displayPrice(row) {
  const base = row.daily_rate_minor;
  let discountPerDay = 0;
  if (row.promo_type === "PERCENT") {
    discountPerDay = Math.floor((base * row.promo_value) / 10_000);
    if (row.promo_max) discountPerDay = Math.min(discountPerDay, row.promo_max);
  } else if (row.promo_type === "FIXED_PER_DAY") {
    discountPerDay = Math.min(row.promo_value, base);
  }
  return {
    currency: row.currency,
    dailyMinor: base,
    discountedDailyMinor: discountPerDay > 0 ? base - discountPerDay : null,
    discountPercent: discountPerDay > 0 ? Math.round((discountPerDay / base) * 100) : null,
    depositMinor: row.deposit_minor,
  };
}

const promotionDto = (row) =>
  row.promo_id
    ? {
        id: row.promo_id,
        slug: row.promo_slug,
        name: row.promo_name,
        type: row.promo_type,
        value: row.promo_value,
        minRentalDays: row.promo_min_days,
        endsAt: row.promo_ends_at,
      }
    : null;

export const vehicleCardDto = (row) => ({
  id: row.id,
  slug: row.slug,
  brand: row.brand,
  model: row.model,
  trim: row.trim,
  year: row.model_year,
  category: { slug: row.category_slug, name: row.category_name },
  specs: {
    transmission: row.transmission,
    fuel: row.fuel_type,
    drive: row.drive_type,
    seats: row.seats,
    doors: row.doors,
    luggageLiters: row.luggage_liters,
    powerHp: row.power_hp,
    rangeKm: row.range_km,
  },
  image: row.image_url ? { url: row.image_url, variants: row.image_variants, alt: row.image_alt } : null,
  price: displayPrice(row),
  promotion: promotionDto(row),
  minRentalDays: row.min_rental_days,
  isFeatured: row.is_featured,
});

export async function listVehicles(filters) {
  const { rows, total } = await repo.listVehicles(filters);
  return {
    data: rows.map(vehicleCardDto),
    page: { page: filters.page, pageSize: filters.pageSize, total, pages: Math.ceil(total / filters.pageSize) },
  };
}

export async function getVehicle(slug) {
  const row = await repo.findVehicleBySlug(slug);
  if (!row) throw NotFound("Vehicle");
  const settings = await getSettings();
  return {
    ...vehicleCardDto(row),
    description: row.description,
    color: row.color,
    specs: {
      ...vehicleCardDto(row).specs,
      engineCc: row.engine_displacement_cc,
      torqueNm: row.torque_nm,
      batteryKwh: row.battery_kwh != null ? Number(row.battery_kwh) : null,
      fuelEconomy: row.fuel_economy_l_100km != null ? Number(row.fuel_economy_l_100km) : null,
      lengthMm: row.length_mm,
      widthMm: row.width_mm,
      heightMm: row.height_mm,
      wheelbaseMm: row.wheelbase_mm,
    },
    rental: {
      minDays: row.min_rental_days,
      maxDays: row.max_rental_days,
      minDriverAge: row.min_driver_age,
      hourlyMinor: row.hourly_rate_minor,
    },
    homeLocation: row.home_location,
    // Delivery fee shown on the car page and the booking form: free km, then per km, with a minimum.
    delivery: vehicleFeePolicy(settings, row),
    features: row.features,
    images: row.images,
    models3d: row.models_3d,
  };
}

export async function getAvailability(slug, { from, to }) {
  const row = await repo.findVehicleBySlug(slug);
  if (!row) throw NotFound("Vehicle");
  return repo.vehicleAvailability(row.id, from, to);
}

export const facets = () => repo.vehicleFacets();
export const categories = () => repo.listCategories();
export const locations = () => repo.listLocations();
export const promotions = () => repo.listActivePromotions();
