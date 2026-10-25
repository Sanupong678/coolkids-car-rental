# เช็กลิสต์เตรียมขึ้นระบบจริง (Production) — Coolkids Car Rental + LINE OA

เอกสารนี้รวมทุกอย่างที่เจ้าของร้านต้องเตรียม ตั้งแต่โดเมน เซิร์ฟเวอร์ บัญชีต่างๆ ไปจนถึงข้อมูลร้าน
ติ๊ก `[x]` เมื่อเตรียมเสร็จ แล้วส่งค่าที่ได้ (ยกเว้นรหัสผ่าน/คีย์ลับ) ให้ทีมพัฒนาเพื่อตั้งค่าต่อ

> **ทดสอบกับ LINE ก่อน deploy ได้** — ใช้ tunnel (ลิงก์ HTTPS ชั่วคราวชี้มาที่เครื่องพัฒนา) กับ LINE OA ทดลอง
> ดูหัวข้อ 7 · เอกสารนี้คือสิ่งที่ต้องมีตอนเปิดให้ลูกค้าจริง

---

## 1. ภาพรวมระบบที่จะรันบนเซิร์ฟเวอร์

```
ลูกค้า (เว็บ / แอป LINE)          LINE Platform (Messaging API, LIFF)
            │ HTTPS                         │ webhook HTTPS
            ▼                               ▼
   Cloudflare (DNS + HTTPS + กัน DDoS) ── coolkidscar.com
            │
            ▼  เซิร์ฟเวอร์ VPS (Docker)
   ┌──────────────────────────────────────────────────────┐
   │  web  : nginx — หน้าเว็บ + ส่งต่อ /api ไปที่ api       │
   │  api  : Node.js 24 — ระบบจอง, บอท LINE, PDF สัญญา      │
   │  db   : PostgreSQL 16 (หรือใช้แบบ managed แยก)         │
   └──────────────────────────────────────────────────────┘
            │
            ▼
   Cloudflare R2 — รูปรถ (public) · บัตร/ใบขับขี่/สลิป/สัญญา (private)
```

ใช้ **โดเมนเดียว** ทั้งหน้าเว็บและ API (`https://coolkidscar.com` และ `https://coolkidscar.com/api/...`)
ทำให้ไม่มีปัญหา cookie ข้ามโดเมน และตั้งค่า LINE ง่าย

---

## 2. สิ่งที่ต้องซื้อ / สมัคร

### 2.1 โดเมน
- [ ] จดโดเมน เช่น `coolkidscar.com` (หรือ `.co.th` ต้องใช้เอกสารบริษัท)
  - ที่จด: Cloudflare Registrar, Namecheap, หรือผู้ให้บริการไทย
  - ค่าใช้จ่ายประมาณ 400–1,000 บาท/ปี
- [ ] ตัดสินใจว่าจะใช้ `www.` หรือไม่ (แนะนำใช้โดเมนหลักไม่มี www แล้ว redirect www → หลัก)

### 2.2 Cloudflare (ฟรี)
- [ ] สมัคร Cloudflare แล้ว **ย้าย DNS ของโดเมนมาที่ Cloudflare** (เปลี่ยน nameserver ที่ผู้จดโดเมน)
- ได้: HTTPS ฟรี, กัน DDoS, firewall (WAF), cache ไฟล์หน้าเว็บ
- [ ] ตั้ง SSL/TLS mode = **Full (strict)** (ทีมพัฒนาจะติดตั้ง Origin Certificate ที่เซิร์ฟเวอร์ให้)

### 2.3 เซิร์ฟเวอร์ (VPS)
- [ ] เช่า VPS **อย่างน้อย 2 vCPU / 4 GB RAM / 60 GB SSD**
  - ต้องมี RAM 4 GB เพราะระบบเปิด Chromium เพื่อสร้าง PDF สัญญา
  - **Region: Singapore** (ใกล้ไทย เร็วที่สุด) หรือผู้ให้บริการในไทย
  - OS: **Ubuntu 24.04 LTS**
  - ตัวเลือก: DigitalOcean, Vultr, Linode/Akamai, AWS Lightsail, Hetzner (มี Singapore) หรือ VPS ไทย
  - ค่าใช้จ่ายประมาณ 500–900 บาท/เดือน
- [ ] เปิด **Backup/Snapshot อัตโนมัติ** ของผู้ให้บริการ (ปกติเพิ่ม ~20% ของค่าเครื่อง)
- [ ] ส่งให้ทีมพัฒนา: IP ของเครื่อง และสิทธิ์เข้า SSH (เพิ่ม SSH public key ของทีม — **ไม่ต้องส่งรหัสผ่าน root**)

### 2.4 ฐานข้อมูล PostgreSQL 16 — เลือก 1 แบบ
- [ ] **แบบ A (ประหยัด):** รันใน Docker บน VPS เดียวกัน — ทีมพัฒนาตั้งให้ + ตั้ง backup รายวันไป R2
- [ ] **แบบ B (แนะนำถ้างบพอ):** Managed PostgreSQL (DigitalOcean / Vultr / AWS RDS) region เดียวกับ VPS
  - มี backup อัตโนมัติ + กู้คืนย้อนเวลาได้ · ประมาณ 500–700 บาท/เดือน
  - ส่งให้ทีม: host, port, ชื่อ database, user (ห้ามใช้ user `postgres`), password ผ่านช่องทางลับ

### 2.5 ที่เก็บไฟล์ — Cloudflare R2 (ฟรี 10 GB/เดือน)
- [ ] เปิด R2 ในบัญชี Cloudflare (ต้องผูกบัตร แต่ใช้ไม่เกินโควตาฟรีไม่เสียเงิน)
- [ ] สร้าง bucket 2 อัน:
  - `coolkids-public` — รูปรถ (เปิด public access / ผูกโดเมนย่อย เช่น `media.coolkidscar.com`)
  - `coolkids-private` — บัตรประชาชน ใบขับขี่ สลิป สัญญา (**ห้ามเปิด public**)
- [ ] สร้าง API Token แบบ "Object Read & Write" จำกัดเฉพาะ 2 bucket นี้ → ได้ Access Key ID + Secret + Endpoint
- ถ้าไม่ใช้ R2: ไฟล์จะเก็บในดิสก์ VPS ต้องมี backup ดิสก์สม่ำเสมอ (ข้อมูลบัตรลูกค้าหายไม่ได้)

---

## 3. บัญชีและคีย์ของบริการภายนอก

### 3.1 LINE (จำเป็น)
ทำที่ https://developers.line.biz ด้วยบัญชี LINE ของเจ้าของร้าน
- [ ] **Provider** เดียวสำหรับร้าน (เช่น "Coolkids Car Rental") — ทุก channel ด้านล่างต้องอยู่ใต้ provider นี้
- [ ] **LINE Login channel** (มีอยู่แล้วจากระบบล็อกอิน LINE)
  - Callback URL: `https://coolkidscar.com/api/v1/auth/line/callback`
  - เปิด OpenID Connect · (ถ้าต้องการอีเมลลูกค้า ต้องยื่นขอสิทธิ์ email)
  - เก็บ: **Channel ID**, **Channel secret**
- [ ] **LIFF app** (ในแท็บ LIFF ของ LINE Login channel)
  - Endpoint URL: `https://coolkidscar.com` · Size: **Full** · Scopes: `openid`, `profile`
  - Add friend option: **On (Aggressive)** — ชวนลูกค้าแอด OA ตอนเปิดครั้งแรก (จำเป็นเพื่อส่งแจ้งเตือนได้)
  - เก็บ: **LIFF ID**
- [ ] **Messaging API channel** ของ OA @coolkidscar
  - ใน LINE OA Manager → ตั้งค่า → Messaging API → เปิดใช้งาน → **เลือก provider เดียวกับข้างบน** (เลือกแล้วเปลี่ยนไม่ได้)
  - Webhook URL: `https://coolkidscar.com/api/v1/webhooks/line` → เปิด Use webhook
  - เก็บ: **Channel access token (long-lived)**, **Channel secret**
- [ ] LINE OA Manager → การตอบกลับ: เปิด **แชท** + **Webhook**, ปิด **ข้อความตอบกลับอัตโนมัติ**
- [ ] ตัดสินใจแพ็กเกจ OA: แจ้งเตือนลูกค้าใช้ประมาณ 5–7 ข้อความต่อการจอง
  - ฟรี 300 ข้อความ/เดือน ≈ 40–60 การจอง · ถ้าเกินต้องอัปเกรดแพ็กเกจ
  - (การตอบเมนู เลือกรถ/โปรโมชั่น/ติดต่อเรา **ไม่นับ**โควตา)

### 3.2 การชำระเงิน (จำเป็น)
- [ ] **ยืนยันเลข PromptPay** ที่ผูกกับบัญชีกสิกร 226-1-922633
  - ตอนนี้ตั้งเป็นเลขผู้เสียภาษี `0115569024211` — ถ้าผูกด้วยเบอร์มือถือ ให้แจ้งเบอร์นั้นแทน
  - วิธีเช็ก: เปิดแอปธนาคารอื่น → โอนพร้อมเพย์ด้วยเลขนี้ → ชื่อบัญชีต้องขึ้น "คลูคิท คาร์เร้นท์ทอล"
- [ ] (ไม่บังคับ) **SlipOK** https://slipok.com — ตรวจสลิปอัตโนมัติกับธนาคาร ไม่ต้องให้แอดมินกดเอง
  - สมัคร → สร้างสาขา → ใส่บัญชีรับเงินของร้าน → เก็บ **Branch ID** + **API Key**
- [ ] (ไม่บังคับ) **Stripe** — ถ้าอยากรับบัตรเครดิตออนไลน์ (ต้องยืนยันตัวตนบริษัท)

### 3.3 บริการเสริม (ไม่บังคับ)
- [ ] **Google Maps API key** — ค้นที่อยู่ส่งรถ + คำนวณระยะทาง/ค่าส่งตามถนนจริง
  - Google Cloud → เปิด Places API (New), Geocoding API, Routes API → ต้องผูกบัตร (มีเครดิตฟรีรายเดือน)
  - ถ้าไม่ใส่: ระบบประมาณระยะจาก GPS แบบเส้นตรงแทน
- [ ] **Google Login** (OAuth client) — redirect URI `https://coolkidscar.com/api/v1/auth/google/callback`
- [ ] **Facebook Login** — redirect URI `https://coolkidscar.com/api/v1/auth/facebook/callback`

---

## 4. ข้อมูลร้านที่ต้องเตรียม

- [ ] **โลโก้ร้าน** ไฟล์ PNG พื้นใส หรือ SVG (ใช้ในรูป Rich menu, เว็บ, สัญญา)
- [ ] **ลิงก์ TikTok** และยืนยันลิงก์ Facebook / LINE (@Coolkidscar) / เบอร์โทร 065-365-6514, 063-640-8891
- [ ] **รายการรถจริงทุกคัน**: รุ่น ปี ทะเบียน สี ราคา/วัน **เงินประกัน** (ตอนนี้เป็นค่าตัวอย่าง) รูปถ่ายรถจริง 3–5 รูป/คัน
- [ ] **สาขา / จุดรับรถ**: ที่อยู่ + พิกัด Google Maps (ใช้คำนวณค่าส่งและแผนที่ติดตามรถ)
- [ ] **นโยบายค่าส่งรถ**: ตอนนี้ตั้ง ฟรี 5 กม. แรก, กม.ละ 20 บาท, ขั้นต่ำ 100 บาท — ยืนยันหรือแก้ไข
- [ ] **ค่าจอง** (ตอนนี้ 1,000 บาท) และเวลาที่ล็อกรถ (ตรวจเอกสาร 24 ชม. · รอโอนหลังอนุมัติ 12 ชม.)
- [ ] ตรวจ **ข้อความกฎของร้าน** ในใบสรุปการจอง (ค่าปรับ น้ำมัน ยกเลิก ฯลฯ) และ **สัญญาเช่า** ให้ตรงฉบับล่าสุด
- [ ] **นโยบายความเป็นส่วนตัว (PDPA)** — ข้อความที่จะแสดงบนเว็บ (ระบบเก็บรูปบัตร/ใบขับขี่/สลิป)
- [ ] **รายชื่อพนักงาน**: ชื่อ เบอร์ อีเมล และบทบาท (แอดมิน / คนขับส่งรถ / ผู้จัดการรถ) เพื่อสร้างบัญชีหลังบ้าน
- [ ] **มือถือของคนขับ** เปิด GPS ได้ (ต้องเปิดหน้าหลังบ้านค้างไว้ระหว่างส่งรถ ลูกค้าจึงเห็นตำแหน่งรถ)

---

## 5. ค่าตั้งค่า (`backend/.env` ของ production)

ทีมพัฒนาจะใส่ให้บนเซิร์ฟเวอร์ — คีย์ลับให้ส่งผ่านช่องทางที่ปลอดภัย (เช่น password manager แบบแชร์) **ห้ามส่งในแชท LINE/อีเมลธรรมดา**

| ค่า | ได้มาจาก | จำเป็น |
|---|---|---|
| `NODE_ENV=production` | — | ✔ |
| `APP_URL`, `FRONTEND_URL` | `https://coolkidscar.com` (ข้อ 2.1) | ✔ |
| `ALLOWED_ORIGINS` | `https://www.coolkidscar.com` ถ้าใช้ www | |
| `DB_HOST/PORT/NAME/USER/PASSWORD` | ข้อ 2.4 | ✔ |
| `COOKIE_SECRET`, `PII_ENCRYPTION_KEY`, `PII_HMAC_KEY` | ทีมพัฒนาสร้างใหม่บนเซิร์ฟเวอร์ (**ห้ามใช้ค่าเดียวกับเครื่องพัฒนา**) | ✔ |
| `ADMIN_LOGIN`, `ADMIN_PASSWORD` | ตั้งเอง รหัส **12 ตัวขึ้นไป** | ✔ |
| `BOOTSTRAP_SUPER_ADMINS` | อีเมล Google ของเจ้าของร้าน (ได้สิทธิ์สูงสุดตอนล็อกอินครั้งแรก) | |
| `LINE_CHANNEL_ID`, `LINE_CHANNEL_SECRET` | LINE Login channel (3.1) | ✔ |
| `LIFF_ID` | LIFF app (3.1) | ✔ |
| `LINE_MESSAGING_ACCESS_TOKEN`, `LINE_MESSAGING_CHANNEL_SECRET` | Messaging API (3.1) | ✔ |
| `PROMPTPAY_ID`, `PROMPTPAY_NAME` | ข้อ 3.2 | ✔ |
| `SLIPOK_BRANCH_ID`, `SLIPOK_API_KEY` | SlipOK (3.2) | |
| `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET_PUBLIC`, `S3_BUCKET_PRIVATE` | Cloudflare R2 (2.5) | แนะนำ |
| `GOOGLE_MAPS_API_KEY` | Google Cloud (3.3) | |
| `GOOGLE_CLIENT_ID/SECRET`, `FACEBOOK_APP_ID/SECRET` | ข้อ 3.3 | |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe (3.2) | |

> ระบบจะ **ไม่ยอมเปิด** ใน production ถ้า: URL ไม่ใช่ https, ไม่มีรหัสฐานข้อมูล, `COOKIE_SECRET` สั้นกว่า 48 ตัว
> หรือไม่มีช่องทางชำระเงินจริง (PromptPay หรือ Stripe) — เป็นการกันตั้งค่าผิดพลาด

---

## 6. ลำดับการขึ้นระบบ

| # | ใครทำ | ขั้นตอน |
|---|---|---|
| 1 | เจ้าของร้าน | จดโดเมน + ย้าย DNS ไป Cloudflare (2.1–2.2) |
| 2 | เจ้าของร้าน | เช่า VPS + ฐานข้อมูล + เปิด R2 แล้วส่งสิทธิ์ให้ทีม (2.3–2.5) |
| 3 | ทีมพัฒนา | ติดตั้ง Docker, ไฟร์วอลล์ (เปิดแค่ 22/443), Origin Certificate, รัน `web` + `api` (+ `db`) |
| 4 | ทีมพัฒนา | ตั้ง `.env` แล้วรัน `npm run db:setup` (สร้างตาราง + ข้อมูลร้าน/รถ 16 คัน ไม่มีข้อมูลทดสอบ, อัปโหลดรูปรถไป R2, สร้างแอดมินถ้าตั้ง `ADMIN_PASSWORD`) · ห้ามรัน `db:seed` / `db:seed:drivers` บนเครื่องจริง (เป็นข้อมูลตัวอย่าง) · ใส่ข้อมูลรถ/สัญญาจริง, สร้างบัญชีพนักงาน |
| 5 | เจ้าของร้าน | สร้าง LINE channel / LIFF / Messaging API ตามข้อ 3.1 แล้วส่งค่าให้ทีม |
| 6 | ทีมพัฒนา | อัปโหลด Rich menu (`npm run line:richmenu -- upload`), กด Verify webhook |
| 7 | ทั้งคู่ | ทดสอบจริงในแอป LINE: จอง → แนบเอกสาร → อนุมัติ → โอน 1,000 จริง → ยืนยันสลิป → ได้ PDF → อัปเดตสถานะ → ติดตามรถ |
| 8 | ทีมพัฒนา | ตั้ง backup รายวัน + ทดสอบกู้คืน, ตั้งแจ้งเตือนเมื่อระบบล่ม |
| 9 | เจ้าของร้าน | ประกาศให้ลูกค้าใช้เมนูใหม่ใน LINE |

---

## 7. ทดสอบกับ LINE ก่อน deploy (ไม่ต้องมีเซิร์ฟเวอร์)

- [ ] สร้าง **LINE OA ทดลอง** อีกบัญชี (ฟรี) ใต้ provider เดียวกัน — ไม่กระทบลูกค้าจริงของ @coolkidscar
- [ ] ทีมพัฒนาเปิด tunnel (Cloudflare Tunnel / ngrok) ได้ลิงก์ `https://….trycloudflare.com` ชี้มาที่เครื่องพัฒนา
- [ ] ใส่ลิงก์นั้นเป็น LIFF Endpoint URL, Webhook URL, LINE Login Callback ของ channel ทดลอง
- [ ] แอด OA ทดลองในมือถือ แล้วลองจองทั้ง flow
- ข้อจำกัด: ลิงก์ฟรีเปลี่ยนทุกครั้งที่เปิดใหม่ (ต้องแก้ URL ใน LINE ใหม่) และต้องเปิดคอมค้างไว้

---

## 8. ค่าใช้จ่ายโดยประมาณ

| รายการ | ประมาณการ |
|---|---|
| โดเมน | 400–1,000 บาท/ปี |
| VPS 2 vCPU / 4 GB + backup | 600–1,100 บาท/เดือน |
| Managed PostgreSQL (ถ้าเลือกแบบ B) | 500–700 บาท/เดือน |
| Cloudflare (DNS, HTTPS, R2 ≤ 10 GB) | ฟรี |
| LINE OA | ฟรี 300 ข้อความ/เดือน · เกินต้องอัปเกรดแพ็กเกจ |
| SlipOK (ถ้าใช้) | มีแพ็กเกจฟรีจำนวนจำกัด · ตามจำนวนสลิป |
| Google Maps (ถ้าใช้) | ส่วนใหญ่อยู่ในเครดิตฟรีรายเดือนสำหรับร้านขนาดนี้ |

ราคาเป็นค่าประมาณ ณ ตอนเขียน ตรวจราคาจริงกับผู้ให้บริการอีกครั้งก่อนสั่งซื้อ

---

## 9. งานฝั่งโค้ดที่ทีมพัฒนาจะเตรียมก่อนขึ้นจริง

- [x] `docker-compose.prod.yml` สำหรับเซิร์ฟเวอร์ — ขั้นตอนติดตั้งอยู่ใน [DEPLOY-VPS.md](DEPLOY-VPS.md)
- [x] ให้ nginx อ่าน IP จริงของลูกค้าจาก Cloudflare (`CF-Connecting-IP`) ไม่อย่างนั้นการจำกัดคำขอต่อ IP จะนับรวมทุกคนเป็น IP ของ Cloudflare
- [x] สคริปต์ backup ฐานข้อมูลรายวัน + ขั้นตอนกู้คืน (`deploy/backup-db.sh`, เก็บบน VPS — ยังไม่ได้ส่งไป R2)
- [ ] นำเข้าข้อมูลรถ / สาขา / ราคาจริงจากข้อ 4 และเปลี่ยนโลโก้ใน Rich menu
- [ ] ปุ่มบันทึกยอดที่ลูกค้าจ่ายวันรับรถ (ตอนนี้ยอดขายนับเฉพาะค่าจองที่โอนผ่านระบบ)
- [ ] รายการความปลอดภัยใน [SECURITY.md](SECURITY.md) หัวข้อ "Must be done at deployment"
