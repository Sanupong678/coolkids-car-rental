# Aurelia Drive — Premium Car Rental Platform

Customer website, Admin Dashboard and Back Office, built on a PostgreSQL schema designed for transactional integrity and analytics.

- **Architecture:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) covers requirements analysis, system design, auth, availability, pricing, payments, contracts, analytics, the permission matrix and the phase plan.
- **Database:** [docs/DATABASE.md](docs/DATABASE.md) covers the ERD, table catalogue, business-rule enforcement and KPI formulas.
- **API:** [docs/API.md](docs/API.md) lists every endpoint with its guard.

| Layer | Stack |
|---|---|
| Frontend | Vue 3, Vite, Pinia, Vue Router (`frontend/`) |
| API | Node 24, Express 5, zod, pg, pino (`backend/`) |
| Database | PostgreSQL 16 (btree_gist, pgcrypto, citext) |
| Auth | Google OIDC (PKCE + nonce), server-side sessions, RBAC |

## Getting started

Prerequisites: Node ≥ 24, PostgreSQL 16 (local, or `docker compose up -d db`).

```bash
cd backend
cp .env.example .env        # fill in DB credentials and generate the secrets (commands are in the file)
npm install
npm run db:migrate          # creates the full schema
npm run db:seed             # roles, permissions, settings, CMS defaults, demo fleet
npm run db:seed:coolkids    # Coolkids brand, real fleet (THB), reviews, homepage sections
npm run dev                 # http://localhost:5000
```

```bash
cd frontend
npm install
npm run dev                 # http://localhost:5173 (proxies /api to :5000)
```

### Google sign-in
1. In Google Cloud Console, go to **APIs & Services → Credentials → Create OAuth client ID** and choose *Web application*.
2. Add the authorised redirect URI `http://localhost:5000/api/v1/auth/google/callback`.
3. Put the client ID and secret in `backend/.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then restart the API.
4. Emails listed in `BOOTSTRAP_SUPER_ADMINS` get the Super Admin role when they sign in.

### Admin login (username + password)
`npm run db:seed:admin` creates the back-office account `ADMIN_LOGIN` / `ADMIN_PASSWORD` with the `admin` role
(local default `admin` / `1234`; production refuses passwords under 12 characters). Sign in from the header, then open `/admin`.

### Facebook sign-in
Create an app at developers.facebook.com (Facebook Login), add the redirect URI
`http://localhost:5000/api/v1/auth/facebook/callback`, and set `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET`.
A Facebook sign-in never takes over an existing account with the same email (Facebook does not verify emails).

### LINE sign-in
Create a LINE Login channel at developers.line.biz (enable OpenID Connect and, if you want emails, apply for the email
permission), add the callback URL `http://localhost:5000/api/v1/auth/line/callback`, and set `LINE_CHANNEL_ID` /
`LINE_CHANNEL_SECRET`. Like Facebook, a LINE sign-in never takes over an existing account with the same email.

### Dispatch dashboard & printed contracts
- The dashboard shows today's hand-overs, overdue cars and revenue, a month calendar of deliveries, and a day planner:
  assign a driver, see who is free, and a map of drop-off points with each driver's last position and straight-line distance.
- Drivers share their position from the back office ("แชร์ตำแหน่งของฉัน"); `npm run db:seed:drivers` adds three demo drivers (dev only).
- "พิมพ์สัญญา" prints the rental agreement on A4 in Thai, English or Chinese (`/admin/contracts/:bookingId/print?lang=th|en|zh`).

### File storage (Cloudflare R2 / S3) and contract PDFs
- With `S3_*` set in `.env`, car photos go to the public bucket and signatures, ID / licence photos and contract PDFs to the
  private bucket (served only through the API, never as public links). Without it, files stay in `backend/uploads` and
  `backend/storage`. After switching, `npm run storage:migrate` copies existing local files to the bucket.
- Customers photograph their ID and licence on the booking page; staff open them from the operations board.
- `GET /api/v1/bookings/:number/contract.pdf` renders the agreement with headless Chrome (installed in the Docker image;
  locally it is auto-detected or set `CHROME_PATH`). A signed contract's PDF is stored once and reused.

### Web booking: details → contract → payment → tracking
- **Contract:** the Coolkids rental agreement lives in `backend/src/modules/contracts/coolkids-rental.template.js`;
  `npm run db:seed:coolkids` publishes it. To change the wording, bump `version` and re-run the seed.
- **Payments:** with `STRIPE_SECRET_KEY` set, customers pay on Stripe Checkout (Thai and international cards,
  Apple/Google Pay, PromptPay). Add a webhook to `/api/v1/webhooks/stripe` for `checkout.session.completed` and set
  `STRIPE_WEBHOOK_SECRET`. Without a key, a local mock gateway is used (refused in production).
- **Delivery ETA & fee:** set `GOOGLE_MAPS_API_KEY` (Places API (New), Geocoding API, Routes API) for address search and
  traffic-aware drive time. Without it, the fee and ETA are estimated from the customer's GPS position.

### Tests
```bash
cd backend
npm test        # integration tests against the car_rental_test database (rebuilt on every run)
```
The test database must exist: `createdb car_rental_test`.
