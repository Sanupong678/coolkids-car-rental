# ขึ้นเว็บบน VPS — coolkidscar.com

| | |
|---|---|
| VPS | `vps1.coolkidscar.com` · IP `14.207.142.106` · Ubuntu 24.04 |
| เว็บ | `https://coolkidscar.com` (`www.` จะ redirect มาที่โดเมนหลัก) |
| ระบบ | Docker: **caddy** (HTTPS อัตโนมัติ) → **web** (nginx + หน้าเว็บ) → **api** (Node) → **db** (PostgreSQL 16) |

ไฟล์ที่ใช้: [`docker-compose.prod.yml`](../docker-compose.prod.yml), [`deploy/`](../deploy) (Caddyfile, .env.example, backup-db.sh, pack.sh)
เปิดจากอินเทอร์เน็ตแค่พอร์ต 22 (SSH), 80, 443 — ฐานข้อมูลและ API ไม่เปิดออกนอกเครื่อง

---

## 1. ตั้ง DNS ของโดเมน

ที่หน้าจัดการโดเมน (ที่จดโดเมน หรือ Cloudflare ถ้าย้าย DNS ไปแล้ว) เพิ่ม record:

| Type | Name | Value |
|---|---|---|
| A | `@` (coolkidscar.com) | `14.207.142.106` |
| A | `www` | `14.207.142.106` |
| A | `vps1` | `14.207.142.106` |

- **ถ้าใช้ Cloudflare:** ตอนติดตั้งครั้งแรกให้ตั้งเป็น **DNS only (เมฆสีเทา)** ก่อน พอเว็บเปิดด้วย https ได้แล้ว ค่อยเปลี่ยนเป็น **Proxied (เมฆสีส้ม)** และตั้ง SSL/TLS mode = **Full (strict)**
- เช็กว่า DNS ใช้ได้แล้ว (รันบนเครื่องไหนก็ได้): `nslookup coolkidscar.com` ต้องได้ `14.207.142.106`

## 2. เข้าเครื่องด้วย SSH (จากคอมเครื่องนี้)

สร้าง SSH key ครั้งเดียว (Git Bash หรือ PowerShell):

```bash
ssh-keygen -t ed25519 -C "coolkids-vps"
```

ส่ง public key ขึ้นเครื่อง (ใช้รหัส root ที่ผู้ให้บริการให้มา พิมพ์ในหน้าต่างเองเท่านั้น):

```bash
cat ~/.ssh/id_ed25519.pub | ssh root@14.207.142.106 "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

จากนั้นเข้าเครื่องได้โดยไม่ต้องใช้รหัส:

```bash
ssh root@14.207.142.106
```

## 3. เตรียมเครื่อง (รันบน VPS ครั้งเดียว)

```bash
timedatectl set-timezone Asia/Bangkok
apt update && apt -y upgrade
apt -y install ca-certificates curl ufw

# ไฟร์วอลล์: SSH + เว็บเท่านั้น
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw --force enable

# Docker (แพ็กเกจทางการจาก docker.com)
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" > /etc/apt/sources.list.d/docker.list
apt update && apt -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin

# swap 2 GB (กัน RAM เต็มตอน build และตอนสร้าง PDF สัญญา) — ข้ามได้ถ้ามี swap อยู่แล้ว (เช็ก: free -h)
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab

mkdir -p /opt/coolkids
```

เมื่อเข้าด้วย SSH key ได้แล้ว ปิดการล็อกอินด้วยรหัสผ่าน (กันคนเดารหัส):

```bash
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config && systemctl restart ssh
```

## 4. ส่งโค้ดขึ้นเครื่อง (รันบนคอมเครื่องนี้ ในโฟลเดอร์โปรเจกต์)

```bash
sh deploy/pack.sh
```

```bash
scp coolkids.tgz root@14.207.142.106:/opt/coolkids/
```

`pack.sh` ไม่ใส่ไฟล์ `.env` (รหัสลับ), node_modules และวิดีโอต้นฉบับลงไป

บน VPS:

```bash
cd /opt/coolkids && tar -xzf coolkids.tgz && chmod +x deploy/*.sh
```

## 5. ตั้งค่า (บน VPS)

### 5.1 ไฟล์ `.env` ของ docker compose

```bash
cd /opt/coolkids
cp deploy/.env.example .env
sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=$(openssl rand -base64 36 | tr -d '/+=')|" .env

```

### 5.2 ไฟล์ `backend/.env` ของ API

```bash
cp backend/.env.example backend/.env
sed -i \
  -e "s|^NODE_ENV=.*|NODE_ENV=production|" \
  -e "s|^APP_URL=.*|APP_URL=https://coolkidscar.com|" \
  -e "s|^FRONTEND_URL=.*|FRONTEND_URL=https://coolkidscar.com|" \
  -e "s|^ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=https://www.coolkidscar.com|" \
  -e "s|^COOKIE_SECRET=.*|COOKIE_SECRET=$(openssl rand -base64 48 | tr -d '\n')|" \
  -e "s|^PII_ENCRYPTION_KEY=.*|PII_ENCRYPTION_KEY=$(openssl rand -base64 32)|" \
  -e "s|^PII_HMAC_KEY=.*|PII_HMAC_KEY=$(openssl rand -base64 48 | tr -d '\n')|" \
  backend/.env
nano backend/.env
```

ใน `nano` ใส่ค่าที่เหลือ — ส่วนใหญ่คัดลอกจาก `backend/.env` บนคอมเครื่องนี้ได้เลย:

| ค่า | ใส่อะไร |
|---|---|
| `DB_*` | **ไม่ต้องใส่** — docker compose กำหนดให้เอง |
| `ADMIN_LOGIN`, `ADMIN_PASSWORD` | บัญชีหลังบ้าน รหัส **12 ตัวขึ้นไป** (ห้ามใช้ `1234`) |
| `BOOTSTRAP_SUPER_ADMINS` | อีเมล Google ของเจ้าของร้าน |
| `GOOGLE_*`, `FACEBOOK_*`, `LINE_*`, `LIFF_ID` | ค่าเดิมจากเครื่องนี้ |
| `S3_*` (Cloudflare R2) | ค่าเดิม (แนะนำสร้าง bucket แยกสำหรับเว็บจริงทีหลัง ไม่ให้ปนกับข้อมูลทดสอบ) |
| `PROMPTPAY_*`, `SLIPOK_*`, `STRIPE_*`, `SMTP_*` | ค่าเดิม / ค่าจริง |

> `COOKIE_SECRET`, `PII_*` สร้างใหม่บนเครื่องนี้แล้ว — **อย่าคัดลอกจากเครื่องพัฒนา** และอย่าเปลี่ยนหลังเปิดใช้งาน
> (ถ้าเปลี่ยน `PII_ENCRYPTION_KEY` จะเปิดรูปบัตร/ใบขับขี่ที่เก็บไว้แล้วไม่ได้) — เก็บสำรองไฟล์ `backend/.env` ไว้ในที่ปลอดภัย

## 6. เปิดระบบ (บน VPS)

```bash
cd /opt/coolkids
docker compose -f docker-compose.prod.yml up -d --build
```

ครั้งแรกใช้เวลาหลายนาที (build หน้าเว็บ + ติดตั้ง Chromium) จากนั้นสร้างข้อมูลร้าน (ตาราง, รถ 16 คัน, สาขา, สัญญา, แอดมิน):

```bash
docker compose -f docker-compose.prod.yml run --rm api node src/db/setup.js
```

> ห้ามรัน `db:seed` หรือ `db:seed:drivers` บนเครื่องจริง (เป็นข้อมูลตัวอย่าง)

ตรวจสอบ:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=50 caddy api
curl -I https://coolkidscar.com
```

- `caddy` ขึ้น `certificate obtained successfully` = ได้ HTTPS แล้ว (DNS ข้อ 1 ต้องชี้ถูกก่อน)
- `curl` ได้ `HTTP/2 200` = เว็บเปิดได้

## 7. เปลี่ยน URL ที่บริการภายนอก (จาก localhost → โดเมนจริง)

| ที่ | ค่าใหม่ |
|---|---|
| Google Cloud → OAuth client → Authorised redirect URIs | `https://coolkidscar.com/api/v1/auth/google/callback` |
| Facebook Login → Valid OAuth Redirect URIs | `https://coolkidscar.com/api/v1/auth/facebook/callback` |
| LINE Login channel → Callback URL | `https://coolkidscar.com/api/v1/auth/line/callback` |
| LINE Login → LIFF → Endpoint URL | `https://coolkidscar.com` |
| Messaging API → Webhook URL (เปิด Use webhook แล้วกด Verify) | `https://coolkidscar.com/api/v1/webhooks/line` |
| Stripe → Webhooks (ถ้าใช้) | `https://coolkidscar.com/api/v1/webhooks/stripe` |
| Google Maps API key → จำกัด IP | `14.207.142.106` |

Rich menu ของ LINE (ลิงก์ชี้ไป LIFF) — รันจาก **คอมเครื่องนี้** เพราะรูปเมนูอยู่ใน `assets-src/line/`
(ใส่ `LINE_MESSAGING_ACCESS_TOKEN` และ `LIFF_ID` ของ OA จริงใน `backend/.env` ของเครื่องนี้ก่อน):

```bash
npm --prefix backend run line:richmenu -- upload
```

## 8. Backup ฐานข้อมูลทุกวัน

```bash
(crontab -l 2>/dev/null; echo "30 3 * * * /opt/coolkids/deploy/backup-db.sh >> /var/log/coolkids-backup.log 2>&1") | crontab -
/opt/coolkids/deploy/backup-db.sh      # ลองครั้งแรก → /opt/coolkids/backups/db-YYYY-MM-DD.sql.gz
```

เก็บไว้ 14 วันบนเครื่อง (ไฟล์อ่านได้เฉพาะ root) และส่งสำเนาขึ้น R2 bucket ส่วนตัว `backups/db/` เก็บ 30 วัน
วิธีกู้คืนเขียนไว้หัวไฟล์ [`deploy/backup-db.sh`](../deploy/backup-db.sh) · ทดสอบว่ากู้ได้จริง (ฐานข้อมูลชั่วคราว ไม่แตะของจริง) เดือนละครั้ง:

```bash
sh deploy/restore-test.sh
```

## 9. อัปเดตเว็บครั้งต่อไป

บนคอมเครื่องนี้: `sh deploy/pack.sh` แล้ว `scp coolkids.tgz root@14.207.142.106:/opt/coolkids/` จากนั้นบน VPS:

```bash
cd /opt/coolkids && tar -xzf coolkids.tgz && rm coolkids.tgz
sh deploy/run-tests.sh      # ชุดทดสอบ 103 ข้อ กับฐานข้อมูลทดสอบชั่วคราว (~2 นาที)
sh deploy/release.sh        # build + restart, เก็บ image เดิมไว้เป็น :previous, ตรวจเว็บตอบ ถ้าไม่ตอบจะย้อนกลับเอง
```

ถ้าเวอร์ชันใหม่มีปัญหา ย้อนกลับเวอร์ชันก่อนหน้าได้ทันที: `sh deploy/rollback.sh`
(หรือ `sh deploy/rollback.sh 20261025-1240` สำหรับเวอร์ชันที่ระบุ · ดูรายการด้วย `docker images coolkids-api`)
ถ้าเวอร์ชันนั้นมี migration ที่เปลี่ยนตาราง ต้องย้อน migration เองก่อน

Load test (อ่านอย่างเดียว ไม่จองจริง, ~1 นาที): `docker run --rm -i grafana/k6 run - < deploy/load-test.js`

API เชื่อมต่อฐานข้อมูลด้วย `coolkids_app` (ไม่ใช่ superuser, รหัสอยู่ใน `.env` → `DB_APP_PASSWORD`) ·
`coolkids` (superuser) ใช้เฉพาะ backup/งานดูแล · ถ้าสร้างฐานข้อมูลใหม่ ให้รัน `deploy/app-db-role.sql` (วิธีใช้อยู่หัวไฟล์)

`.env` ทั้งสองไฟล์และข้อมูลในฐานข้อมูลไม่ถูกแตะ · migration ใหม่รันเองตอน api เริ่ม ·
ถ้าแก้รายการรถใน `seed-coolkids.js` ให้รันเพิ่ม: `docker compose -f docker-compose.prod.yml run --rm api node src/db/seed-coolkids.js`

## คำสั่งที่ใช้บ่อย

```bash
cd /opt/coolkids
docker compose -f docker-compose.prod.yml logs -f api          # ดู log ของ API
docker compose -f docker-compose.prod.yml restart api          # รีสตาร์ต API (หลังแก้ backend/.env)
docker compose -f docker-compose.prod.yml exec db psql -U coolkids -d car_rental   # เข้าฐานข้อมูล
```
