// Idempotent seed: safe to run repeatedly. Upserts reference data (RBAC,
// settings, CMS defaults) and inserts demo fleet/promotions only when missing.
//   npm run db:seed
import { fileURLToPath } from "node:url";
import { pool, withTransaction } from "./pool.js";
import { ROLES } from "../modules/rbac/permissions.js";

async function seedRbac(db) {
  const allPerms = [...new Set(Object.values(ROLES).flatMap((r) => r.permissions))];
  for (const code of allPerms) {
    await db.query("INSERT INTO permissions (code) VALUES ($1) ON CONFLICT (code) DO NOTHING", [code]);
  }
  for (const [code, role] of Object.entries(ROLES)) {
    const { rows } = await db.query(
      `INSERT INTO roles (code, name, description, is_system) VALUES ($1, $2, $3, true)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
       RETURNING id`,
      [code, role.name, role.description],
    );
    // Make the role's grants exactly match the code definition.
    await db.query("DELETE FROM role_permissions WHERE role_id = $1", [rows[0].id]);
    await db.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions WHERE code = ANY($2::text[])`,
      [rows[0].id, role.permissions],
    );
  }
}

async function upsertSetting(db, table, key, value) {
  await db.query(
    `INSERT INTO ${table} (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
    [key, JSON.stringify(value)],
  );
}

async function seedSettings(db) {
  const settings = {
    "pricing.currency": "USD",
    "pricing.tax_rate_bps": 700, // 7.00%
    "pricing.tax_inclusive": false,
    "pricing.one_way_fee_minor": 5000,
    "pricing.delivery_fee_minor": 3000,
    "pricing.extra_hour_grace_minutes": 59, // up to 59 min late is free
    "booking.hold_minutes": 15, // PENDING → EXPIRED if unpaid
    "booking.min_lead_time_hours": 2,
    "booking.max_advance_days": 365,
    "booking.cancellation_policy": { free_until_hours_before: 48, late_cancel_fee_pct: 50 },
  };
  for (const [k, v] of Object.entries(settings)) await upsertSetting(db, "system_settings", k, v);

  const content = {
    "site.company": {
      name: "Aurelia Drive",
      tagline: "Premium mobility, delivered.",
      email: "hello@aurelia-drive.example",
      phone: "+66 2 000 0000",
      address: "88 Wireless Road, Lumphini, Bangkok 10330",
    },
    "site.navbar": {
      links: [
        { label: "Fleet", href: "/vehicles" },
        { label: "Offers", href: "/promotions" },
        { label: "Locations", href: "/#locations" },
        { label: "Support", href: "/support" },
      ],
      cta: { label: "Book now", href: "/vehicles" },
    },
    "site.footer": {
      theme: { background: "#0B0C0E", foreground: "#E8E6E1", accent: "#C8A96A" },
      columns: [
        { title: "Company", links: [{ label: "About", href: "/about" }, { label: "Careers", href: "/careers" }] },
        { title: "Rentals", links: [{ label: "Rental terms", href: "/legal/rental-terms" }, { label: "FAQ", href: "/faq" }] },
        { title: "Legal", links: [{ label: "Privacy policy", href: "/legal/privacy" }, { label: "Terms & conditions", href: "/legal/terms" }] },
      ],
      social: [
        { network: "instagram", href: "https://instagram.com/" },
        { network: "facebook", href: "https://facebook.com/" },
        { network: "youtube", href: "https://youtube.com/" },
      ],
      legal_note: "© Aurelia Drive. All rights reserved.",
    },
    "site.theme": {
      colors: { background: "#0B0C0E", surface: "#141519", text: "#E8E6E1", muted: "#8B8D93", accent: "#C8A96A" },
      typography: { display: "Unbounded", body: "Inter" },
      motion: { enabled: true, intensity: "standard" },
    },
  };
  for (const [k, v] of Object.entries(content)) await upsertSetting(db, "website_content", k, v);

  const { rows } = await db.query("SELECT count(*)::int AS n FROM homepage_sections");
  if (rows[0].n === 0) {
    const sections = [
      ["hero", null, null, { autoplay_video: true, overlay_opacity: 0.45 }],
      ["category_slider", "Choose your drive", "From family road trips to track-day thrills.", {}],
      ["featured_vehicles", "Featured fleet", null, { limit: 6 }],
      ["promotions", "Current offers", null, { limit: 3 }],
      ["why_choose_us", "Why Aurelia", null, {
        items: [
          { icon: "sparkles", title: "Premium vehicles", body: "Late-model cars, detailed before every rental." },
          { icon: "receipt", title: "Transparent pricing", body: "Every fee shown before you pay. No surprises." },
          { icon: "bolt", title: "Fast booking", body: "Reserve in under two minutes." },
          { icon: "calendar", title: "Flexible periods", body: "Daily, weekly and monthly rentals." },
          { icon: "wrench", title: "Maintained fleet", body: "Scheduled servicing tracked per vehicle." },
          { icon: "shield", title: "Secure payment", body: "Bank-grade payment processing." },
        ],
      }],
      ["locations_map", "Find us", null, {}],
    ];
    let order = 0;
    for (const [type, title, subtitle, cfg] of sections) {
      const r = await db.query(
        `INSERT INTO homepage_sections (section_type, title, subtitle, config, sort_order, is_published)
         VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
        [type, title, subtitle, JSON.stringify(cfg), (order += 10)],
      );
      if (type === "hero") {
        await db.query(
          `INSERT INTO homepage_banners (section_id, headline, description, cta_primary_text, cta_primary_href,
             cta_secondary_text, cta_secondary_href, animation, is_published)
           VALUES ($1, 'Drive the extraordinary', 'Hand-picked premium cars, delivered to your door.',
                   'Explore cars', '/vehicles', 'Book now', '/vehicles?available=1', $2, true)`,
          [r.rows[0].id, JSON.stringify({ preset: "cinematic-reveal", duration_ms: 1400, parallax: true })],
        );
      }
    }
  }
}

async function seedFleet(db) {
  const locations = [
    ["BKK-HQ", "Aurelia Headquarters", "HEADQUARTERS", "88 Wireless Road", "Bangkok", 13.7380, 100.5480, ["PICKUP", "RETURN", "DELIVERY"], 0],
    ["BKK-BKK", "Suvarnabhumi Airport", "AIRPORT", "Arrivals Hall, Gate 4", "Samut Prakan", 13.6900, 100.7501, ["PICKUP", "RETURN", "AFTER_HOURS_DROP"], 2500],
    ["BKK-SKV", "Sukhumvit Branch", "BRANCH", "1 Sukhumvit Soi 24", "Bangkok", 13.7310, 100.5680, ["PICKUP", "RETURN", "EV_CHARGING"], 0],
  ];
  const hours = { mon: [["08:00", "20:00"]], tue: [["08:00", "20:00"]], wed: [["08:00", "20:00"]], thu: [["08:00", "20:00"]],
                  fri: [["08:00", "20:00"]], sat: [["09:00", "18:00"]], sun: [["09:00", "18:00"]] };
  for (const [code, name, type, addr, city, lat, lng, services, fee] of locations) {
    await db.query(
      `INSERT INTO locations (code, name, location_type, address_line1, city, country_code, latitude, longitude,
         timezone, phone, opening_hours, services, pickup_fee_minor, return_fee_minor)
       VALUES ($1,$2,$3,$4,$5,'TH',$6,$7,'Asia/Bangkok','+66 2 000 0000',$8,$9,$10,$10)
       ON CONFLICT (code) DO NOTHING`,
      [code, name, type, addr, city, lat, lng, JSON.stringify(type === "AIRPORT" ? { all: [["00:00", "24:00"]] } : hours), services, fee],
    );
  }

  const categories = [
    ["family", "Family Cars", "Space, comfort and safety for every passenger.", 10],
    ["fuel-efficient", "Fuel Efficient Cars", "Hybrids and EVs that go further for less.", 20],
    ["sports", "Sports Cars", "Precision engineering for the pure joy of driving.", 30],
  ];
  for (const [slug, name, desc, order] of categories) {
    await db.query(
      `INSERT INTO vehicle_categories (slug, name, description, sort_order) VALUES ($1,$2,$3,$4)
       ON CONFLICT (slug) WHERE deleted_at IS NULL DO NOTHING`,
      [slug, name, desc, order],
    );
  }

  const features = [
    ["adaptive_cruise", "Adaptive cruise control", "SAFETY", "gauge"],
    ["lane_keep", "Lane keeping assist", "SAFETY", "road"],
    ["blind_spot", "Blind-spot monitoring", "SAFETY", "eye"],
    ["camera_360", "360° camera", "SAFETY", "camera"],
    ["carplay", "Apple CarPlay / Android Auto", "TECHNOLOGY", "smartphone"],
    ["premium_audio", "Premium audio", "TECHNOLOGY", "speaker"],
    ["heated_seats", "Heated seats", "COMFORT", "flame"],
    ["leather", "Leather interior", "INTERIOR", "armchair"],
    ["panoramic_roof", "Panoramic roof", "EXTERIOR", "sun"],
    ["third_row", "Third-row seating", "INTERIOR", "users"],
    ["launch_control", "Launch control", "PERFORMANCE", "flag"],
    ["dc_fast_charge", "DC fast charging", "TECHNOLOGY", "plug"],
  ];
  for (const [code, name, group, icon] of features) {
    await db.query(
      "INSERT INTO features (code, name, feature_group, icon) VALUES ($1,$2,$3,$4) ON CONFLICT (code) DO NOTHING",
      [code, name, group, icon],
    );
  }

  // [category, brand, model, trim, year, plate, transmission, fuel, drive, seats, daily, deposit, hp, features, featured]
  const vehicles = [
    ["family", "Kia", "Carnival", "Signature", 2025, "AD-1001", "AUTOMATIC", "HYBRID", "FWD", 7, 11000, 30000, 242, ["adaptive_cruise", "camera_360", "third_row", "carplay"], false],
    ["family", "Volvo", "XC90", "Ultimate B6", 2025, "AD-1002", "AUTOMATIC", "HYBRID", "AWD", 7, 16000, 50000, 295, ["adaptive_cruise", "lane_keep", "panoramic_roof", "third_row", "premium_audio"], true],
    ["family", "Toyota", "Sienna", "Platinum", 2025, "AD-1003", "AUTOMATIC", "HYBRID", "AWD", 8, 12000, 30000, 245, ["adaptive_cruise", "third_row", "heated_seats"], false],
    ["fuel-efficient", "Toyota", "Prius", "Limited", 2025, "AD-2001", "AUTOMATIC", "HYBRID", "FWD", 5, 6500, 20000, 196, ["adaptive_cruise", "carplay"], false],
    ["fuel-efficient", "Tesla", "Model 3", "Long Range", 2025, "AD-2002", "AUTOMATIC", "ELECTRIC", "AWD", 5, 9500, 30000, 394, ["adaptive_cruise", "panoramic_roof", "dc_fast_charge", "premium_audio"], true],
    ["fuel-efficient", "Honda", "Civic", "e:HEV", 2025, "AD-2003", "AUTOMATIC", "HYBRID", "FWD", 5, 6000, 20000, 200, ["lane_keep", "carplay"], false],
    ["sports", "Porsche", "911", "Carrera S", 2025, "AD-3001", "AUTOMATIC", "PETROL", "RWD", 4, 45000, 200000, 473, ["launch_control", "leather", "premium_audio"], true],
    ["sports", "BMW", "M4", "Competition", 2025, "AD-3002", "AUTOMATIC", "PETROL", "AWD", 4, 30000, 150000, 523, ["launch_control", "leather", "heated_seats", "camera_360"], true],
    ["sports", "Ford", "Mustang", "GT", 2025, "AD-3003", "MANUAL", "PETROL", "RWD", 4, 18000, 100000, 480, ["launch_control", "carplay"], false],
  ];
  const hq = (await db.query("SELECT id FROM locations WHERE code = 'BKK-HQ'")).rows[0].id;
  for (const [cat, brand, model, trim, year, plate, trans, fuel, drive, seats, daily, deposit, hp, feats, featured] of vehicles) {
    const slug = `${brand}-${model}-${trim}-${year}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "");
    const { rows } = await db.query(
      `INSERT INTO vehicles (category_id, slug, brand, model, trim, model_year, license_plate, transmission, fuel_type,
         drive_type, seats, doors, daily_rate_minor, hourly_rate_minor, deposit_minor, power_hp, home_location_id,
         current_location_id, status, is_featured, service_interval_km, service_interval_days,
         battery_kwh, range_km, description)
       SELECT c.id, $2, $3, $4, $5, $6::smallint, $7, $8, $9::text, $10, $11::smallint, CASE WHEN $11::smallint <= 4 THEN 2 ELSE 4 END,
              $12::bigint, ceil($12::bigint / 6.0)::bigint, $13, $14, $15::uuid, $15::uuid, 'ACTIVE', $16, 10000, 180,
              CASE WHEN $9 = 'ELECTRIC' THEN 82 END, CASE WHEN $9 = 'ELECTRIC' THEN 629 END,
              $17
         FROM vehicle_categories c WHERE c.slug = $1 AND c.deleted_at IS NULL
       ON CONFLICT (slug) WHERE deleted_at IS NULL DO NOTHING
       RETURNING id`,
      [cat, slug, brand, model, trim, year, plate, trans, fuel, drive, seats, daily, deposit, hp, hq, featured,
       `The ${year} ${brand} ${model} ${trim} — ${hp} hp, ${seats} seats.`],
    );
    if (rows[0]) {
      await db.query(
        `INSERT INTO vehicle_features (vehicle_id, feature_id) SELECT $1, id FROM features WHERE code = ANY($2::text[])`,
        [rows[0].id, feats],
      );
    }
  }

  const addOns = [
    ["full_cover", "Full coverage insurance", "INSURANCE", "PER_DAY", 2500, 1, false],
    ["child_seat", "Child seat", "EQUIPMENT", "PER_DAY", 800, 3, true],
    ["extra_driver", "Additional driver", "SERVICE", "PER_BOOKING", 2000, 2, true],
    ["wifi_hotspot", "Portable Wi-Fi", "EQUIPMENT", "PER_DAY", 500, 1, true],
  ];
  for (const [code, name, kind, unit, price, maxQ, taxable] of addOns) {
    await db.query(
      `INSERT INTO add_on_services (code, name, kind, pricing_unit, price_minor, max_quantity, is_taxable)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (code) DO NOTHING`,
      [code, name, kind, unit, price, maxQ, taxable],
    );
  }
}

async function seedPromotionsAndContracts(db) {
  await db.query(
    `INSERT INTO promotions (slug, name, description, terms, discount_type, discount_value, applies_to_all,
       min_rental_days, starts_at, ends_at, status, is_featured, priority)
     VALUES ('track-season', 'Track Season', '20% off every sports car for rentals of 3+ days.',
             'Valid for rentals starting within the promotion window. Not combinable.',
             'PERCENT', 2000, false, 3, now() - interval '1 day', now() + interval '30 days', 'ACTIVE', true, 10)
     ON CONFLICT (slug) WHERE deleted_at IS NULL DO NOTHING`,
  );
  await db.query(
    `INSERT INTO promotion_categories (promotion_id, category_id)
     SELECT p.id, c.id FROM promotions p, vehicle_categories c
      WHERE p.slug = 'track-season' AND c.slug = 'sports'
     ON CONFLICT DO NOTHING`,
  );

  // Placeholder template; the real contract text will be supplied later and
  // published as version 2 without touching booking code.
  await db.query(
    `INSERT INTO contract_templates (code, version, locale, title, body, status, published_at)
     VALUES ('standard_rental', 1, 'en', 'Vehicle Rental Agreement', $1, 'PUBLISHED', now())
     ON CONFLICT (code, version, locale) DO NOTHING`,
    [`<h1>Vehicle Rental Agreement {{contract.number}}</h1>
<p>Between {{company.name}} and {{customer.legal_name}} (licence ****{{customer.license_last4}}).</p>
<p>Vehicle: {{vehicle.year}} {{vehicle.brand}} {{vehicle.model}} — plate {{vehicle.plate}}.</p>
<p>Period: {{booking.pickup_at}} at {{booking.pickup_location}} to {{booking.return_at}} at {{booking.return_location}}.</p>
{{#each pricing.items}}<p>{{this.description}}: {{this.amount}}</p>{{/each}}
<p><strong>Total: {{pricing.total}}</strong> · Deposit: {{pricing.deposit}}</p>
<section>{{{terms}}}</section>`],
  );
}

// Demo photography (Unsplash licence, free to use). Replace via the admin
// media library in production; files then live in our own bucket/CDN.
const unsplash = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&q=80`;
const PHOTOS = {
  "porsche-911": ["photo-1716738703767-e277c57b2a90", "Black Porsche 911 in a garage"],
  "bmw-m4": ["photo-1614026480209-cd9934144671", "Blue BMW M4 on the road"],
  "ford-mustang": ["photo-1547744152-14d985cb937f", "Black Ford Mustang coupe"],
  "volvo-xc90": ["photo-1557323137-bd6bd20fe022", "Red Volvo SUV in the countryside"],
  "kia-carnival": ["photo-1776774853502-11e7a46252d8", "White minivan"],
  "toyota-sienna": ["photo-1648902180388-e52c0fdebcd4", "Grey minivan parked by a house"],
  "toyota-prius": ["photo-1740982880890-a4768e05a875", "White hybrid hatchback"],
  "tesla-model-3": ["photo-1610470832703-95d40c3fad55", "White Tesla Model 3"],
  "honda-civic": ["photo-1594070319944-7c0cbebb6f58", "Black Honda Civic"],
  "cat-family": ["photo-1653022779664-3a9d0616548c", "Grey SUV by the ocean"],
  "cat-fuel-efficient": ["photo-1560958089-b8a1929cea89", "White electric sedan in the mountains"],
  "cat-sports": ["photo-1728060838443-691dc6279245", "Black sports car with lights on"],
  hero: ["photo-1618418721668-0d1f72aa4bab", "Luxury car front grille at night"],
  "showcase-exterior": ["photo-1614162692292-7ac56d7f7f1e", "Silver Porsche 911 on the road"],
  "showcase-interior": ["photo-1758411897888-3ca658535fdf", "Leather interior with navigation screen"],
  "showcase-detail": ["photo-1616761879141-f485e5fed5df", "Headlight detail"],
  "promo-band": ["photo-1645400379459-f6fd3d963fd4", "Sports car in a dark studio"],
};

async function upsertMedia(db, key) {
  const [id, alt] = PHOTOS[key];
  const { rows } = await db.query(
    `INSERT INTO media (media_type, storage_provider, storage_key, file_url, thumbnail_url, mime_type, file_size_bytes,
                        alt_text, variants)
     VALUES ('IMAGE', 'unsplash', $1, $2, $3, 'image/jpeg', 0, $4, $5)
     ON CONFLICT (storage_key) DO UPDATE SET alt_text = EXCLUDED.alt_text
     RETURNING id, file_url`,
    [`unsplash/${id}`, `${unsplash(id)}&w=1600`, `${unsplash(id)}&w=480`, alt,
     JSON.stringify({ w480: `${unsplash(id)}&w=480`, w960: `${unsplash(id)}&w=960`,
                      w1600: `${unsplash(id)}&w=1600`, w2400: `${unsplash(id)}&w=2400` })],
  );
  return rows[0];
}

// Approximate published figures for the demo fleet (engine cc, torque Nm,
// length/width/height/wheelbase mm, luggage L, L/100 km). Filled only where empty.
const DEMO_SPECS = {
  "porsche-911": [2981, 530, 4542, 1852, 1301, 2450, 132, 10.5],
  "bmw-m4": [2993, 650, 4801, 1887, 1393, 2857, 440, 10.2],
  "ford-mustang": [5038, 567, 4811, 1916, 1397, 2720, 382, 12.4],
  "volvo-xc90": [1969, 420, 4953, 1931, 1773, 2984, 302, 8.3],
  "kia-carnival": [1598, 367, 5155, 1995, 1775, 3090, 627, 6.8],
  "toyota-sienna": [2487, 239, 5175, 1993, 1775, 3060, 949, 6.5],
  "toyota-prius": [1987, 188, 4600, 1780, 1430, 2750, 284, 4.0],
  "tesla-model-3": [null, 493, 4720, 1849, 1441, 2875, 594, null],
  "honda-civic": [1993, 315, 4551, 1802, 1415, 2733, 404, 4.7],
};

async function seedDemoSpecs(db) {
  for (const [prefix, [cc, nm, len, wid, hgt, wb, lug, econ]] of Object.entries(DEMO_SPECS)) {
    await db.query(
      `UPDATE vehicles SET engine_displacement_cc = $2, torque_nm = $3, length_mm = $4, width_mm = $5, height_mm = $6,
              wheelbase_mm = $7, luggage_liters = $8, fuel_economy_l_100km = $9
        WHERE slug LIKE $1 || '%' AND length_mm IS NULL`,
      [prefix, cc, nm, len, wid, hgt, wb, lug, econ],
    );
  }
}

async function seedMedia(db) {
  for (const key of Object.keys(PHOTOS)) await upsertMedia(db, key);
  const mediaId = async (key) => (await upsertMedia(db, key)).id;

  // Vehicle primary images, matched by slug prefix.
  const { rows: vehicles } = await db.query("SELECT id, slug FROM vehicles WHERE deleted_at IS NULL");
  for (const v of vehicles) {
    const key = Object.keys(PHOTOS).find((k) => v.slug.startsWith(k));
    if (!key) continue;
    await db.query(
      `INSERT INTO vehicle_images (vehicle_id, media_id, role) SELECT $1, $2, 'PRIMARY'
        WHERE NOT EXISTS (SELECT 1 FROM vehicle_images WHERE vehicle_id = $1 AND role = 'PRIMARY' AND deleted_at IS NULL)`,
      [v.id, await mediaId(key)],
    );
  }
  for (const slug of ["family", "fuel-efficient", "sports"]) {
    await db.query(
      "UPDATE vehicle_categories SET image_media_id = $2 WHERE slug = $1 AND image_media_id IS NULL AND deleted_at IS NULL",
      [slug, await mediaId(`cat-${slug}`)],
    );
  }
  await db.query(
    `UPDATE homepage_banners b SET image_media_id = $1
       FROM homepage_sections s WHERE s.id = b.section_id AND s.section_type = 'hero' AND b.image_media_id IS NULL`,
    [await mediaId("hero")],
  );

  // Sections added after the first release — inserted only if missing.
  const extra = [
    ["showcase", "Crafted inside and out", "Every car is detailed, inspected and ready before it reaches you.", 25, {
      exterior: { image: (await upsertMedia(db, "showcase-exterior")).file_url, hotspots: [
        { x: 52, y: 66, title: "Adaptive LED lighting", body: "Matrix headlights that bend with the road." },
        { x: 22, y: 77, title: "Performance wheels", body: "Staggered alloys, freshly balanced every rental." },
        { x: 40, y: 50, title: "Aerodynamic profile", body: "Sculpted lines that cut drag and noise." },
      ] },
      interior: { image: (await upsertMedia(db, "showcase-interior")).file_url, hotspots: [
        { x: 46, y: 40, title: "Navigation & CarPlay", body: "Your phone, your music, your maps." },
        { x: 25, y: 70, title: "Premium leather", body: "Cleaned and sanitised between every guest." },
      ] },
      detail: { image: (await upsertMedia(db, "showcase-detail")).file_url },
    }],
    ["promo_band", null, null, 45, { image: (await upsertMedia(db, "promo-band")).file_url }],
    ["brand_strip", "Brands in our fleet", null, 55, {}],
  ];
  for (const [type, title, subtitle, order, cfg] of extra) {
    await db.query(
      `INSERT INTO homepage_sections (section_type, title, subtitle, config, sort_order, is_published)
       SELECT $1, $2, $3, $4, $5, true WHERE NOT EXISTS (SELECT 1 FROM homepage_sections WHERE section_type = $1)`,
      [type, title, subtitle, JSON.stringify(cfg), order],
    );
  }
}

/** Roles, permissions and settings only: what a real shop database needs (see setup.js). */
export async function seedReference() {
  await withTransaction(async (db) => {
    await seedRbac(db);
    await seedSettings(db);
  });
}

/** Reference data + the demo fleet, promotions and media (tests and local development). */
export async function seed() {
  await withTransaction(async (db) => {
    await seedRbac(db);
    await seedSettings(db);
    await seedFleet(db);
    await seedPromotionsAndContracts(db);
    await seedMedia(db);
    await seedDemoSpecs(db);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed()
    .then(() => console.log("✓ seed complete"))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
