# API structure — `/api/v1`

Conventions
- **Auth:** `sid` HttpOnly session cookie. Unsafe methods must come from the allowed `Origin` (CSRF). Webhooks authenticate by signature.
- **Responses:** `{ data, page? }` on success. `{ error: { code, message, details? } }` on failure.
- **Errors:** 400 `BAD_REQUEST`/validation · 401 `UNAUTHENTICATED` · 403 `FORBIDDEN` / `ONBOARDING_REQUIRED` · 404 · 409 `VEHICLE_UNAVAILABLE` / `DUPLICATE` · 429 `RATE_LIMITED`.
- **Pagination:** keyset (`?before=<cursor>&limit=`) for logs and feeds, `?page&pageSize` for admin tables (max 100).
- **Idempotency:** `Idempotency-Key` header on `POST /bookings`, `POST /bookings/:id/payments`, refunds.
- **Money:** integers in minor units + `currency`. Dates are ISO-8601 with offset.
- 🔒 = signed in · 🧾 = onboarding done · `perm:x` = permission required · ✅ = implemented (Phase 1)

## Auth and account
| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/auth/google?returnTo=` | rate-limited | ✅ Start Google OIDC (PKCE, state, nonce) → 302 |
| GET | `/auth/google/callback` | | ✅ Finish login, set session, 302 to frontend |
| POST | `/auth/logout` | | ✅ Revoke session |
| GET | `/auth/providers` | | ✅ Which sign-in providers are enabled |
| GET | `/me` | 🔒 | ✅ Profile, roles, permissions, `needsOnboarding` |
| PUT | `/me/onboarding` | 🔒 | ✅ `{age, gender}` — first-login step |
| PATCH | `/me` | 🔒 | ✅ Update name, phone, locale |
| GET / PUT | `/me/identity` | 🔒🧾 | KYC (masked on read; encrypted on write) |
| GET | `/me/bookings?status=upcoming\|active\|past` | 🔒 | Booking history |
| GET | `/me/payments` · `/me/contracts` · `/me/notifications` | 🔒 | Customer dashboard |
| POST | `/me/notifications/:id/read` | 🔒 | |
| GET / PUT / DELETE | `/me/favorites[/:vehicleId]` | 🔒 | Saved vehicles |

## Catalogue (public, cacheable)
| Method | Path | Purpose |
|---|---|---|
| GET | ✅ `/content/site` | navbar, footer, theme, company (CMS) |
| GET | ✅ `/content/homepage` | published sections + banners |
| GET | ✅ `/categories` | active categories with available-vehicle counts |
| GET | ✅ `/locations` | branches with coordinates, hours, services |
| GET | ✅ `/vehicles?category&priceMin&priceMax&transmission&fuel&seats&drive&brand&model&year&from&to&sort&page` | listing. `from/to` filters by availability. Includes best active promo per vehicle |
| GET | ✅ `/vehicles/:slug` | detail: specs, features, gallery, 3D assets, promo |
| GET | ✅ `/vehicles/:slug/availability?from&to` | day cells: AVAILABLE / BOOKED / MAINTENANCE / UNAVAILABLE |
| GET | ✅ `/promotions` · `/promotions/:slug` | active promotions |
| GET | `/add-ons` | add-on services |
| POST | `/pricing/quote` | server-side itemised price (display only, signed quote id) |
| POST | `/events` | analytics beacons (batched, no PII, rate-limited) |

## Booking, payment, contract (customer)
| Method | Path | Guard | Purpose |
|---|---|---|---|
| POST | `/bookings` | 🔒🧾 + Idempotency-Key | Create PENDING booking: re-price, lock promo, insert availability block |
| GET | `/bookings/:id` | 🔒 owner | Booking + items + status timeline |
| POST | `/bookings/:id/cancel` | 🔒 owner | Cancel per policy (may trigger a refund) |
| POST | `/bookings/:id/payments` | 🔒 owner + Idempotency-Key | Initialise payment with the configured provider |
| GET | `/payments/:id` | 🔒 owner | Status (browser polls after redirect) |
| GET | `/bookings/:id/contract` | 🔒 owner | Contract metadata + HTML |
| POST | `/contracts/:id/sign` | 🔒 owner | Click-wrap signature |
| GET | `/contracts/:id/document` | 🔒 owner / `perm:contracts:read` | PDF (signed-URL redirect) |
| GET | `/bookings/:id/tracking` | 🔒 owner | Merged delivery timeline + last GPS + ETA |
| GET | `/bookings/:id/tracking/stream` | 🔒 owner | SSE live updates |
| POST | `/webhooks/payments/:provider` | signature | Provider webhook → inbox → idempotent processing |

## Admin Dashboard (website and content)
| Method | Path | Permission |
|---|---|---|
| GET/PUT | `/admin/content/:key` | `cms:write` (optimistic `version`) |
| CRUD | `/admin/homepage/sections`, `/admin/homepage/banners` | `cms:write` |
| POST | `/admin/media/uploads` → `/admin/media/:id/complete` | `vehicles:write` or `cms:write` |
| CRUD | `/admin/categories` (archive/restore) | `categories:write` |
| CRUD | `/admin/locations` | `locations:write` |
| GET/POST/PATCH | `/admin/vehicles` | `vehicles:read` / `vehicles:write` |
| PATCH | `/admin/vehicles/:id/pricing` | `vehicles:price` (audited `vehicle.price_changed`) |
| POST | `/admin/vehicles/:id/archive` · `/restore` | `vehicles:archive` (soft delete) |
| PUT | `/admin/vehicles/:id/images` · `/3d-assets` · `/features` | `vehicles:write` |
| POST | `/admin/vehicles/:id/availability-blocks` | `vehicles:write` (UNAVAILABLE holds) |
| CRUD | `/admin/promotions` (+ targeting) | `promotions:write` |
| CRUD | `/admin/add-ons` | `settings:write` |
| GET/PUT | `/admin/settings/:key` | `settings:write` |
| GET/POST/DELETE | `/admin/users/:id/roles` | `roles:manage` |

## Back Office (operations)
| Method | Path | Permission |
|---|---|---|
| GET | `/admin/bookings?status&from&to&vehicle&customer&q` | `bookings:read` |
| GET | `/admin/bookings/:id` (customer, vehicle, payments, contract, delivery, history) | `bookings:read` |
| POST | `/admin/bookings/:id/status` `{to, reason}` | `bookings:write` (state machine enforced in DB) |
| POST | `/admin/bookings/:id/cancel` | `bookings:cancel` |
| PATCH | `/admin/bookings/:id` (dates/vehicle change → re-price, new contract) | `bookings:write` |
| POST | `/admin/bookings/:id/handover` `{type: pickup\|return, odometerKm, fuel, photos}` | `bookings:write` / `deliveries:update` |
| GET | `/admin/customers?q&segment` · `/admin/customers/:id` | `users:read` |
| GET | `/admin/customers/:id/identity` (unmasked, audited) | `users:read_sensitive` |
| GET | `/admin/payments` · POST `/admin/payments/:id/refunds` | `payments:read` / `payments:refund` |
| GET | `/admin/contracts?q&from&to&status` · POST `/admin/contracts/:id/void` | `contracts:read` / `contracts:write` |
| CRUD | `/admin/contract-templates` + POST `/:id/publish` | `contracts:write` |
| GET/POST | `/admin/deliveries` · POST `/admin/deliveries/:id/assign` | `deliveries:read` / `deliveries:assign` |
| GET | `/staff/me/assignments` | `deliveries:update` (own only) |
| POST | `/staff/assignments/:id/status` · `/location` | `deliveries:update` (own only) |
| CRUD | `/admin/maintenance/plans` · `/admin/maintenance/records` (+ parts) | `maintenance:write` |
| POST | `/admin/vehicles/:id/mileage` | `maintenance:write` / `deliveries:update` |
| GET | `/admin/maintenance/alerts` | `maintenance:read` |
| GET/POST | `/admin/staff` · `/admin/staff/:id/activity` | `staff:read` / `staff:write` |
| GET | `/admin/audit-logs?entityType&entityId&actorUserId&action&before&limit` | ✅ `audit:read` |

## Back Office (analytics)
All endpoints accept `from`, `to`, `granularity=day|week|month|year`, `categoryId`, `vehicleId`, `locationId`. Results are cached for 5 min.

| Path | Business question | Permission |
|---|---|---|
| `/analytics/overview` | KPI strip: revenue, bookings, customers, available vehicles, utilisation, pending deliveries, vehicles in maintenance | `analytics:read` (revenue needs `analytics:finance`) |
| `/analytics/revenue` · `/revenue/breakdown?by=vehicle\|category\|location\|promotion` | What is our revenue, where does it come from? | `analytics:finance` |
| `/analytics/bookings/trend` · `/bookings/duration` · `/bookings/aov` | Booking volume, average duration, AOV | `analytics:read` |
| `/analytics/fleet/utilization` (vehicle × week heatmap) · `/fleet/ranking` | Which vehicles are used most or least, which have low ROI? | `analytics:read` |
| `/analytics/customers` · `/customers/segments` · `/customers/cohorts` | New vs returning, repeat rate, retention, CLV | `analytics:read` |
| `/analytics/promotions/funnel` · `/promotions/performance` | Which promotions convert, and which get clicks but no bookings? | `analytics:read` |
| `/analytics/website/funnel` · `/website/pages` | Where do visitors drop off? | `analytics:read` |
| `/analytics/operations` | Deliveries on time, turnaround, pending work | `analytics:read` |
| `/analytics/maintenance` | Cost per vehicle, cost per km, downtime | `analytics:read` |
| `/analytics/export.csv?report=` | Export any report | `analytics:read` |
