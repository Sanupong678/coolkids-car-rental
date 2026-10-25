// Coolkids Car Rental brand + real fleet. Replaces the Aurelia demo content:
// demo vehicles/categories/locations/sections are soft-deleted (never hard-deleted),
// Coolkids rows are upserted. Idempotent — safe to run repeatedly.
//   npm run db:seed:coolkids
//
// Fleet and prices come from the shop page (thairentalsystem.lovable.app/shop/coolkidscar).
// Car images are background-free cut-outs of freely licensed Wikimedia Commons
// photos (sources + licences in frontend/public/cars/credits.json), bundled in
// src/db/assets/cars and uploaded to the public R2 bucket when it is configured. Technical specs are approximate published figures —
// deposits are placeholders until the owner confirms them.
import { fileURLToPath } from "node:url";
import { pool, withTransaction } from "./pool.js";
import { TEMPLATE } from "../modules/contracts/coolkids-rental.template.js";
import { carPhotosToR2 } from "./car-photos.js";

const BRAND = "coolkids";
const PHONE = "065-365-6514";
const PHONE_2 = "063-640-8891";
const LINE_URL = "https://lin.ee/Xfjk8SU";
const FACEBOOK_URL = "https://www.facebook.com/profile.php?id=61581929401603";

const photo = (name) => ({
  url: `/cars/${name}-1200.webp`,
  thumb: `/cars/${name}-640.webp`,
  variants: { w640: `/cars/${name}-640.webp`, w1200: `/cars/${name}-1200.webp`, w2000: `/cars/${name}-2000.webp` },
});

const thb = (baht) => baht * 100;

// slug, category, brand, model, trim, year, transmission, fuel, drive, seats, daily ฿, deposit ฿, hp, featured,
// photos[], features[], [cc, torque, length, width, height, wheelbase, luggage L, L/100km], description, plate no.
// Categories, names and daily prices follow the shop's price posters (one folder per category); the photos
// are the cars cut out of those posters (assets-src/cars-ck/cut.py). Plate numbers are fixed so re-seeding
// never collides with a car already on the road.
const FLEET = [
  // Eco Car
  ["nissan-almera-2022", "eco", "Nissan", "Almera", "VL Turbo", 2022, "AUTOMATIC", "PETROL", "FWD", 5, 990, 3000, 100, false,
    ["ck-almera-white", "ck-almera-grey"], ["carplay", "first_class_insurance", "unlimited_km"],
    [999, 152, 4495, 1740, 1460, 2620, 482, 4.7],
    "อีโคคาร์เทอร์โบ ราคาประหยัดที่สุดในร้าน ท้ายใหญ่ ประหยัดน้ำมัน เริ่มต้นเพียง 990 บาท/วัน", 8],
  ["honda-city-e-hev-black-outshine-2026", "eco", "Honda", "City", "e:HEV Black Outshine", 2026, "AUTOMATIC", "HYBRID", "FWD", 5, 1290, 5000, 109, false,
    ["ck-city-black-outshine"], ["lane_keep", "carplay", "first_class_insurance", "unlimited_km"],
    [1498, 253, 4553, 1748, 1467, 2600, 519, 3.6],
    "ซีดานไฮบริดรุ่นใหม่ล่าสุด ประหยัดน้ำมันมาก ขับในเมืองคล่องตัว ท้ายกว้างใส่กระเป๋าได้สบาย", 2],
  ["toyota-yaris-ativ-premium-2026", "eco", "Toyota", "Yaris Ativ", "Premium", 2026, "AUTOMATIC", "PETROL", "FWD", 5, 1290, 3000, 94, false,
    ["ck-yaris-ativ-premium"], ["carplay", "first_class_insurance", "unlimited_km"],
    [1197, 110, 4425, 1740, 1480, 2620, 470, 4.9],
    "อีโคคาร์ซีดานรุ่นใหม่ ขับง่าย จอดง่าย ค่าน้ำมันต่ำ เหมาะกับการใช้งานทุกวัน", 4],
  ["toyota-yaris-ativ-sport-2026", "eco", "Toyota", "Yaris Ativ", "Sport", 2026, "AUTOMATIC", "PETROL", "FWD", 5, 1100, 3000, 94, false,
    ["ck-yaris-ativ-sport"], ["carplay", "first_class_insurance", "unlimited_km"],
    [1197, 110, 4425, 1740, 1480, 2620, 470, 4.9],
    "Yaris Ativ รุ่น Sport ขับสนุก ประหยัดน้ำมัน ราคาคุ้มค่าสำหรับใช้งานในเมือง", 10],
  // Premium Car
  ["honda-accord-e-hev-el-plus-2025", "premium", "Honda", "Accord", "e:HEV EL+", 2025, "AUTOMATIC", "HYBRID", "FWD", 5, 2800, 10000, 204, true,
    ["ck-accord-el"], ["adaptive_cruise", "lane_keep", "carplay", "premium_audio", "leather", "first_class_insurance", "unlimited_km"],
    [1993, 335, 4971, 1862, 1450, 2830, 570, 4.4],
    "ซีดานไฮบริดขนาดใหญ่ เบาะหนัง นั่งสบายทั้งคันรถ เงียบและหรูสำหรับงานสำคัญ", 11],
  ["toyota-camry-hev-premium-2025", "premium", "Toyota", "Camry", "HEV Premium", 2025, "AUTOMATIC", "HYBRID", "FWD", 5, 2800, 10000, 230, true,
    ["ck-camry-premium"], ["adaptive_cruise", "lane_keep", "carplay", "premium_audio", "leather", "first_class_insurance", "unlimited_km"],
    [2487, 221, 4915, 1840, 1445, 2825, 524, 4.4],
    "แคมรี่ไฮบริดโฉมใหม่ ภายในหรูหรา ห้องโดยสารกว้าง เหมาะกับการเดินทางไกลและงานสำคัญ", 12],
  ["honda-civic-e-hev-el-plus-2025", "premium", "Honda", "Civic", "e:HEV EL+", 2025, "AUTOMATIC", "HYBRID", "FWD", 5, 2200, 5000, 184, false,
    ["ck-civic-el"], ["adaptive_cruise", "lane_keep", "carplay", "first_class_insurance", "unlimited_km"],
    [1993, 315, 4681, 1802, 1415, 2733, 495, 4.2],
    "ซีวิคไฮบริดรุ่น EL+ นุ่ม เงียบ หรู ตอบโจทย์ทั้งงานและเที่ยว", 6],
  ["honda-civic-e-hev-rs-2026", "premium", "Honda", "Civic", "e:HEV RS", 2026, "AUTOMATIC", "HYBRID", "FWD", 5, 2400, 5000, 184, true,
    ["ck-civic-rs"], ["adaptive_cruise", "lane_keep", "carplay", "premium_audio", "first_class_insurance", "unlimited_km"],
    [1993, 315, 4681, 1802, 1415, 2733, 495, 4.2],
    "ซีวิคไฮบริดตัวท็อป RS แรง เงียบ และประหยัด พร้อมระบบช่วยขับ Honda SENSING ครบชุด", 3],
  // SUV 5 ที่นั่ง
  ["toyota-corolla-cross-gr-sport-2022", "suv-5", "Toyota", "Corolla Cross", "GR Sport", 2022, "AUTOMATIC", "HYBRID", "FWD", 5, 1890, 5000, 122, true,
    ["ck-corolla-cross-gr"], ["adaptive_cruise", "lane_keep", "carplay", "first_class_insurance", "unlimited_km"],
    [1798, 142, 4460, 1825, 1620, 2640, 440, 4.3],
    "ครอสโอเวอร์ไฮบริดสายสปอร์ต ห้องโดยสารกว้าง เก็บเสียงดี เหมาะกับทริปครอบครัวและการเดินทางไกล", 1],
  ["honda-cr-v-e-hev-es-2025", "suv-5", "Honda", "CR-V", "e:HEV ES", 2025, "AUTOMATIC", "HYBRID", "FWD", 5, 2890, 10000, 207, false,
    ["ck-crv-es"], ["adaptive_cruise", "lane_keep", "carplay", "panoramic_roof", "first_class_insurance", "unlimited_km"],
    [1993, 335, 4691, 1866, 1691, 2701, 589, 5.0],
    "SUV ไฮบริดขนาดกลาง ห้องโดยสารกว้าง ท้ายใหญ่ เหมาะกับครอบครัวและทริปต่างจังหวัด", 13],
  ["honda-hr-v-e-hev-e-2025", "suv-5", "Honda", "HR-V", "e:HEV E", 2025, "AUTOMATIC", "HYBRID", "FWD", 5, 2200, 5000, 131, false,
    ["ck-hrv-e"], ["adaptive_cruise", "lane_keep", "carplay", "first_class_insurance", "unlimited_km"],
    [1498, 253, 4330, 1790, 1590, 2610, 335, 3.9],
    "HR-V ไฮบริด ตัวถังยกสูง มองทางชัด นั่งสบายทั้งคันรถ", 7],
  ["honda-hr-v-e-hev-rs-2025", "suv-5", "Honda", "HR-V", "e:HEV RS", 2025, "AUTOMATIC", "HYBRID", "FWD", 5, 2400, 5000, 131, true,
    ["ck-hrv-rs"], ["adaptive_cruise", "lane_keep", "carplay", "panoramic_roof", "first_class_insurance", "unlimited_km"],
    [1498, 253, 4330, 1790, 1590, 2610, 335, 3.9],
    "SUV ไฮบริดดีไซน์โฉบเฉี่ยว หลังคาพาโนรามิก เบาะหลังพับได้ ครบทั้งความสวยและความคุ้ม", 5],
  // SUV 7 ที่นั่ง
  ["toyota-fortuner-leader-2025", "suv-7", "Toyota", "Fortuner", "Leader", 2025, "AUTOMATIC", "DIESEL", "RWD", 7, 2990, 10000, 150, true,
    ["ck-fortuner-leader"], ["lane_keep", "carplay", "first_class_insurance", "unlimited_km"],
    [2393, 400, 4795, 1855, 1835, 2745, 200, 7.4],
    "PPV 7 ที่นั่ง เครื่องดีเซลแรงบิดสูง ช่วงล่างแข็งแรง พร้อมพาครอบครัวใหญ่ไปได้ทุกเส้นทาง", 14],
  ["isuzu-mu-x-active-2025", "suv-7", "Isuzu", "MU-X", "Active", 2025, "AUTOMATIC", "DIESEL", "RWD", 7, 2800, 10000, 150, false,
    ["ck-mux-active"], ["lane_keep", "carplay", "first_class_insurance", "unlimited_km"],
    [1898, 350, 4850, 1870, 1825, 2855, 311, 6.9],
    "SUV 7 ที่นั่ง ประหยัดน้ำมัน นั่งสบายทั้งสามแถว เหมาะกับทริปครอบครัวและเดินทางไกล", 15],
  ["mitsubishi-pajero-sport-2025", "suv-7", "Mitsubishi", "Pajero Sport", null, 2025, "AUTOMATIC", "DIESEL", "RWD", 7, 2800, 10000, 184, false,
    ["ck-pajero-sport"], ["lane_keep", "carplay", "first_class_insurance", "unlimited_km"],
    [2442, 430, 4825, 1815, 1835, 2800, 131, 7.4],
    "PPV 7 ที่นั่งดีไซน์ดุดัน เครื่องแรง ขับขี่มั่นใจ เหมาะกับการเดินทางต่างจังหวัด", 16],
  ["toyota-veloz-2025", "suv-7", "Toyota", "Veloz", null, 2025, "AUTOMATIC", "PETROL", "FWD", 7, 1890, 5000, 106, false,
    ["ck-veloz"], ["carplay", "first_class_insurance", "unlimited_km"],
    [1496, 137, 4475, 1750, 1700, 2750, 498, 6.3],
    "รถ 7 ที่นั่งราคาคุ้มค่า ห้องโดยสารยืดหยุ่น พับเบาะได้หลายแบบ เหมาะกับครอบครัว", 17],
];

// Seeded cars that are no longer on the price list (soft-deleted; bookings keep their history).
const RETIRED = ["bmw-320d-m-sport-2023"];

// slug, name, description, sort order, cover photo
const CATEGORIES = [
  ["eco", "Eco Car", "คุ้มที่สุด เริ่มต้น 990 บาท/วัน", 10, "ck-almera-white"],
  ["premium", "Premium Car", "ซีดานไฮบริดระดับพรีเมียม นุ่ม เงียบ หรู", 20, "ck-camry-premium"],
  ["suv-5", "SUV 5 ที่นั่ง", "นั่งสูง ห้องกว้าง ขับง่ายในเมือง", 30, "ck-hrv-rs"],
  ["suv-7", "SUV 7 ที่นั่ง", "สามแถว สำหรับครอบครัวใหญ่และทริปไกล", 40, "ck-fortuner-leader"],
];

const REVIEWS = {
  recommendPercent: 100,
  count: 8,
  source: "Facebook",
  url: `${FACEBOOK_URL}&sk=reviews`,
  // Verbatim public reviews from the Facebook page. Add the rest here (the
  // others are only visible when signed in to Facebook).
  items: [
    { name: "Jean Ny", date: "2026-06-28", text: "เพิ่งเช่ารถมา25-26มิย.นี้ค่ะ รถใหม่ สะอาดค่ะ ทางร้านบริการดีค่ะ" },
  ],
};

async function upsertContent(db, table, key, value) {
  await db.query(
    `INSERT INTO ${table} (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)],
  );
}

async function upsertMedia(db, name, alt) {
  const p = photo(name);
  const { rows } = await db.query(
    `INSERT INTO media (media_type, storage_provider, storage_key, file_url, thumbnail_url, mime_type, file_size_bytes, alt_text, variants)
     VALUES ('IMAGE', 'local', $1, $2, $3, 'image/webp', 0, $4, $5)
     ON CONFLICT (storage_key) DO UPDATE SET storage_provider = EXCLUDED.storage_provider, file_url = EXCLUDED.file_url,
       thumbnail_url = EXCLUDED.thumbnail_url, variants = EXCLUDED.variants, alt_text = EXCLUDED.alt_text
     RETURNING id`,
    [`${BRAND}/cars/${name}`, p.url, p.thumb, alt, JSON.stringify(p.variants)],
  );
  return rows[0].id;
}

async function seedContent(db) {
  await upsertContent(db, "system_settings", "pricing.currency", "THB");
  const content = {
    "site.company": {
      name: "Coolkids Car Rental",
      tagline: "รถเช่าขับเอง รายวัน รายสัปดาห์ รายเดือน",
      email: null,
      phone: PHONE,
      phone2: PHONE_2,
      address: "ดอนเมือง กรุงเทพฯ · ส่งรถทั่วกรุงเทพ นนทบุรี สมุทรปราการ",
      hours: "ทุกวัน 08:00 – 20:00",
    },
    "site.navbar": {
      links: [
        { label: "หน้าแรก", href: "/" },
        { label: "รถของเรา", href: "/vehicles" },
        { label: "รีวิว", href: "/#reviews" },
        { label: "ติดต่อ", href: "/#locations" },
      ],
      cta: { label: "จองผ่าน LINE", href: LINE_URL },
    },
    "site.footer": {
      columns: [
        { title: "รถของเรา", links: CATEGORIES.map(([slug, name]) => ({ label: name, href: `/vehicles?category=${slug}` })) },
        { title: "บริการ", links: [
          { label: "เช่ารายวัน", href: "/vehicles" },
          { label: "เช่ารายเดือน", href: "/vehicles?sort=price_asc" },
          { label: "บริการส่งรถถึงที่", href: "/#locations" },
        ] },
        { title: "ติดต่อเรา", links: [
          { label: `โทร ${PHONE}`, href: `tel:${PHONE.replaceAll("-", "")}` },
          { label: "LINE @Coolkidscar", href: LINE_URL },
          { label: "Facebook", href: FACEBOOK_URL },
        ] },
      ],
      social: [
        { network: "facebook", href: FACEBOOK_URL },
      ],
      legal_note: "© Coolkids Car Rental. All rights reserved.",
    },
    "site.theme": {
      colors: {},
      typography: { display: "Unbounded", body: "Inter" },
      motion: { enabled: true, intensity: "standard" },
    },
    "site.contact": { phone: PHONE, phone2: PHONE_2, line: LINE_URL, lineId: "@Coolkidscar", facebook: FACEBOOK_URL },
    "site.reviews": REVIEWS,
  };
  for (const [k, v] of Object.entries(content)) await upsertContent(db, "website_content", k, v);
}

async function seedLocation(db) {
  await db.query(
    `UPDATE locations SET is_active = false, deleted_at = now() WHERE deleted_at IS NULL AND code <> 'CK-DMK'`,
  );
  const hours = { all: [["08:00", "20:00"]] };
  const { rows } = await db.query(
    `INSERT INTO locations (code, name, location_type, address_line1, city, country_code, latitude, longitude,
       timezone, phone, opening_hours, services, pickup_fee_minor, return_fee_minor, is_active)
     VALUES ('CK-DMK', 'Coolkids ดอนเมือง', 'HEADQUARTERS', 'เขตดอนเมือง', 'กรุงเทพมหานคร', 'TH', 13.9126, 100.6067,
             'Asia/Bangkok', $1, $2, ARRAY['PICKUP','RETURN','DELIVERY'], 0, 0, true)
     ON CONFLICT (code) DO UPDATE SET is_active = true, deleted_at = NULL, name = EXCLUDED.name
     RETURNING id`,
    [PHONE, JSON.stringify(hours)],
  );
  return rows[0].id;
}

async function seedFleet(db, homeId) {
  // The shop's own photos (with backgrounds) are retired in favour of cut-outs.
  await db.query(`UPDATE media SET deleted_at = now() WHERE storage_key LIKE $1 AND deleted_at IS NULL`, [`${BRAND}/fleet/%`]);
  // Retire the demo fleet (plates AD-*) and the demo promotion.
  await db.query(
    `UPDATE vehicles SET status = 'ARCHIVED', is_featured = false, deleted_at = now()
      WHERE deleted_at IS NULL AND license_plate LIKE 'AD-%'`,
  );
  await db.query(`UPDATE promotions SET status = 'ARCHIVED' WHERE slug = 'track-season'`);
  await db.query(
    `UPDATE vehicles SET status = 'ARCHIVED', is_featured = false, deleted_at = now()
      WHERE deleted_at IS NULL AND slug = ANY($1::text[])`,
    [RETIRED],
  );
  await db.query(
    `UPDATE vehicle_categories SET is_active = false, deleted_at = now()
      WHERE deleted_at IS NULL AND slug <> ALL($1::text[])`,
    [CATEGORIES.map((c) => c[0])],
  );

  for (const [slug, name, desc, order, img] of CATEGORIES) {
    const mediaId = await upsertMedia(db, img, name);
    await db.query(
      `INSERT INTO vehicle_categories (slug, name, description, sort_order, image_media_id) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (slug) WHERE deleted_at IS NULL DO UPDATE
         SET name = EXCLUDED.name, description = EXCLUDED.description, sort_order = EXCLUDED.sort_order,
             image_media_id = EXCLUDED.image_media_id, is_active = true`,
      [slug, name, desc, order, mediaId],
    );
  }

  const extraFeatures = [
    ["first_class_insurance", "ประกันชั้น 1", "COMFORT", "shield"],
    ["unlimited_km", "ขับได้ไม่จำกัดระยะทาง", "COMFORT", "road"],
    ["adaptive_cruise", "ครูสคอนโทรลอัจฉริยะ", "SAFETY", "gauge"],
    ["lane_keep", "ระบบช่วยรักษาช่องทาง", "SAFETY", "road"],
    ["carplay", "Apple CarPlay / Android Auto", "TECHNOLOGY", "smartphone"],
    ["premium_audio", "ระบบเสียงพรีเมียม", "TECHNOLOGY", "speaker"],
    ["panoramic_roof", "หลังคาพาโนรามิก", "EXTERIOR", "sun"],
    ["leather", "เบาะหนัง", "INTERIOR", "armchair"],
  ];
  for (const [code, name, group, icon] of extraFeatures) {
    await db.query(
      `INSERT INTO features (code, name, feature_group, icon) VALUES ($1,$2,$3,$4)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, feature_group = EXCLUDED.feature_group, icon = EXCLUDED.icon`,
      [code, name, group, icon],
    );
  }

  for (const [slug, cat, brand, model, trim, year, trans, fuel, drive, seats, daily, deposit, hp, featured, photos, feats, specs, description, plateNo] of FLEET) {
    const [cc, nm, len, wid, hgt, wb, lug, econ] = specs;
    const { rows } = await db.query(
      `INSERT INTO vehicles (category_id, slug, brand, model, trim, model_year, license_plate, transmission, fuel_type,
         drive_type, seats, doors, currency, daily_rate_minor, hourly_rate_minor, deposit_minor, min_rental_days, power_hp,
         engine_displacement_cc, torque_nm, length_mm, width_mm, height_mm, wheelbase_mm, luggage_liters, fuel_economy_l_100km,
         home_location_id, current_location_id, status, is_featured, service_interval_km, service_interval_days, description)
       SELECT c.id, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 4, 'THB', $12::bigint, ceil($12::bigint / 6.0)::bigint, $13::bigint, 2, $14,
              $15, $16, $17, $18, $19, $20, $21, $22, $23, $23, 'ACTIVE', $24, 10000, 180, $25
         FROM vehicle_categories c WHERE c.slug = $1 AND c.deleted_at IS NULL
       ON CONFLICT (slug) WHERE deleted_at IS NULL DO UPDATE
         SET category_id = EXCLUDED.category_id, daily_rate_minor = EXCLUDED.daily_rate_minor,
             hourly_rate_minor = EXCLUDED.hourly_rate_minor, is_featured = EXCLUDED.is_featured,
             description = EXCLUDED.description, currency = 'THB', trim = EXCLUDED.trim
       RETURNING id`,
      [cat, slug, brand, model, trim, year, `CK-${String(plateNo).padStart(3, "0")}`, trans, fuel, drive, seats,
       thb(daily), thb(deposit), hp, cc, nm, len, wid, hgt, wb, lug, econ, homeId, featured, description],
    );
    const id = rows[0].id;

    await db.query("DELETE FROM vehicle_features WHERE vehicle_id = $1", [id]);
    await db.query(
      `INSERT INTO vehicle_features (vehicle_id, feature_id) SELECT $1, id FROM features WHERE code = ANY($2::text[])`,
      [id, feats],
    );

    await db.query("UPDATE vehicle_images SET deleted_at = now() WHERE vehicle_id = $1 AND deleted_at IS NULL", [id]);
    for (const [i, name] of photos.entries()) {
      const mediaId = await upsertMedia(db, name, `${brand} ${model} ${trim}`);
      await db.query(
        `INSERT INTO vehicle_images (vehicle_id, media_id, role, sort_order) VALUES ($1, $2, $3, $4)
         ON CONFLICT (vehicle_id, media_id) DO UPDATE SET role = EXCLUDED.role, sort_order = EXCLUDED.sort_order, deleted_at = NULL`,
        [id, mediaId, i === 0 ? "PRIMARY" : "GALLERY", i],
      );
    }
  }

  // Fleet numbers (#1, #2 …) in fleet order for cars that have none, and the
  // shop's standard service plan for every car (kept if staff already changed it).
  await db.query(
    `UPDATE vehicles v SET fleet_no = x.n
       FROM (SELECT id, (SELECT COALESCE(max(fleet_no), 0) FROM vehicles WHERE deleted_at IS NULL)
                        + row_number() OVER (ORDER BY created_at, slug) AS n
               FROM vehicles WHERE deleted_at IS NULL AND fleet_no IS NULL) x
      WHERE v.id = x.id`,
  );
  await db.query(
    `INSERT INTO vehicle_maintenance (vehicle_id, maintenance_type, interval_km, interval_days, last_performed_at, last_performed_km, next_due_at, next_due_km)
     SELECT v.id, p.type, p.km, p.days, now(), v.current_odometer_km,
            CASE WHEN p.days IS NOT NULL THEN now() + make_interval(days => p.days) END,
            CASE WHEN p.km IS NOT NULL THEN v.current_odometer_km + p.km END
       FROM vehicles v CROSS JOIN (VALUES ('OIL_CHANGE', 10000, 180), ('TIRE_ROTATION', 10000, NULL),
                                          ('BRAKE_SERVICE', 20000, NULL), ('INSPECTION', NULL, 365)) AS p(type, km, days)
      WHERE v.deleted_at IS NULL
     ON CONFLICT (vehicle_id, maintenance_type) DO NOTHING`,
  );
}

// Hero clip from the Facebook reel (night drive, muted). The plain video backs
// the "video" hero mode; the scroll film uses frontend/public/media/hero-seq
// (frames + car masks cut from assets-src/video/hero-night-drive-square.mov).
async function upsertHeroVideo(db) {
  const row = async (key, url, type, mime, alt) =>
    (await db.query(
      `INSERT INTO media (media_type, storage_provider, storage_key, file_url, mime_type, file_size_bytes, width, height, alt_text)
       VALUES ($1, 'local', $2, $3, $4, 0, 540, 960, $5)
       ON CONFLICT (storage_key) DO UPDATE SET file_url = EXCLUDED.file_url, alt_text = EXCLUDED.alt_text
       RETURNING id`,
      [type, key, url, mime, alt],
    )).rows[0].id;
  const video = await row(`${BRAND}/media/hero-night-drive`, "/media/hero-night-drive.mp4", "VIDEO", "video/mp4",
    "Honda Civic สีขาวของ Coolkids ขับในเมืองตอนกลางคืน เปิดไฟหน้า");
  const poster = await row(`${BRAND}/media/hero-night-drive-poster`, "/media/hero-night-drive-poster.jpg", "IMAGE", "image/jpeg",
    "Honda Civic สีขาวเปิดไฟหน้าตอนกลางคืน");
  await db.query(
    `UPDATE homepage_banners b SET video_media_id = $1, poster_media_id = $2, image_media_id = $2
       FROM homepage_sections s
      WHERE s.id = b.section_id AND s.section_type = 'hero' AND s.deleted_at IS NULL AND s.config->>'brand' = $3`,
    [video, poster, BRAND],
  );
}

async function seedHomepage(db) {
  await db.query(
    `UPDATE homepage_sections SET deleted_at = now()
      WHERE deleted_at IS NULL AND COALESCE(config->>'brand', '') <> $1`,
    [BRAND],
  );
  const sections = [
    ["hero", null, null, { motion: "video-bg", video: "/media/hero-studio.mp4", poster: "/media/hero-studio-poster.jpg" }],
    ["category_slider", "เลือกรถตามสไตล์", "ทุกคันเป็นรถใหม่ ประกันชั้น 1 ขับได้ไม่จำกัดระยะทาง", {}],
    ["featured_vehicles", "รถยอดนิยม", null, { limit: 4 }],
    ["why_choose_us", "ทำไมต้อง Coolkids", null, {
      items: [
        { icon: "shield", title: "ประกันชั้น 1 ทุกคัน", body: "คุ้มครองเต็มวงเงิน อุ่นใจตลอดการเดินทาง" },
        { icon: "sparkles", title: "รถสะอาด พร้อมใช้งาน", body: "ทำความสะอาดและตรวจสภาพก่อนส่งมอบทุกคัน" },
        { icon: "calendar", title: "เปิดบริการ 7 วัน", body: "ตอบไว จองง่าย รับรถได้ตามนัด 08:00 – 20:00" },
        { icon: "receipt", title: "ราคาชัดเจน", body: "แจ้งราคารวมทุกอย่างตั้งแต่แรก ไม่มีบวกเพิ่ม" },
      ],
    }],
    ["reviews", "ลูกค้าพูดถึงเรา", null, {}],
    ["promo_band", "เช่ารายเดือน คุ้มกว่า", "รายวันเริ่มต้น 800 บาท · รายเดือนเริ่มต้น 15,000 บาท", { image: "/cars/corolla-cross-2000.webp", badge: { label: "รายเดือนเริ่มต้น", value: "15,000", unit: "บาท / เดือน" }, cta: { label: "สอบถามผ่าน LINE", href: LINE_URL } }],
    ["locations_map", "รับรถที่ดอนเมือง หรือส่งถึงที่", "มีบริการรับส่งถึงบ้านคุณ (คิดตามระยะทาง)", {}],
  ];
  let order = 0;
  for (const [type, title, subtitle, cfg] of sections) {
    await db.query(
      `UPDATE homepage_sections SET title = $2, subtitle = $3, config = $4
        WHERE section_type = $1 AND deleted_at IS NULL AND config->>'brand' = $5`,
      [type, title, subtitle, JSON.stringify({ ...cfg, brand: BRAND }), BRAND],
    );
    const r = await db.query(
      `INSERT INTO homepage_sections (section_type, title, subtitle, config, sort_order, is_published)
       SELECT $1, $2, $3, $4, $5, true
        WHERE NOT EXISTS (SELECT 1 FROM homepage_sections WHERE section_type = $1 AND deleted_at IS NULL AND config->>'brand' = $6)
       RETURNING id`,
      [type, title, subtitle, JSON.stringify({ ...cfg, brand: BRAND }), (order += 10), BRAND],
    );
    if (type === "hero" && r.rows[0]) {
      await db.query(
        `INSERT INTO homepage_banners (section_id, headline, description, cta_primary_text, cta_primary_href,
           cta_secondary_text, cta_secondary_href, animation, is_published)
         VALUES ($1, 'รถเช่าขับเอง สำหรับทุกครอบครัว',
                 'รถใหม่ สะอาด ประกันชั้น 1 ขับได้ไม่จำกัดระยะทาง รับรถที่ดอนเมืองหรือส่งถึงบ้าน',
                 'ดูรถทั้งหมด', '/vehicles', 'จองผ่าน LINE', $2, $3, true)`,
        [r.rows[0].id, LINE_URL, JSON.stringify({ preset: "drive-in" })],
      );
    }
  }
}

// Web-booking policy (prices on the site include VAT; delivery = free 5 km, then 20 ฿/km, min 100 ฿).
async function seedBookingPolicy(db) {
  const settings = {
    "pricing.tax_inclusive": true,
    "booking.hold_minutes": 30,
    "booking.min_lead_time_hours": 2,
    "booking.min_driver_age": 20,
    "booking.reservation_fee_minor": thb(1000),
    "booking.review_hold_hours": 24,
    "booking.payment_hold_hours": 12,
    "delivery.free_km": 5,
    "delivery.per_km_minor": thb(20),
    "delivery.min_fee_minor": thb(100),
    "delivery.fallback_minutes": 45,
    "company.legal": {
      name: "COOLKIDS CAR RENTAL CO., LTD.",
      nameTh: "บริษัท คูลคิดส์ คาร์ เร้นท์ทอล จำกัด",
      address: "93/72 หมู่ 3 ต.บางเมือง อ.เมืองสมุทรปราการ จ.สมุทรปราการ 10270",
      phone: PHONE.replaceAll("-", ""),
      taxId: "0115569024211",
    },
  };
  for (const [k, v] of Object.entries(settings)) await upsertContent(db, "system_settings", k, v);
}

// Publishes the rental agreement. Published versions are immutable (DB trigger),
// so a wording change must bump TEMPLATE.version; the previous version is retired.
export async function seedContractTemplate(db) {
  const { rows } = await db.query(
    "SELECT id, status FROM contract_templates WHERE code = $1 AND version = $2 AND locale = $3",
    [TEMPLATE.code, TEMPLATE.version, TEMPLATE.locale],
  );
  if (rows[0]?.status === "PUBLISHED") return;
  await db.query(
    "UPDATE contract_templates SET status = 'RETIRED' WHERE code = $1 AND locale = $2 AND status = 'PUBLISHED'",
    [TEMPLATE.code, TEMPLATE.locale],
  );
  await db.query(
    `INSERT INTO contract_templates (code, version, locale, country_code, title, body, variables_schema, status, published_at)
     VALUES ($1, $2, $3, 'TH', $4, $5, $6, 'PUBLISHED', now())
     ON CONFLICT (code, version, locale) DO UPDATE SET body = EXCLUDED.body, title = EXCLUDED.title,
           variables_schema = EXCLUDED.variables_schema, status = 'PUBLISHED', published_at = now()`,
    [TEMPLATE.code, TEMPLATE.version, TEMPLATE.locale, TEMPLATE.title, TEMPLATE.body, JSON.stringify(TEMPLATE.variablesSchema)],
  );
}

export async function seedCoolkids() {
  await withTransaction(async (db) => {
    await seedContent(db);
    const homeId = await seedLocation(db);
    await seedFleet(db, homeId);
    await seedHomepage(db);
    await upsertHeroVideo(db);
    await seedBookingPolicy(db);
    await seedContractTemplate(db);
    await carPhotosToR2(db); // with R2 configured, the fleet photos are served from the bucket
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedCoolkids()
    .then(() => console.log("✓ coolkids seed complete"))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
