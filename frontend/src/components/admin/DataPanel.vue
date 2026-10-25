<script setup>
import { onMounted, ref } from 'vue'
import { exportUrl, listDatasets } from '@/api/admin'
import Icon from '@/components/ui/Icon.vue'

// Self-serve data for analysts, data scientists and data engineers: flat,
// pseudonymised exports (CSV for Excel/Sheets, JSON for notebooks) plus the
// metric definitions the dashboard uses, so numbers reconcile everywhere.
const tz = 'Asia/Bangkok'
const iso = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d)
const to = ref(iso(new Date()))
const from = ref(iso(new Date(Date.now() - 89 * 86_400_000)))
const datasets = ref([])
onMounted(async () => {
  datasets.value = await listDatasets().catch(() => [])
})

const METRICS = [
  ['รายได้ (Revenue)', 'ยอดชำระสำเร็จ − เงินคืน ตามวันที่ชำระ (cash basis) เวลาไทย', 'payments.amount_minor − amount_refunded_minor'],
  ['การจอง (Bookings)', 'การจองที่ชำระเงินแล้ว นับตามวันที่ยืนยัน (confirmed_at)', 'bookings.confirmed_at IS NOT NULL'],
  ['Conversion', 'การจองที่ชำระแล้ว ÷ การจองที่สร้างในช่วงเดียวกัน', 'confirmed / created'],
  ['อัตรายกเลิก', 'ยกเลิก ÷ (ชำระแล้ว + ยกเลิก) ของการจองที่สร้างในช่วง', "status IN ('CANCELLED','REFUNDED')"],
  ['อัตราการใช้รถ', 'ชั่วโมงที่ถูกจอง ÷ (จำนวนรถที่เปิดให้จอง × ชั่วโมงในช่วง)', 'vehicle_availability_blocks'],
  ['Lead time', 'วันรับรถ − วันที่สร้างการจอง (วัน)', 'pickup_at − created_at'],
  ['ETA error', 'เวลาส่งถึงจริง − ETA ตอนออกส่ง (นาที, + = ช้ากว่าคาด)', 'delivered_at − delivery_eta_at'],
  ['customer_key', 'รหัสลูกค้าแบบนามแฝง (HMAC-SHA256 ของ user id) — join ข้ามไฟล์ได้ แต่ระบุตัวบุคคลไม่ได้', 'hmac(user_id, PII_HMAC_KEY)'],
]
</script>

<template>
  <div class="data">
    <section class="card">
      <header>
        <h3>ดาวน์โหลดข้อมูล</h3>
        <div class="range">
          <label>จาก <input v-model="from" type="date" :max="to" /></label>
          <label>ถึง <input v-model="to" type="date" :min="from" /></label>
        </div>
      </header>
      <ul class="ds">
        <li v-for="d in datasets" :key="d.name">
          <div>
            <strong>{{ d.name }}</strong>
            <small>{{ d.description }}</small>
          </div>
          <a :href="exportUrl(d.name, from, to, 'csv')" download><Icon name="receipt" :size="14" /> CSV</a>
          <a :href="exportUrl(d.name, from, to, 'json')" target="_blank" rel="noopener">JSON</a>
        </li>
      </ul>
      <p class="note">
        <Icon name="shield" :size="14" />
        ไฟล์ไม่มีชื่อ อีเมล เบอร์โทร หรือเลขเอกสาร (PDPA) — ลูกค้าแทนด้วย <code>customer_key</code> · เงินเป็นหน่วยสตางค์ (<code>*_minor</code>) · เวลาเป็น UTC ISO-8601
      </p>
    </section>

    <section class="card">
      <h3>นิยามตัวชี้วัด (Metric definitions)</h3>
      <table>
        <thead>
          <tr><th>ตัวชี้วัด</th><th>นิยาม</th><th>ที่มา</th></tr>
        </thead>
        <tbody>
          <tr v-for="[m, d, s] in METRICS" :key="m"><td>{{ m }}</td><td>{{ d }}</td><td><code>{{ s }}</code></td></tr>
        </tbody>
      </table>
    </section>

    <section class="card">
      <h3>สำหรับ Data Engineer</h3>
      <ul class="eng">
        <li><b>OLTP</b> PostgreSQL schema <code>public</code> — ตารางหลัก <code>bookings</code>, <code>booking_items</code>, <code>booking_status_history</code> (event log), <code>payments</code>, <code>payment_transactions</code>, <code>delivery_assignments</code>, <code>delivery_tracking</code>, <code>vehicle_price_history</code>, <code>audit_logs</code></li>
        <li><b>Warehouse</b> star schema <code>dw</code> (dim_date, dim_customer SCD2, dim_vehicle SCD2, fact_bookings, fact_payments, fact_vehicle_usage …) พร้อม watermark ใน <code>dw.etl_runs</code> สำหรับ incremental load</li>
        <li><b>CDC / streaming</b> ทุกการเปลี่ยนสถานะเขียนลง <code>outbox_events</code> ใน transaction เดียวกัน (booking.created, booking.confirmed, booking.status_changed) — ต่อ Kafka/Pub/Sub ได้โดยไม่พลาด event</li>
        <li><b>API</b> <code>GET /api/v1/admin/exports/{dataset}.json?from=YYYY-MM-DD&amp;to=YYYY-MM-DD</code> (ใช้ session ของ admin)</li>
      </ul>
      <pre><code>import pandas as pd
df = pd.read_csv("coolkids_bookings_{{ from }}_{{ to }}.csv", parse_dates=["created_at", "pickup_at"])
df["revenue_thb"] = df.total_minor / 100
df.groupby(df.pickup_at.dt.day_name()).revenue_thb.sum()</code></pre>
    </section>
  </div>
</template>

<style scoped>
.data {
  display: grid;
  gap: 14px;
}
.card {
  display: grid;
  gap: 12px;
  padding: 18px;
  border: 1px solid var(--viz-border);
  border-radius: 18px;
  background: var(--viz-surface);
  -webkit-backdrop-filter: var(--viz-glass);
  backdrop-filter: var(--viz-glass);
}
header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
}
h3 {
  font-family: var(--font-body);
  font-size: 1rem;
  letter-spacing: 0;
}
.range {
  display: flex;
  gap: 10px;
  font-size: 0.82rem;
  color: var(--viz-muted);
}
.range input {
  margin-left: 4px;
  padding: 4px 8px;
  border: 1px solid var(--viz-border);
  border-radius: 8px;
  background: rgb(255 255 255 / 0.06);
  font: inherit;
}
.ds {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.ds li {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgb(255 255 255 / 0.05);
}
.ds div {
  display: grid;
}
.ds small {
  color: var(--viz-muted);
  font-size: 0.78rem;
}
.ds a {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border: 1px solid var(--viz-border);
  border-radius: 8px;
  background: var(--viz-surface-strong);
  color: var(--viz-text);
  font-size: 0.8rem;
  font-weight: 600;
}
.note {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  font-size: 0.78rem;
  color: var(--viz-muted);
}
code {
  padding: 1px 5px;
  border-radius: 4px;
  background: rgb(255 255 255 / 0.1);
  font-size: 0.78em;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}
th,
td {
  padding: 8px;
  text-align: left;
  vertical-align: top;
  border-bottom: 1px solid var(--viz-grid);
}
th {
  color: var(--viz-muted);
  font-weight: 600;
}
.eng {
  display: grid;
  gap: 8px;
  padding-left: 18px;
  font-size: 0.85rem;
}
pre {
  overflow-x: auto;
  padding: 12px;
  border-radius: 10px;
  background: rgb(0 0 0 / 0.35);
  color: #e6e6e6;
}
pre code {
  background: none;
  color: inherit;
  font-size: 0.8rem;
}
</style>
