# Security

What the code enforces, and what must be done when the site goes live.
Tests: `backend/tests/security.test.js` (one test per attack) plus the auth / booking suites.

## Enforced in code

| Threat | Protection | Where |
|---|---|---|
| Password theft from the DB | scrypt hashes with per-user salt; timing-equalised login | `shared/password.js` |
| Password guessing | 5 wrong tries locks the account for 15 min; 30 auth requests / 15 min per IP; nginx 10/min on `/api/v1/auth/` | `password.service.js`, `middleware/security.js`, `frontend/nginx.conf` |
| Weak passwords | min 8 chars, common passwords and "contains your email name" refused | `passwordProblem()` |
| Session hijacking | random 256-bit token, only its SHA-256 stored; httpOnly, SameSite=Lax, Secure in prod; back-office sessions die after 12 h idle; disabled users are logged out everywhere | `middleware/auth.js` |
| CSRF | every POST/PUT/PATCH/DELETE must carry our Origin; SameSite cookies | `verifyOrigin` |
| SQL injection | parameterised queries only; dynamic SQL built from fixed whitelists | all services |
| Mass assignment / bad input | zod schemas whitelist every body, query and param | `middleware/validate.js` |
| XSS | Vue escapes output; the contract renderer escapes every value; map tooltips escaped; strict CSP (no inline / third-party scripts) | `contracts/render.js`, `nginx.conf` |
| Clickjacking | `frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN` (only our own pages may frame ours: contract preview, LINE demo) | helmet, nginx |
| Accessing other people's data (IDOR) | bookings/contracts checked against the owner; staff endpoints need RBAC permissions | `bookings.service.js`, `rbac/permissions.js` |
| Privilege escalation | permission checked on every admin route server-side (UI hiding is cosmetic) | `admin.routes.js` |
| Open redirect after login | only same-site relative paths accepted | `safeReturnTo()` |
| OAuth forgery | signed state cookie, nonce, PKCE (Google, LINE); provider emails never take over existing accounts unless verified | `auth.service.js` |
| Fake / tampered payments | Stripe webhook HMAC + 5-min replay window + idempotent inbox; a payment is confirmed only if session id, amount and currency match ours | `webhooks.routes.js`, `confirmPayment()` |
| Mock gateway in production | the API refuses to start | `config/env.js` |
| Developer shortcuts on a real server (LINE demo that acts as the admin, free mock "payments") | only enabled when NODE_ENV is not production **and** APP_URL is a local address — a VPS started with the wrong NODE_ENV still has them off | `config.devToolsEnabled` |
| Account pre-hijacking (someone registers your email with their password first) | when the owner signs in with a provider that verified the email, the unproven password is deleted and its sessions revoked (staff passwords set by the super admin are kept) | `dropUnprovenPassword()` |
| Real slip, right amount, paid to someone else | a slip confirms a booking on its own only if it shows our PromptPay id or `PROMPTPAY_BANK_ACCOUNT`; otherwise staff check it | `judge()`, `maskedAccountConfirms()` |
| Fleet-locking bots | max 3 unpaid holds per customer; 10 bookings / 10 min per IP | `createBooking()`, `bookingCreateLimiter` |
| Google Maps bill abuse | 40 address searches / min per IP | `mapsLimiter` |
| Malicious uploads | JPEG/PNG/WebP only, magic bytes checked, 8 MB cap, content-hash file names, `nosniff` | `admin.routes.js` |
| Personal data leaks | ID / licence numbers AES-256-GCM encrypted, shown masked; signatures in private storage; exports pseudonymised | `shared/crypto.js`, `contracts.service.js` |
| Spreadsheet formula injection (CSV export) | cells starting with `= + - @` are neutralised | `analytics.service.js` |
| Error message leaks | 5xx return a request id only; DB messages are not echoed | `middleware/errors.js`, `shared/errors.js` |
| Tampering with history | audit log append-only; failed logins and lockouts are audited | `0010_audit_events.sql` |
| Misconfigured production | refuses to boot without HTTPS URLs, a DB password and a 48+ char cookie secret | `config/env.js` |
| Known-vulnerable libraries | `npm audit` clean (backend + frontend) at the time of writing | — |
| DoS (application level) | request size limits, nginx timeouts / connection caps / rate limits | `app.js`, `nginx.conf` |

## Must be done at deployment (outside the code)

1. Serve only over HTTPS (TLS at the load balancer / Cloudflare) and use `frontend/Dockerfile.prod` (nginx with the headers above), not the Vite dev server.
2. Put Cloudflare (or similar) in front for network-level DDoS protection and a WAF.
3. Generate fresh secrets (`COOKIE_SECRET`, `PII_ENCRYPTION_KEY`, `PII_HMAC_KEY`) and keep them in a secret manager, never in git. Set a strong `ADMIN_PASSWORD` (12+ chars).
4. Give the API a database user that owns only this database (not `postgres`), and keep Postgres off the public internet.
5. Back up the database **and** `backend/uploads` + `backend/storage` (encrypted backups).
6. Run `npm audit` regularly and update dependencies.
7. Recommended next steps: two-factor login (TOTP) for staff accounts, alerting on `auth.account_locked` / `payment.mismatch` events, and an external penetration test before launch.
