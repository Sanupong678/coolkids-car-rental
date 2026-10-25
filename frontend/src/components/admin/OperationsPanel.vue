<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { getOperations, setBookingStatus } from '@/api/admin'
import { currentPosition } from '@/utils/staffLocation'
import { money } from '@/utils/format'
import Icon from '@/components/ui/Icon.vue'
import DocumentsDialog from '@/components/admin/ops/DocumentsDialog.vue'
import MileageDialog from '@/components/admin/ops/MileageDialog.vue'
import PaymentDialog from '@/components/admin/ops/PaymentDialog.vue'
import { documentUrl } from '@/api/bookings'

// Dispatch board. Staff press the buttons; the customer's tracker updates:
//   รับงาน (กำลังเตรียมเอกสาร) → ออกส่งรถ (กำลังส่งรถ) → ส่งมอบแล้ว (ถึงที่หมาย)
// Each row also carries the booking's tools: ชำระเงิน (money at hand-over),
// รายได้ (ledger + deposit back), ไมล์ (odometer) and เอกสาร (contract, booking slip,
// receipts: preview, sign, PDF, send to the customer).
// ?booking=COOL-… (from the booking timeline) opens the right list and highlights that row.
const BUCKETS = [
  ['today', 'รายการวันนี้'],
  ['to_deliver', 'เตรียมส่งรถ'],
  ['in_delivery', 'กำลังส่ง'],
  ['delivered', 'ส่งแล้ว'],
  ['cancelled', 'ยกเลิก'],
  ['pending_payment', 'รอชำระเงิน'],
]
const STATUS = {
  PENDING: ['รอชำระเงิน', 'warn'], CONFIRMED: ['ชำระแล้ว · รอรับงาน', 'new'], PREPARING: ['กำลังเตรียมเอกสาร', 'info'],
  READY: ['รถพร้อมรับที่สาขา', 'info'], IN_DELIVERY: ['กำลังส่งรถ', 'go'], ACTIVE: ['ส่งมอบแล้ว · กำลังเช่า', 'ok'],
  COMPLETED: ['คืนรถแล้ว', 'muted'], CANCELLED: ['ยกเลิก', 'bad'], EXPIRED: ['หมดเวลาชำระ', 'muted'], REFUNDED: ['คืนเงินแล้ว', 'muted'],
}
const ACTION = {
  PREPARING: ['รับงาน · เตรียมเอกสาร', 'receipt'],
  READY: ['รถพร้อมให้รับ', 'check'],
  IN_DELIVERY: ['ออกส่งรถ', 'car'],
  ACTIVE: ['ส่งมอบแล้ว / ถึงที่หมาย', 'flag'],
  COMPLETED: ['รับรถคืนแล้ว', 'check'],
  CANCELLED: ['ยกเลิก', 'x'],
}

const tz = 'Asia/Bangkok'
const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())
const date = ref(todayIso())
const bucket = ref('today')
const data = ref(null)
const busyId = ref(null)
const error = ref('')
let timer

async function load() {
  try {
    data.value = await getOperations(date.value)
    error.value = ''
  } catch (err) {
    error.value = err.message
  }
}
onMounted(() => {
  load()
  timer = setInterval(load, 30_000)
})
onBeforeUnmount(() => clearInterval(timer))
watch(date, load)

const rows = computed(() => data.value?.lists[bucket.value] ?? [])

// ---- tools on a row
const tool = ref(null) // { kind: 'pay' | 'ledger' | 'mileage' | 'contract', booking }
const open = (kind, booking) => (tool.value = { kind, booking })
const onToolClose = () => {
  tool.value = null
  load()
}

// ---- deep link from the timeline: find the booking's list and scroll to it
const route = useRoute()
const focus = ref(null)
async function focusBooking(number) {
  if (!number || !data.value) return
  const hit = Object.entries(data.value.lists).find(([k, list]) => k !== 'today' && list.some((b) => b.number === number))
    ?? Object.entries(data.value.lists).find(([, list]) => list.some((b) => b.number === number))
  if (!hit) return
  bucket.value = hit[0]
  focus.value = number
  await nextTick()
  document.getElementById(`job-${number}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}
watch([() => route.query.booking, data], ([n]) => n !== focus.value && focusBooking(n))

// Delivery jobs skip "ready at branch"; branch pick-ups never go "on the way".
function actionsFor(b) {
  return (data.value?.next[b.status] ?? []).filter((s) => (b.fulfillment === 'DELIVERY' ? s !== 'READY' : s !== 'IN_DELIVERY'))
}

async function act(b, status) {
  let reason
  if (status === 'CANCELLED') {
    reason = window.prompt(`ยกเลิกการจอง ${b.number}? ระบุเหตุผล`)
    if (reason == null) return
  }
  busyId.value = b.id
  try {
    await setBookingStatus(b.id, status, reason || undefined, await currentPosition())
    await load()
  } catch (err) {
    error.value = err.message
  } finally {
    busyId.value = null
  }
}

const DOC_LABEL = { id_front: 'บัตร (หน้า)', id_back: 'บัตร (หลัง)', license_front: 'ใบขับขี่' }
// A PENDING booking waits on staff first (documents), then on the customer (reservation fee).
const REVIEW_PILL = { SUBMITTED: ['รอตรวจเอกสาร', 'new'], CHANGES_REQUESTED: ['รอลูกค้าแก้เอกสาร', 'warn'] }
const pill = (b) => (b.status === 'PENDING' && REVIEW_PILL[b.review?.status]) || STATUS[b.status]
const awaitsReview = (b) => b.status === 'PENDING' && ['SUBMITTED', 'CHANGES_REQUESTED'].includes(b.review?.status)
const dt = (iso) => new Date(iso).toLocaleString('th-TH', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const time = (iso) => new Date(iso).toLocaleString('th-TH', { timeZone: tz, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const clock = (iso) => new Date(iso).toLocaleTimeString('th-TH', { timeZone: tz, hour: '2-digit', minute: '2-digit' })
</script>

<template>
  <div class="ops">
    <div class="bar">
      <div class="tabs" role="tablist">
        <button v-for="[k, l] in BUCKETS" :key="k" type="button" role="tab" :aria-selected="bucket === k" :class="{ on: bucket === k }" @click="bucket = k">
          {{ l }} <span>{{ data?.counts[k] ?? '·' }}</span>
        </button>
      </div>
      <label v-if="bucket === 'today'" class="date"><Icon name="calendar" :size="14" /><input v-model="date" type="date" /></label>
    </div>
    <p v-if="error" class="err" role="alert">{{ error }}</p>

    <ul v-if="rows.length" class="jobs">
      <li v-for="b in rows" :id="`job-${b.number}`" :key="b.id" class="job" :class="{ focus: focus === b.number }">
        <div class="row">
          <div class="c-id">
            <strong class="num">{{ b.number }}</strong>
            <small>{{ dt(b.createdAt) }}</small>
            <img v-if="b.vehicle.image" :src="b.vehicle.image.variants?.w640 ?? b.vehicle.image.url" alt="" loading="lazy" />
            <span class="pill" :class="pill(b)?.[1]">{{ pill(b)?.[0] ?? b.status }}</span>
          </div>
          <div class="c-car">
            <span class="fleet">{{ b.vehicle.fleetNo ?? '–' }}</span>
            <strong>{{ b.vehicle.brand }} {{ b.vehicle.model }}</strong>
            <small>{{ b.vehicle.trim }}</small>
            <span class="plate">{{ b.vehicle.plate }}</span>
          </div>
          <div class="c-cust">
            <span v-if="b.ops?.customerTrips" class="trips" title="เคยเช่ากับร้านแล้ว"><Icon name="star" :size="12" /> {{ b.ops.customerTrips }}</span>
            <strong>{{ b.customer.fullName ?? '—' }} <em v-if="b.customer.country && b.customer.country !== 'TH'">{{ b.customer.country }}</em></strong>
            <a v-if="b.customer.phone" :href="`tel:${b.customer.phone}`" class="tel"><Icon name="phone" :size="13" /> {{ b.customer.phone }}</a>
          </div>
          <div class="c-dates">
            <span><i class="dot on" />{{ dt(b.pickupAt) }}</span>
            <span><i class="dot" />{{ dt(b.returnAt) }}</span>
          </div>
          <div class="c-place">
            <span><small>ส่งรถ:</small> <Icon name="pin" :size="13" /> {{ b.fulfillment === 'DELIVERY' ? b.delivery?.address : 'รับด้วยตนเอง' }}</span>
            <span><small>คืน:</small> <Icon name="pin" :size="13" /> {{ b.returnPlace?.type === 'ADDRESS' ? b.returnPlace.address : b.returnPlace?.type === 'SAME_AS_DELIVERY' ? 'รับคืนที่จุดส่ง' : 'คืนที่สาขา' }}</span>
            <a v-if="b.returnPlace?.type === 'ADDRESS' && b.returnPlace.mapsUrl" :href="b.returnPlace.mapsUrl" target="_blank" rel="noopener" class="nav">นำทางจุดคืน</a>
            <a v-if="b.delivery?.mapsUrl" :href="b.delivery.mapsUrl" target="_blank" rel="noopener" class="nav">นำทาง</a>
          </div>
          <div class="c-upd">
            <button type="button" :disabled="b.status === 'PENDING'" @click="open('pay', b)"><Icon name="receipt" :size="14" /> ชำระเงิน</button>
            <button v-if="b.status !== 'PENDING' && b.ops?.dueMinor > 0" type="button" class="qr-pay" @click="open('qr', b)"><Icon name="receipt" :size="14" /> QR ชำระเงิน</button>
            <button type="button" :disabled="b.status === 'PENDING'" @click="open('ledger', b)"><Icon name="chart" :size="14" /> รายได้</button>
            <button type="button" :disabled="b.status === 'PENDING'" @click="open('mileage', b)"><Icon name="gauge" :size="14" /> ไมล์</button>
            <button v-if="b.contract" type="button" @click="open('contract', b)"><Icon name="printer" :size="14" /> เอกสาร</button>
            <span v-if="b.ops?.paidOnlineMinor" class="fee">+{{ money(b.ops.paidOnlineMinor, b.money.currency) }}</span>
          </div>
          <div class="c-money">
            <span><small>ค่าเช่า:</small> <b>{{ money(b.money.totalMinor, b.money.currency) }}</b></span>
            <span><small>ค่ามัดจำ:</small> <b>{{ money(b.money.depositMinor, b.money.currency) }}</b></span>
            <span v-if="b.ops?.paidOnlineMinor" class="paid"><small>เงินจอง:</small> <b>−{{ money(b.ops.paidOnlineMinor, b.money.currency) }}</b> <Icon name="check" :size="12" /></span>
            <span v-if="b.ops?.paidCounterMinor" class="paid"><small>รับหน้าร้าน:</small> <b>−{{ money(b.ops.paidCounterMinor + b.ops.depositCollectedMinor, b.money.currency) }}</b></span>
            <span class="due"><small>เรียกเก็บ:</small> <b>{{ money(b.ops?.dueMinor ?? 0, b.money.currency) }}</b></span>
            <span v-if="b.ops?.paidCounterMinor || b.ops?.depositCollectedMinor" class="badge"><Icon name="shield" :size="12" /> รับเงินค่าเช่าและมัดจำแล้ว</span>
            <span v-if="b.ops?.depositReturnedAt" class="badge ok"><Icon name="check" :size="12" /> คืนมัดจำแล้ว</span>
            <span v-else-if="b.status === 'COMPLETED' && b.ops?.depositCollectedMinor" class="badge warn">รอคืนมัดจำ</span>
          </div>
        </div>
        <div class="act">
          <RouterLink v-if="awaitsReview(b)" :to="{ query: { tab: 'approvals', booking: b.number } }" class="go review">
            <Icon name="user" :size="14" /> ตรวจเอกสาร
          </RouterLink>
          <button
            v-for="st in actionsFor(b)"
            :key="st"
            type="button"
            :class="st === 'CANCELLED' ? 'ghost' : 'go'"
            :disabled="busyId === b.id"
            @click="act(b, st)"
          >
            <Icon :name="ACTION[st][1]" :size="14" /> {{ ACTION[st][0] }}
          </button>
          <span v-if="b.documents" class="docs">
            <a
              v-for="k in b.documents.required"
              :key="k"
              :href="b.documents.uploaded[k] ? documentUrl(b.number, k) : undefined"
              target="_blank"
              rel="noopener"
              :class="{ missing: !b.documents.uploaded[k] }"
              :title="b.documents.uploaded[k] ? 'เปิดรูปเอกสาร' : 'ลูกค้ายังไม่ส่ง'"
            >
              <Icon :name="b.documents.uploaded[k] ? 'check' : 'x'" :size="12" /> {{ DOC_LABEL[k] }}
            </a>
          </span>
        </div>
      </li>
    </ul>
    <p v-else-if="data" class="none">ไม่มีรายการ</p>

    <PaymentDialog v-if="['pay', 'qr', 'ledger'].includes(tool?.kind)" :booking="tool.booking" :mode="{ pay: 'collect', qr: 'qr', ledger: 'ledger' }[tool.kind]" @close="onToolClose" />
    <MileageDialog v-if="tool?.kind === 'mileage'" :booking="tool.booking" @close="onToolClose" />
    <DocumentsDialog v-if="tool?.kind === 'contract'" :booking="tool.booking" @close="onToolClose" />
    <div v-else-if="!error" class="skeleton" style="height: 240px" />
  </div>
</template>

<style scoped>
.row {
  display: grid;
  grid-template-columns: 150px 150px 1.1fr 170px 1.2fr 130px 210px;
  gap: 14px;
  align-items: start;
  font-size: 0.85rem;
}
.row > div {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.job.focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgb(226 54 44 / 0.35);
}
.c-id .num {
  color: #9cc4ff;
  letter-spacing: 0.02em;
}
.c-id small,
.c-car small,
.row small {
  color: var(--viz-muted);
}
.c-id img {
  width: 100%;
  max-width: 140px;
  aspect-ratio: 16 / 10;
  object-fit: contain;
  border-radius: 10px;
  background: rgb(255 255 255 / 0.9);
}
.c-id .pill {
  justify-self: start;
}
.c-car {
  justify-items: center;
  text-align: center;
}
.fleet {
  display: grid;
  place-items: center;
  min-width: 28px;
  height: 28px;
  padding: 0 6px;
  border-radius: 8px;
  background: #0e2a52;
  color: #fff;
  font-weight: 800;
}
.trips {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  justify-self: start;
  padding: 0 6px;
  border-radius: 999px;
  background: rgb(255 196 0 / 0.18);
  color: #ffd25e;
  font-size: 0.72rem;
}
.tel {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #5fd39a;
}
.c-dates {
  position: relative;
  gap: 14px !important;
  padding-left: 14px;
}
.c-dates::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 8px;
  bottom: 8px;
  border-left: 1px solid var(--viz-border);
}
.c-dates span {
  position: relative;
}
.dot {
  position: absolute;
  left: -14px;
  top: 5px;
  width: 9px;
  height: 9px;
  border: 1.5px solid var(--viz-text);
  border-radius: 50%;
  background: transparent;
}
.dot.on {
  background: var(--viz-text);
}
.c-place span {
  display: inline-flex;
  align-items: flex-start;
  gap: 4px;
}
.c-upd button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 10px;
  border: 1px solid var(--viz-border);
  border-radius: 10px;
  background: rgb(255 255 255 / 0.06);
  color: var(--viz-text);
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
}
.c-upd button:hover:not(:disabled) {
  border-color: var(--viz-text);
}
.c-upd button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.fee {
  color: #ffd25e;
  font-size: 0.75rem;
  text-align: center;
}
.c-money span {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.c-money b {
  font-variant-numeric: tabular-nums;
}
.c-money .paid b {
  color: #5fd39a;
}
.c-money .due {
  padding-top: 4px;
  border-top: 1px dashed var(--viz-border);
}
.c-money .due b {
  color: #ff8a82;
  font-size: 1rem;
}
.badge {
  justify-content: center !important;
  align-items: center;
  padding: 3px 8px;
  border: 1px solid rgb(255 138 130 / 0.5);
  border-radius: 999px;
  color: #ffb3ad;
  font-size: 0.72rem;
}
.badge.ok {
  border-color: rgb(95 211 154 / 0.5);
  color: #8fe5b8;
}
.badge.warn {
  border-color: rgb(255 181 71 / 0.5);
  color: #ffd29a;
}
@media (max-width: 1280px) {
  .row {
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  }
}
.ops {
  display: grid;
  gap: 14px;
}
.bar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
}
.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.tabs button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px solid var(--viz-border);
  border-radius: 999px;
  background: var(--viz-surface);
  -webkit-backdrop-filter: var(--viz-glass);
  backdrop-filter: var(--viz-glass);
  color: var(--viz-text);
  font-size: 0.85rem;
  cursor: pointer;
}
.tabs button span {
  min-width: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--viz-surface-strong);
  font-size: 0.72rem;
  font-weight: 700;
  text-align: center;
}
.tabs button.on {
  background: var(--viz-cream);
  border-color: var(--viz-cream);
  color: #15171e;
  font-weight: 600;
}
.tabs button.on span {
  background: var(--accent);
  color: #fff;
}
.date {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid var(--viz-border);
  border-radius: 999px;
  background: var(--viz-surface);
  -webkit-backdrop-filter: var(--viz-glass);
  backdrop-filter: var(--viz-glass);
}
.date input {
  border: 0;
  background: none;
  font: inherit;
}
.jobs {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.job {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--viz-border);
  border-radius: 18px;
  background: var(--viz-surface);
  -webkit-backdrop-filter: var(--viz-glass);
  backdrop-filter: var(--viz-glass);
}
.plate {
  justify-self: start;
  padding: 1px 8px;
  border: 1px solid var(--viz-border);
  border-radius: 6px;
  font-weight: 700;
  font-size: 0.8rem;
}
.nav {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.8rem;
}
.act {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px dashed var(--viz-border);
}
.act button,
.act .review {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 10px;
  font-weight: 600;
  font-size: 0.85rem;
  cursor: pointer;
}
.act .go {
  border: 0;
  background: var(--accent);
  color: #fff;
}
.act .review {
  text-decoration: none;
}
.act .ghost {
  border: 1px solid var(--viz-border);
  background: none;
  color: var(--viz-muted);
}
.act button:disabled {
  opacity: 0.5;
}
.act .print {
  margin-left: auto;
}
.docs {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.docs a {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 9px;
  border: 1px solid rgb(95 211 154 / 0.4);
  border-radius: 999px;
  color: var(--ok);
  font-size: 0.74rem;
}
.docs a.missing {
  border-color: var(--viz-border);
  color: var(--viz-muted);
  pointer-events: none;
}
.pill {
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
  background: var(--viz-surface-strong);
  color: var(--viz-muted);
}
.pill.new,
.pill.bad {
  background: rgb(255 127 118 / 0.18);
  color: var(--bad);
}
.pill.info {
  background: rgb(91 157 255 / 0.18);
  color: #9cc4ff;
}
.pill.go,
.pill.warn {
  background: rgb(243 182 100 / 0.18);
  color: var(--warn);
}
.pill.ok {
  background: rgb(95 211 154 / 0.18);
  color: var(--ok);
}
.none {
  padding: 40px;
  text-align: center;
  color: var(--viz-muted);
}
.err {
  color: var(--bad);
}
@media (max-width: 760px) {
}
.c-upd .qr-pay {
  border-color: #1f9d55;
  background: #1f9d55;
  color: #fff;
}
</style>
