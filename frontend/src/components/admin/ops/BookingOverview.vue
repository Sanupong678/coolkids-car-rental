<script setup>
import { computed, onMounted, ref } from 'vue'
import { bookingOverview } from '@/api/admin'
import Icon from '@/components/ui/Icon.vue'
import OpsDialog from './OpsDialog.vue'

// Board detail popup (any tab): where the booking stands and how it got there, when and
// where to collect the car, and what this car has next — the following renters and any
// service or document falling due.
const props = defineProps({ booking: { type: Object, required: true } })
const emit = defineEmits(['close', 'open'])
const data = ref(null)
const error = ref('')
onMounted(async () => {
  try {
    data.value = await bookingOverview(props.booking.id)
  } catch (err) {
    error.value = err.message
  }
})

const LABEL = {
  PENDING: 'รออนุมัติ / รอชำระ', CONFIRMED: 'ยืนยันแล้ว · รอรับงาน', PREPARING: 'กำลังเตรียมรถ', READY: 'รถพร้อม',
  IN_DELIVERY: 'กำลังส่งรถ', ACTIVE: 'ระหว่างใช้งาน', COMPLETED: 'คืนรถแล้ว', CANCELLED: 'ยกเลิก', EXPIRED: 'หมดเวลาชำระ', REFUNDED: 'คืนเงินแล้ว',
}
// the path a booking walks; each status sits on one step
const STEPS = [
  ['รออนุมัติ', ['PENDING']],
  ['รอส่ง', ['CONFIRMED', 'PREPARING', 'READY']],
  ['กำลังส่ง', ['IN_DELIVERY']],
  ['ระหว่างใช้', ['ACTIVE']],
  ['จบงาน', ['COMPLETED']],
]
const b = computed(() => data.value?.booking ?? null)
const closed = computed(() => ['CANCELLED', 'EXPIRED', 'REFUNDED'].includes(b.value?.status))
const stepAt = computed(() => STEPS.findIndex(([, s]) => s.includes(b.value?.status)))

const dt = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '—')
function until(iso) {
  const min = Math.round((new Date(iso) - Date.now()) / 60_000)
  const span = (m) => (m >= 1440 ? `${Math.floor(m / 1440)} วัน ${Math.floor((m % 1440) / 60)} ชม.` : m >= 60 ? `${Math.floor(m / 60)} ชม. ${m % 60} นาที` : `${m} นาที`)
  return min >= 0 ? `อีก ${span(min)}` : `เลยเวลามา ${span(-min)}`
}
const late = (iso) => new Date(iso) < new Date()

// where the car is collected / handed over
const returnPlace = computed(() => {
  const r = b.value?.returnPlace
  if (r?.type === 'ADDRESS') return r.address
  if (r?.type === 'SAME_AS_DELIVERY') return b.value.delivery?.address
  return `สาขา ${b.value?.branch ?? ''}`.trim()
})
const pickupPlace = computed(() => (b.value?.fulfillment === 'DELIVERY' ? b.value.delivery?.address : `รับที่สาขา ${b.value?.branch ?? ''}`.trim()))
const delivered = computed(() => ['ACTIVE', 'COMPLETED'].includes(b.value?.status))
</script>

<template>
  <OpsDialog :title="booking.number" icon="receipt" wide @close="emit('close')">
    <p v-if="error" class="err" role="alert">{{ error }}</p>
    <div v-else-if="!b" class="skeleton" style="height: 260px" />
    <template v-else>
      <div class="top">
        <span class="pill" :class="closed ? 'bad' : b.status === 'COMPLETED' ? 'done' : 'on'">{{ LABEL[b.status] ?? b.status }}</span>
        <span class="car"><Icon name="car" :size="15" /> {{ b.vehicle.brand }} {{ b.vehicle.model }} · {{ b.vehicle.plate }}</span>
        <span class="who"><Icon name="user" :size="15" /> {{ b.customer.fullName }} · {{ b.customer.phone }}</span>
      </div>

      <!-- cancelled -->
      <div v-if="closed" class="box bad">
        <b>{{ LABEL[b.status] }}<template v-if="b.cancellation"> · {{ dt(b.cancellation.at) }}</template></b>
        <p v-if="b.cancellation?.reason">เหตุผล: {{ b.cancellation.reason }}</p>
      </div>

      <!-- where it stands -->
      <section v-else class="box">
        <h4><Icon name="flag" :size="15" /> สถานะ</h4>
        <ol class="steps">
          <li v-for="([label], i) in STEPS" :key="label" :class="{ done: i < stepAt, on: i === stepAt }">{{ label }}</li>
        </ol>
      </section>

      <!-- collection / hand-over -->
      <section v-if="!closed && b.status !== 'COMPLETED'" class="box key">
        <template v-if="delivered">
          <h4><Icon name="flag" :size="15" /> ต้องไปรับรถคืน</h4>
          <p class="big" :class="{ late: late(b.returnAt) }">{{ dt(b.returnAt) }} <small>({{ until(b.returnAt) }})</small></p>
          <p><Icon name="pin" :size="14" /> {{ returnPlace }}</p>
        </template>
        <template v-else>
          <h4><Icon name="car" :size="15" /> ต้องส่งรถ</h4>
          <p class="big" :class="{ late: late(b.pickupAt) }">{{ dt(b.pickupAt) }} <small>({{ until(b.pickupAt) }})</small></p>
          <p><Icon name="pin" :size="14" /> {{ pickupPlace }}</p>
          <p class="muted">รับรถคืน {{ dt(b.returnAt) }} · {{ returnPlace }}</p>
        </template>
      </section>

      <!-- history -->
      <section class="box">
        <h4><Icon name="clock" :size="15" /> บันทึกเวลา</h4>
        <ul class="timeline">
          <li v-for="(h, i) in data.history" :key="i">
            <b>{{ LABEL[h.to] ?? h.to }}</b>
            <span>{{ dt(h.at) }}</span>
            <span v-if="h.by" class="by">{{ h.by }}</span>
            <small v-if="h.reason" class="why">{{ h.reason }}</small>
          </li>
        </ul>
      </section>

      <!-- this car next -->
      <section class="box">
        <h4><Icon name="calendar" :size="15" /> คิวต่อไปของรถคันนี้</h4>
        <ul v-if="data.car.next.length" class="next">
          <li v-for="n in data.car.next" :key="n.number">
            <button type="button" class="num" @click="emit('open', n.number)">{{ n.number }}</button>
            <span>{{ n.customer }}<template v-if="n.phone"> · {{ n.phone }}</template></span>
            <span class="muted">{{ dt(n.pickupAt) }} – {{ dt(n.returnAt) }}</span>
            <span class="tag">{{ LABEL[n.status] ?? n.status }}</span>
          </li>
        </ul>
        <p v-else class="muted">ยังไม่มีคิวจองต่อ</p>
      </section>

      <section class="box">
        <h4><Icon name="wrench" :size="15" /> ตรวจสภาพ / ซ่อมบำรุง</h4>
        <ul v-if="data.car.due.length || data.car.maintenance.length" class="due">
          <li v-for="m in data.car.maintenance" :key="m.start">
            <b>ปิดซ่อม {{ day(m.start) }} – {{ day(m.end) }}</b><span class="muted">{{ m.reason }}</span>
          </li>
          <li v-for="d in data.car.due" :key="d.label" :class="d.level">
            <b>{{ d.label }}</b>
            <span>
              <template v-if="d.daysLeft != null">{{ d.daysLeft < 0 ? `เลยกำหนด ${-d.daysLeft} วัน` : `อีก ${d.daysLeft} วัน` }}</template>
              <template v-if="d.kmLeft != null"> · {{ d.kmLeft < 0 ? `เกิน ${(-d.kmLeft).toLocaleString('th-TH')} กม.` : `อีก ${d.kmLeft.toLocaleString('th-TH')} กม.` }}</template>
            </span>
          </li>
        </ul>
        <p v-else class="muted">ไม่มีรายการที่ใกล้ถึงกำหนด<template v-if="data.car.currentKm != null"> · ไมล์ปัจจุบัน {{ data.car.currentKm.toLocaleString('th-TH') }} กม.</template></p>
      </section>
    </template>
  </OpsDialog>
</template>

<style scoped>
.top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  font-size: 0.88rem;
}
.top .car,
.top .who {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #3a3d48;
}
.pill {
  padding: 3px 12px;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 700;
}
.pill.on {
  background: #ece8fd;
  color: #5b3fd6;
}
.pill.done {
  background: #eef0f2;
  color: #4b5563;
}
.pill.bad {
  background: #fdecec;
  color: #c62828;
}
.box {
  display: grid;
  gap: 8px;
  padding: 14px;
  border: 1px solid #e6e8ee;
  border-radius: 14px;
  background: #fafbfc;
}
.box.bad {
  border-color: #f3c4c1;
  background: #fdf2f1;
  color: #a3221a;
}
.box.key {
  border-color: #c9dafc;
  background: #f2f6ff;
}
h4 {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.9rem;
  font-weight: 700;
}
.big {
  font-size: 1.1rem;
  font-weight: 700;
}
.big small {
  color: #1d4ed8;
  font-size: 0.85rem;
}
.big.late,
.big.late small {
  color: #c62828;
}
.muted {
  color: #6b6e7a;
  font-size: 0.82rem;
}
.steps {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.steps li {
  padding: 5px 12px;
  border: 1px solid #e3e5ea;
  border-radius: 10px;
  color: #8d909b;
  font-size: 0.82rem;
}
.steps li:not(:last-child)::after {
  content: '›';
  margin-left: 10px;
  color: #b3b6bf;
}
.steps li.done {
  border-color: #bfe6cf;
  background: #effaf3;
  color: #1f6b46;
}
.steps li.on {
  border-color: #7c5cf0;
  background: #f1edfe;
  color: #5b3fd6;
  font-weight: 700;
}
.timeline {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0 0 0 14px;
  list-style: none;
  border-left: 2px solid #d9dce3;
}
.timeline li {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  font-size: 0.85rem;
}
.timeline li::before {
  content: '';
  position: absolute;
  left: -20px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #5fd39a;
}
.timeline .by {
  padding: 1px 8px;
  border: 1px solid #d9dce3;
  border-radius: 6px;
  color: #3a3d48;
  font-size: 0.75rem;
}
.timeline .why {
  flex-basis: 100%;
  color: #6b6e7a;
}
.next,
.due {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 0.85rem;
}
.next li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  padding: 8px 10px;
  border-radius: 10px;
  background: #fff;
}
.next .num {
  padding: 0;
  border: 0;
  background: none;
  color: #1d4ed8;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.tag {
  margin-left: auto;
  color: #6b6e7a;
  font-size: 0.78rem;
}
.due li {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 12px;
  padding: 8px 10px;
  border-radius: 10px;
  background: #fff;
}
.due li.overdue {
  color: #c62828;
}
.due li.near {
  color: #b45309;
}
</style>
