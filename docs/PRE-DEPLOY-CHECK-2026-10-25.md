# ผลตรวจตามคู่มือ "ทดสอบและความปลอดภัยก่อน Deploy" — coolkidscar.com

วันที่ตรวจ: 25 ต.ค. 2569 · ผู้ตรวจ: Claude (ตรวจโค้ด + ระบบจริงแบบไม่ทำลาย) · ขอบเขต: โค้ดในเครื่อง, เว็บจริง https://coolkidscar.com, เซิร์ฟเวอร์ VPS

สถานะ: ✅ ผ่าน · ❌ ไม่ผ่าน (ต้องแก้) · ⚠️ ผ่านแต่ควรปรับ · ⏸ ทดสอบไม่ได้ / รออนุมัติ · — ไม่เกี่ยวข้อง

> หมายเหตุ: ตัวอักษรอังกฤษใน PDF คู่มือแสดงไม่ออก (ฟอนต์ไทยไม่มีตัวอังกฤษ) หัวข้อจึงตีความจากข้อความไทย ตัวอย่างโค้ด และลิงก์อ้างอิงในคู่มือ

## สรุป

| ระดับ | จำนวน | ต้องทำก่อนถือว่า "พร้อม" |
|---|---|---|
| ❌ ต้องแก้ | 0 (แก้แล้ว 4) | ไลบรารี · backup · ทดสอบ restore · ชุดทดสอบ — แก้และพิสูจน์แล้ว 25 ต.ค. 2569 ดู "ผลการแก้ไข" ด้านล่าง |
| ⚠️ ควรปรับ | 7 | DB ใช้ superuser · SSH root · log ไม่จำกัดขนาด · kernel update ค้าง · ไม่มี git/CI/rollback · header ซ้ำ · วิดีโอหน้าแรก 15.6 MB |
| ✅ ผ่าน | ส่วนใหญ่ | ดูรายละเอียดด้านล่าง |

## 1. ตรรกะธุรกิจและการจอง

| รายการ | สถานะ | หลักฐาน |
|---|---|---|
| ตรวจข้อมูลเข้าทุก API ที่เขียนข้อมูล | ✅ | ทุก route POST/PUT/PATCH ใช้ `validate()` (zod) ยกเว้น 4 จุดที่ตั้งใจ: อัปโหลดรูป (ตรวจ magic bytes + 8 MB), logout, LINE/Stripe webhook (ตรวจลายเซ็น) |
| วันคืนก่อนวันรับ / ข้อมูลผิดชนิด | ✅ | schema `createBookingSchema` + ทดสอบจริง: `pageSize=abc` → 400 พร้อมข้อความ ไม่เผย stack |
| ราคาคำนวณฝั่งเซิร์ฟเวอร์ | ✅ | schema การจองไม่มีช่องราคา ราคาคำนวณจากข้อมูลรถใน DB และบันทึก `pricing_snapshot` |
| กันรถถูกจองซ้อน (race condition) | ✅ | `vehicle_holds` มี `EXCLUDE USING gist (vehicle_id WITH =, during WITH &&)` — DB ปฏิเสธช่วงเวลาทับกันแม้ยิงพร้อมกัน |
| สถานะการจองเปลี่ยนตามลำดับเท่านั้น | ✅ | `operations.service.js` ตาราง `NEXT` (PENDING→CANCELLED, CONFIRMED→PREPARING… ) ผิดลำดับ → 400 |
| ไม่เชื่อสถานะจ่ายเงินจากหน้าเว็บ | ✅ | ยืนยันการจ่ายจาก Stripe webhook (ลายเซ็น HMAC) หรือแอดมินตรวจสลิปเท่านั้น |
| Transaction ครอบงานหลายตาราง | ✅ | `withTransaction()` ทุกจุดสร้าง/เปลี่ยนสถานะ |
| ทดสอบอัตโนมัติ (รวม E2E ฝั่ง API) | ✅ | `sh deploy/run-tests.sh` บน VPS กับฐานข้อมูลทดสอบชั่วคราว: **103 tests · 25 suites · pass 103 · fail 0** (119 วินาที) |

## 2. Authentication / Authorization

| รายการ | สถานะ | หลักฐาน |
|---|---|---|
| Cookie session | ✅ | `httpOnly`, `secure` (production), `sameSite=lax`, เก็บเฉพาะ hash ของ token |
| Session หมดอายุ / เพิกถอน | ✅ | `expires_at` + logout revoke + ระงับบัญชี/เปลี่ยนรหัส → revoke ทุก session |
| รหัสผ่าน | ✅ | scrypt + salt, ตรวจความแข็งแรง |
| จำกัดการลองล็อกอิน | ✅ | `authLimiter` 30 ครั้ง/15 นาที, จองรถ 10/10 นาที, ชำระเงิน 20/10 นาที, API รวม 300/นาที |
| ดูข้อมูลคนอื่น (IDOR) | ✅ | `loadBooking()` ตรวจเจ้าของหรือสิทธิ์ `bookings:read` ทุกครั้ง, เอกสารบัตรต้องเป็นเจ้าของหรือ `users:read_sensitive` |
| ทุก route หลังบ้านตรวจสิทธิ์ | ✅ | สแกน 45 route ใน admin.routes — มี `requirePermission` ครบ 45/45 |
| Route ทดสอบ (demo login) ปิดใน production | ✅ | `GET /api/v1/dev/line/login` → 404 |

## 3. Injection / XSS / CSRF / SSRF / อัปโหลด

| รายการ | สถานะ | หลักฐาน |
|---|---|---|
| SQL injection | ✅ | ทุก query ใช้ `$1…` parameter; จุดที่ต่อ string (ชื่อคอลัมน์, ORDER BY) มาจาก whitelist ในโค้ดเท่านั้น |
| XSS | ✅ | Vue escape ปกติ; `v-html` มี 2 จุด: ไอคอน (ข้อความคงที่) และสัญญาเช่า (เซิร์ฟเวอร์ escape ทุกค่า) · อีเมล escape ทุกค่า |
| CSRF | ✅ | `verifyOrigin` ทดสอบจริง: POST จาก origin แปลกปลอม → 403 |
| CORS | ✅ | origin แปลกปลอมไม่ได้รับ `Access-Control-Allow-Origin` |
| SSRF | ✅ | เรียกออกเฉพาะโดเมนคงที่ (Google Maps, Stripe, LINE, SlipOK, Facebook) ไม่มี URL จากผู้ใช้ |
| อัปโหลดไฟล์ | ✅ | ตรวจ Content-Type คู่กับ magic bytes, จำกัด 8 MB, ตั้งชื่อใหม่ด้วย hash, เอกสารบัตรเก็บ private (R2) |
| Path traversal / ไฟล์ลับ | ✅ | `/.env`, `/backend/.env`, `/.git/config`, `*.map` → 404; `../` → 400 หรือหน้าเว็บปกติ |
| Error ไม่เผยรายละเอียดภายใน | ✅ | JSON เสีย → `{"code":"BAD_JSON"}` ไม่มี stack trace |

## 4. API / การชำระเงิน

| รายการ | สถานะ | หลักฐาน |
|---|---|---|
| Stripe webhook ตรวจลายเซ็น | ✅ | HMAC-SHA256 + tolerance 5 นาที; ไม่มีลายเซ็น → 400 |
| Webhook ซ้ำไม่ทำงานซ้ำ | ✅ | `UNIQUE(provider, provider_event_id)` → event ซ้ำเป็น no-op |
| Idempotency ตอนสร้าง checkout | ✅ | ส่ง `Idempotency-Key` ไป Stripe |
| คีย์ Stripe สิทธิ์ต่ำสุด | ✅ | restricted key (Checkout write, PaymentIntents/Charges read) |
| ทดลองจ่ายจริงครบวงจร | ⏸ | ยังรอผลทดสอบจ่ายจริงยอดเล็ก + refund ตามขั้นตอนที่แนะนำไว้ |

## 5. เซิร์ฟเวอร์และโครงสร้าง

| รายการ | สถานะ | หลักฐาน |
|---|---|---|
| พอร์ตที่เปิด | ✅ | 22, 80, 443 เท่านั้น · UFW active · PostgreSQL ไม่ผูกพอร์ตกับเครื่อง (อยู่ใน Docker network) |
| HTTPS / ใบรับรอง | ✅ | Let's Encrypt หมดอายุ 14 ม.ค. 2570 (Caddy ต่ออายุเอง) · HTTP → 308 HTTPS · TLS 1.0 ใช้ไม่ได้ |
| Security headers | ✅⚠️ | มี HSTS, CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy · **แต่ API ส่ง CSP/HSTS ซ้ำ 2 ชุด** (helmet + nginx) — ไม่อันตราย ควรเหลือชุดเดียว |
| Container ไม่รันเป็น root | ✅⚠️ | api = `node`, web = 101 · db/caddy ใช้ค่า default ของ image ทางการ |
| ความลับไม่อยู่ในโค้ด/ไฟล์ที่ส่งขึ้น | ✅ | สแกนไม่พบคีย์ใน source/bundle · `pack.sh` ตัด `.env*` ทิ้งและหยุดถ้าเจอ · `.env` บนเซิร์ฟเวอร์ `600 root` |
| SSH | ⚠️ | ใช้กุญแจเท่านั้น (password ปิด) แต่ **`PermitRootLogin yes`** และไม่มี fail2ban |
| อัปเดตระบบ | ⚠️ | unattended-upgrades เปิดอยู่ แต่ **kernel update ค้าง 3 แพ็กเกจ** ต้อง reboot |
| Log ของ Docker | ⚠️ | ไม่มี `daemon.json` จำกัดขนาด log → ดิสก์เต็มได้ในระยะยาว (ตอนนี้ใช้ 31%) |

## 6. ฐานข้อมูล / Backup / Dependencies / CI

| รายการ | สถานะ | หลักฐาน |
|---|---|---|
| Backup อัตโนมัติ | ✅ | cron 03:30 ทุกวัน เก็บ 14 วัน (มีไฟล์ 21–25 ต.ค.) |
| ไฟล์ backup ปลอดภัย | ✅ | โฟลเดอร์ `700`, ไฟล์ `600` (umask 077 ในสคริปต์) · สำเนาขึ้น R2 bucket ส่วนตัว `backups/db/` ทุกคืน เก็บ 30 วัน — ทดสอบแล้ว: `uploaded backups/db/db-2026-10-25.sql.gz (109 kB) to R2` |
| ทดสอบ restore จริง | ✅ | `sh deploy/restore-test.sh`: กู้ db-2026-10-25 ลง Postgres ชั่วคราว (ไม่มีเครือข่าย) สำเร็จใน 4 วินาที ไม่มี error · ตาราง 64/64 · แถวตรงกันทุกตาราง ยกเว้น audit_logs/sessions ต่าง 1 แถว (เกิดหลังเวลา backup) |
| ไฟล์แนบ/รูปเอกสาร | ✅ | เก็บใน Cloudflare R2 (นอกเครื่อง) |
| สิทธิ์บัญชี DB | ⚠️ | แอปเชื่อมต่อด้วย `coolkids` ซึ่งเป็น superuser ของ Postgres — ควรแยก user แอปที่มีสิทธิ์เฉพาะตาราง |
| Constraint กันข้อมูลซ้ำ/ขัดแย้ง | ✅ | EXCLUDE, UNIQUE, CHECK ใน migrations · มีไฟล์ทดสอบ `db-rules.test.js` |
| npm audit (backend, production) | ✅ | `npm audit fix`: body-parser 2.4.0, zod 4.6.7, nodemailer 10.2.1, ip-address 10.7.5, qs 6.16.1 · บนเซิร์ฟเวอร์ `npm audit --omit=dev` → **0 vulnerabilities** |
| npm audit (frontend) | ✅ | vite 8.3.5, body-parser 2.4.0 ฯลฯ → **0 vulnerabilities** · build ผ่าน |
| Git / CI / rollback | ⚠️ | โปรเจกต์ไม่ได้อยู่ใน git, ไม่มี CI, deploy ทับ image เดิม → ย้อนเวอร์ชันไม่ได้ |
| Health check | ✅ | `/health` → 200 |

## 7. ประสิทธิภาพ

| รายการ | สถานะ | หลักฐาน |
|---|---|---|
| เวลาตอบสนอง | ✅ | หน้าแรก TTFB 0.07 s, รายการรถ 0.12 s, homepage API 0.09 s (วัดจากเครื่องในไทย 1 ครั้ง) |
| บีบอัด / cache | ✅ | gzip, ไฟล์ assets cache 1 ปี immutable, HTML no-store |
| Load test | ⏸ | ยังไม่ได้ทำ — ต้องได้รับอนุญาต และควรทำนอกเวลาที่มีลูกค้า |
| น้ำหนักหน้าแรกบนมือถือ | ⚠️ | วิดีโอ hero 15.6 MB (2560×1440) — ควรมีไฟล์ 720p สำหรับมือถือ |

## สิ่งที่แนะนำให้ทำ (เรียงตามความสำคัญ)

1. ~~npm audit fix~~ ✅ · 2. ~~backup ปลอดภัย + R2~~ ✅ · 3. ~~ทดสอบ restore~~ ✅ · 3b. ~~ชุดทดสอบอัตโนมัติ~~ ✅ (ทำซ้ำได้ทุกครั้งก่อน deploy: `sh deploy/run-tests.sh`)
4. ทดสอบจ่ายเงินจริงยอดเล็ก + refund ให้จบวงจร
5. แยก DB user ของแอปออกจาก superuser
6. SSH: `PermitRootLogin prohibit-password` (หรือใช้ user ปกติ + sudo) และติดตั้ง fail2ban
7. Reboot เพื่อลง kernel update (ช่วงไม่มีลูกค้า ~1 นาที)
8. จำกัดขนาด log ของ Docker (`max-size 10m`, `max-file 3`)
9. เริ่มใช้ git + tag image ทุกครั้งที่ deploy เพื่อย้อนเวอร์ชันได้
10. ลบ header ซ้ำ, ทำวิดีโอ hero สำหรับมือถือ, load test ด้วย k6 เมื่อพร้อม

## ผลการแก้ไข (25 ต.ค. 2569)

| ข้อ | ทำอะไร | หลักฐาน |
|---|---|---|
| ไลบรารีมีช่องโหว่ | `npm audit fix` (ไม่ข้ามเวอร์ชันหลัก) ทั้ง backend และ frontend, build, รันชุดทดสอบ, deploy | `npm audit` ในเครื่อง + บนเซิร์ฟเวอร์ = 0 · API ขึ้นปกติ · หน้าเว็บ 200 |
| Backup | `deploy/backup-db.sh`: umask 077, chmod 600/700, ส่งสำเนาขึ้น R2 ผ่าน `backend/src/scripts/backup-upload.js` (ตรวจว่าเป็น gzip จริง, ลบสำเนาเก่ากว่า 30 วัน) | รันจริง 12:25 น.: `backup ok` + `off-site copy ok` |
| ทดสอบ restore | สคริปต์ใหม่ `deploy/restore-test.sh` (container Postgres ไม่มีเครือข่าย, อ่าน DB จริงแค่จำนวนแถว, ลบทิ้งเมื่อจบ) | `RESTORE TEST PASSED` · 64/64 ตาราง |
| ชุดทดสอบ | สคริปต์ใหม่ `deploy/run-tests.sh` (เครือข่าย Docker แบบ internal, ไม่คัดลอก `.env` จริง, image เดียวกับ production) | 103/103 ผ่าน · ไม่มี container/network/volume ค้าง |

แนะนำ: รัน `sh deploy/run-tests.sh` ก่อน deploy ทุกครั้ง และ `sh deploy/restore-test.sh` เดือนละครั้ง
