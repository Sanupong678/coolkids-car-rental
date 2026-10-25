<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { acceptJob, assignDriver, getDispatchCalendar, getDispatchStaff, getDispatchSummary, getOverview, setBookingStatus } from '@/api/admin'
import { useAuthStore } from '@/stores/auth'
import { money } from '@/utils/format'
import { distanceKm, fmtKm } from '@/utils/geo'
import { currentPosition } from '@/utils/staffLocation'
import Icon from '@/components/ui/Icon.vue'
import ChartPicker from './ChartPicker.vue'
import DispatchCalendar from './dispatch/DispatchCalendar.vue'
import DispatchMap from './dispatch/DispatchMap.vue'
import DriversPanel from './dispatch/DriversPanel.vue'
import OrdersPanel from './dispatch/OrdersPanel.vue'
import OrderCard from './dispatch/OrderCard.vue'
import ChartCard from './charts/ChartCard.vue'
import LineChart from './charts/LineChart.vue'
import BarChart from './charts/BarChart.vue'
import BarList from './charts/BarList.vue'

// Owner's dashboard: today's hand-overs / overdue cars / revenue up top, then
// one of three views picked in the side rail (`view` prop):
//   calendar - the day's orders on the left, the month of hand-overs on the right
//   map      - orders | map of drop-offs and drivers | drivers + the selected job's card
//   graph    - the business charts the viewer picked
// Every figure follows the definitions in analytics.service.js.
const props = defineProps({ view: { type: String, default: 'calendar' } })
const emit = defineEmits(['view'])
const PERIODS = [
  [7, '7 วัน'],
  [30, '30 วัน'],
  [90, '90 วัน'],
  [365, '1 ปี'],
]
const days = ref(30)
const d = ref(null)
const error = ref('')
const loading = ref(false)

async function load() {
  loading.value = true
  error.value = ''
  try {
    d.value = await getOverview(days.value)
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}
watch(days, load)

// ---- today's header numbers + delivery calendar
const auth = useAuthStore()
const TZ = 'Asia/Bangkok'
const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
const today = ref(todayIso())
const summary = ref(null)
const month = ref(today.value.slice(0, 7))
const cal = ref({ days: {} })
const calLoading = ref(false)
const day = ref(today.value)
const staff = ref([])
const meId = ref(null)
const busyId = ref(null)
const selectedId = ref(null)
const dispatchError = ref('')

async function loadSummary() {
  summary.value = await getDispatchSummary().catch(() => summary.value)
}
async function loadCalendar() {
  calLoading.value = true
  try {
    cal.value = await getDispatchCalendar(month.value)
  } catch (err) {
    dispatchError.value = err.message
  } finally {
    calLoading.value = false
  }
}
async function loadStaff() {
  if (!auth.can('deliveries:read')) return
  try {
    const board = await getDispatchStaff(day.value)
    staff.value = board.staff
    meId.value = board.meId
  } catch (err) {
    dispatchError.value = err.message
  }
}
const refreshDispatch = () => Promise.all([loadSummary(), loadCalendar(), loadStaff()])
const dayJobs = computed(() => (day.value?.slice(0, 7) === month.value ? cal.value.days[day.value] : null) ?? [])
const selected = computed(() => dayJobs.value.find((j) => j.id === selectedId.value) ?? null)
// Keep a job selected: the first one still to hand over, else the first of the day.
watch(dayJobs, (jobs) => {
  if (!jobs.some((j) => j.id === selectedId.value)) selectedId.value = (jobs.find((j) => !j.delivered) ?? jobs[0])?.id ?? null
})
watch(month, loadCalendar)
watch(day, loadStaff)
function setDay(d) {
  day.value = d
  if (d.slice(0, 7) !== month.value) month.value = d.slice(0, 7)
}
// Calendar: a day with hand-overs opens straight on the map.
function pickDay(d) {
  setDay(d)
  if (cal.value.days[d]?.length) emit('view', 'map')
}
function pickJob(id) {
  selectedId.value = id
  if (props.view !== 'map') emit('view', 'map')
}
const canAssign = computed(() => auth.can('deliveries:assign'))
const canAccept = computed(() => Boolean(meId.value) && (auth.can('deliveries:update') || canAssign.value))
const nearestFree = computed(() => {
  const dest = selected.value?.destination
  const free = staff.value.filter((s) => s.location && !s.onTheRoad && !s.jobs.length)
  return free.map((s) => ({ s, km: distanceKm(s.location, dest) })).sort((a, b) => a.km - b.km)[0] ?? null
})
const tripKm = computed(() => {
  const j = selected.value
  if (!j) return null
  return j.destination?.distanceMeters != null ? j.destination.distanceMeters / 1000 : distanceKm(j.branch, j.destination)
})
const tripMinutes = computed(() => (selected.value?.destination?.durationSeconds ? Math.round(selected.value.destination.durationSeconds / 60) : null))

async function withBusy(id, fn) {
  busyId.value = id
  dispatchError.value = ''
  try {
    await fn()
    await refreshDispatch()
  } catch (err) {
    dispatchError.value = err.message
  } finally {
    busyId.value = null
  }
}
const onAssign = ({ bookingId, staffId }) => withBusy(bookingId, () => assignDriver(bookingId, staffId))
// Pressing a job button also records where the staff member is right now.
const onAct = ({ job, status }) => withBusy(job.id, async () => setBookingStatus(job.id, status, undefined, await currentPosition()))
const onAccept = (job) => withBusy(job.id, async () => acceptJob(job.id, await currentPosition()))

let timer
onMounted(() => {
  load()
  refreshDispatch()
  // Drivers move: positions and statuses refresh every 30 s while the page is open.
  timer = setInterval(() => {
    today.value = todayIso()
    loadSummary()
    loadStaff()
    if (props.view === 'map') loadCalendar()
  }, 30_000)
})
onBeforeUnmount(() => clearInterval(timer))

const hero = computed(() => {
  const s = summary.value ?? {}
  const total = s.today_total ?? 0
  const open = s.today_open ?? 0
  return { total, open, done: total - open, overdue: s.overdue ?? 0, progress: total ? (total - open) / total : 0 }
})
const RING = 2 * Math.PI * 34
const dayShort = computed(() => new Date(`${day.value}T00:00:00`).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' }))
const todayLabel = computed(() => new Date(`${today.value}T00:00:00`).toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))

// ---- which charts are shown (remembered on this device)
const CHARTS = [
  { key: 'kpis', label: 'ตัวชี้วัดของช่วงเวลา' },
  { key: 'revenue', label: 'รายได้รายวัน' },
  { key: 'bookings', label: 'การจองที่ชำระแล้วรายวัน' },
  { key: 'category', label: 'รายได้ตามประเภทรถ' },
  { key: 'vehicles', label: 'รถทำรายได้สูงสุด' },
  { key: 'weekday', label: 'วันรับรถในสัปดาห์' },
  { key: 'lead', label: 'จองล่วงหน้ากี่วัน' },
  { key: 'length', label: 'ระยะเวลาเช่า' },
  { key: 'nationality', label: 'สัญชาติลูกค้า' },
  { key: 'funnel', label: 'สถานะการจอง' },
  { key: 'payments', label: 'ช่องทางชำระเงิน' },
  { key: 'age', label: 'ช่วงอายุผู้เช่า' },
  { key: 'gender', label: 'เพศ / การรับรถ' },
  { key: 'delivery', label: 'ประสิทธิภาพการส่งรถ' },
]
const PICK_KEY = 'ck.dashboardCharts'
const DEFAULT_CHARTS = ['kpis', 'revenue', 'category', 'vehicles', 'weekday']
function readPicked() {
  try {
    const v = JSON.parse(localStorage.getItem(PICK_KEY))
    return Array.isArray(v) ? v.filter((k) => CHARTS.some((c) => c.key === k)) : DEFAULT_CHARTS
  } catch {
    return DEFAULT_CHARTS
  }
}
const picked = ref(readPicked())
watch(picked, (v) => {
  try {
    localStorage.setItem(PICK_KEY, JSON.stringify(v))
  } catch {
    /* storage blocked: choice lasts for this visit */
  }
})
const show = computed(() => new Set(picked.value))

const thb = (minor) => money(Math.round(minor ?? 0), 'THB')
const thbShort = (minor) => {
  const b = (minor ?? 0) / 100
  return b >= 1e6 ? `฿${(b / 1e6).toFixed(1)}M` : b >= 1e3 ? `฿${(b / 1e3).toFixed(b >= 1e4 ? 0 : 1)}k` : `฿${Math.round(b)}`
}
const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`)
const int = (v) => Math.round(v ?? 0).toLocaleString('th-TH')
const dayLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
const delta = (now, prev) => (prev ? (now - prev) / prev : now ? 1 : null)

const k = computed(() => d.value?.kpis ?? {})
const period = computed(() => [
  { label: 'รายได้', value: thb(k.value.revenue), change: delta(k.value.revenue, k.value.revenue_prev) },
  { label: 'การจองที่ชำระแล้ว', value: int(k.value.bookings), change: delta(k.value.bookings, k.value.bookings_prev) },
  { label: 'มูลค่าเฉลี่ย/การจอง', value: thb(k.value.aov) },
  { label: 'อัตราการใช้รถ', value: pct(k.value.utilization), sub: `${int(k.value.booked_hours)} ชม. / ${int(k.value.active_vehicles)} คัน` },
  { label: 'Conversion (จอง→จ่าย)', value: pct(k.value.checkout_conversion) },
  { label: 'อัตรายกเลิก', value: pct(k.value.cancellation_rate) },
  { label: 'ลูกค้าต่างชาติ', value: pct(k.value.foreign_share) },
  { label: 'จองล่วงหน้าเฉลี่ย', value: k.value.avg_lead_days == null ? '—' : `${k.value.avg_lead_days.toFixed(1)} วัน`, sub: k.value.avg_rental_days ? `เช่าเฉลี่ย ${k.value.avg_rental_days.toFixed(1)} วัน` : '' },
])

const revenueSeries = computed(() => (d.value?.series ?? []).map((r) => ({ label: r.date, value: r.revenue })))
const bookingSeries = computed(() => (d.value?.series ?? []).map((r) => ({ label: r.date, value: r.bookings })))
const WEEKDAYS = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา']
const weekday = computed(() => (d.value?.weekday ?? []).map((r) => ({ label: WEEKDAYS[r.dow - 1], value: r.bookings })))
const lead = computed(() => (d.value?.leadTime ?? []).map((r) => ({ label: r.label, value: r.bookings })))
const length = computed(() => (d.value?.rentalLength ?? []).map((r) => ({ label: r.label, value: r.bookings })))
const regionName = (code) => {
  try {
    return code === '??' ? 'ไม่ระบุ' : new Intl.DisplayNames(['th'], { type: 'region' }).of(code)
  } catch {
    return code
  }
}
const STATUS_TH = {
  PENDING: 'รอชำระ', CONFIRMED: 'ยืนยันแล้ว', PREPARING: 'เตรียมเอกสาร', READY: 'พร้อมรับ', IN_DELIVERY: 'กำลังส่ง',
  ACTIVE: 'กำลังเช่า', COMPLETED: 'คืนแล้ว', CANCELLED: 'ยกเลิก', EXPIRED: 'หมดเวลาชำระ', REFUNDED: 'คืนเงิน',
}
const GENDER_TH = { male: 'ชาย', female: 'หญิง', non_binary: 'non-binary', other: 'อื่นๆ', prefer_not_to_say: 'ไม่ระบุ', unknown: 'ไม่ทราบ' }

const lists = computed(() => {
  if (!d.value) return {}
  return {
    category: d.value.byCategory.map((r) => ({ label: r.name, value: r.revenue, sub: `${r.bookings} การจอง` })),
    vehicles: d.value.topVehicles.map((r) => ({ label: r.name, value: r.revenue, sub: `${r.bookings} การจอง · ${r.rental_days} วัน` })),
    nationality: d.value.nationality.map((r) => ({ label: regionName(r.country), value: r.bookings, sub: thb(r.revenue) })),
    payments: d.value.paymentMethods.map((r) => ({ label: `${r.method} (${r.provider})`, value: r.amount, sub: `${r.payments} รายการ` })),
    funnel: [...d.value.funnel].sort((a, b) => b.bookings - a.bookings).map((r) => ({ label: STATUS_TH[r.status] ?? r.status, value: r.bookings })),
    age: d.value.demographics.age.map((r) => ({ label: r.band, value: r.bookings })),
    gender: d.value.demographics.gender.map((r) => ({ label: GENDER_TH[r.gender] ?? r.gender, value: r.bookings })),
    fulfillment: d.value.fulfillment.map((r) => ({ label: r.type === 'DELIVERY' ? 'ส่งถึงที่' : 'รับที่สาขา', value: r.bookings, sub: thb(r.revenue) })),
  }
})
const tableOf = (rows, a, b, fmt = (v) => v) => ({ columns: [a, b], rows: rows.map((r) => [r.label, fmt(r.value)]) })
const dl = computed(() => d.value?.delivery ?? {})
const mins = (v) => (v == null ? '—' : `${Math.round(v)} นาที`)
</script>

<template>
  <div class="dash">
    <!-- today -->
    <section class="hero">
      <div class="hero-title">
        <span class="eyebrow">วันนี้</span>
        <h2>งานส่งรถ<br />และรายได้</h2>
        <small>{{ todayLabel }}</small>
      </div>
      <div class="ring" role="img" :aria-label="`ส่งมอบแล้ว ${hero.done} จาก ${hero.total} คัน`">
        <svg viewBox="0 0 80 80" width="112" height="112">
          <circle cx="40" cy="40" r="34" class="track" />
          <circle cx="40" cy="40" r="34" class="arc" :stroke-dasharray="`${RING * hero.progress} ${RING}`" />
        </svg>
        <span><b>{{ hero.done }}</b>/{{ hero.total }}</span>
      </div>
      <div class="stat">
        <small>รายการส่งรถวันนี้</small>
        <strong>{{ int(hero.total) }}<sup>คัน</sup></strong>
        <em>ต้องส่งอีก {{ int(hero.open) }} คัน</em>
      </div>
      <div class="stat" :class="{ alert: hero.overdue }">
        <small>รถค้างส่ง</small>
        <strong>{{ int(hero.overdue) }}<sup>คัน</sup></strong>
        <em>เลยเวลารับแล้วแต่ยังไม่ได้ส่งมอบ</em>
      </div>
      <div class="stat">
        <small>รายได้วันนี้</small>
        <strong>{{ thb(k.revenue_today) }}</strong>
        <em v-if="d">{{ PERIODS.find((p) => p[0] === days)?.[1] }}ล่าสุด {{ thb(k.revenue) }}</em>
      </div>
    </section>

    <p v-if="dispatchError && view !== 'graph'" class="err" role="alert">{{ dispatchError }}</p>

    <!-- calendar / map: orders on the left, the stage on the right -->
    <div v-if="view !== 'graph'" class="board" :class="view">
      <OrdersPanel :date="day" :jobs="dayJobs" :selected-id="selectedId" @update:date="setDay" @select="pickJob" />

      <DispatchCalendar v-if="view === 'calendar'" v-model:month="month" :days="cal.days" :selected="day" :today="today" :loading="calLoading" @select="pickDay" />

      <template v-else>
        <div class="stage">
          <DispatchMap :jobs="dayJobs" :staff="staff" :selected-id="selectedId" @select="selectedId = $event" />
          <div class="stage-top">
            <button type="button" class="chip" @click="emit('view', 'calendar')"><Icon name="calendar" :size="14" /> {{ dayShort }}</button>
            <button type="button" class="chip round" aria-label="รีเฟรช" @click="refreshDispatch"><Icon name="navigation" :size="15" /></button>
          </div>
          <div v-if="selected" class="stats">
            <div>
              <small>{{ selected.fulfillment === 'DELIVERY' ? 'ระยะทางส่ง' : 'รับที่สาขา' }}</small>
              <b>{{ selected.fulfillment === 'DELIVERY' ? fmtKm(tripKm) : selected.branch.name }}</b>
            </div>
            <div>
              <small>เวลาเดินทางโดยประมาณ</small>
              <b>{{ tripMinutes != null ? `${tripMinutes} นาที` : '—' }}</b>
            </div>
            <div>
              <small>คนว่างที่ใกล้ที่สุด</small>
              <b>{{ nearestFree ? `${nearestFree.s.name.split(' ')[0]} · ${fmtKm(nearestFree.km)}` : '—' }}</b>
            </div>
          </div>
        </div>
        <div class="side">
          <DriversPanel :staff="staff" :job="selected" :can-assign="canAssign" :busy="busyId === selectedId" @assign="onAssign" />
          <OrderCard v-if="selected" :job="selected" :can-accept="canAccept" :busy="busyId === selected.id" @accept="onAccept" @act="onAct" />
          <p v-else class="hint small">เลือกงานจากรายการด้านซ้าย</p>
        </div>
      </template>
    </div>

    <!-- analytics -->
    <template v-if="view === 'graph'">
    <div class="bar">
      <h3 class="sec">สถิติธุรกิจ</h3>
      <div class="seg" role="radiogroup" aria-label="ช่วงเวลา">
        <button v-for="[n, l] in PERIODS" :key="n" type="button" role="radio" :aria-checked="days === n" :class="{ on: days === n }" @click="days = n">{{ l }}</button>
      </div>
      <ChartPicker v-model="picked" :options="CHARTS" />
      <small v-if="d">{{ dayLabel(d.period.from) }} – {{ dayLabel(d.period.to) }} · เวลาประเทศไทย</small>
      <button type="button" class="refresh" :disabled="loading" @click="load"><Icon name="sparkles" :size="14" /> รีเฟรช</button>
    </div>
    <p v-if="error" class="err">{{ error }}</p>

    <template v-if="d">
      <div v-if="show.has('kpis')" class="tiles">
        <div v-for="t in period" :key="t.label" class="tile">
          <small>{{ t.label }}</small>
          <strong>{{ t.value }}</strong>
          <em v-if="t.change != null" :class="t.change >= 0 ? 'up' : 'down'">{{ t.change >= 0 ? '▲' : '▼' }} {{ pct(Math.abs(t.change)) }} เทียบช่วงก่อน</em>
          <em v-else-if="t.sub">{{ t.sub }}</em>
        </div>
      </div>

      <div class="charts">
        <ChartCard v-if="show.has('revenue')" class="wide" title="รายได้รายวัน" note="ยอดชำระสำเร็จหักคืนเงิน (บาท)" :table="tableOf(revenueSeries, 'วันที่', 'รายได้', thb)">
          <LineChart :data="revenueSeries" :format="thbShort" :format-label="dayLabel" name="รายได้รายวัน" />
        </ChartCard>
        <ChartCard v-if="show.has('bookings')" title="การจองที่ชำระแล้วรายวัน" :table="tableOf(bookingSeries, 'วันที่', 'การจอง')">
          <BarChart :data="bookingSeries" :format="int" :format-label="dayLabel" name="การจองรายวัน" />
        </ChartCard>
        <ChartCard v-if="show.has('category')" title="รายได้ตามประเภทรถ" :table="tableOf(lists.category, 'ประเภท', 'รายได้', thb)">
          <BarList :data="lists.category" :format="thb" />
        </ChartCard>
        <ChartCard v-if="show.has('vehicles')" title="รถทำรายได้สูงสุด" :table="tableOf(lists.vehicles, 'รถ', 'รายได้', thb)">
          <BarList :data="lists.vehicles" :format="thb" />
        </ChartCard>
        <ChartCard v-if="show.has('weekday')" title="วันรับรถในสัปดาห์" note="ใช้วางกำลังคนส่งรถ" :table="tableOf(weekday, 'วัน', 'การจอง')">
          <BarChart :data="weekday" :format="int" name="วันรับรถ" />
        </ChartCard>
        <ChartCard v-if="show.has('lead')" title="จองล่วงหน้ากี่วัน" note="lead time — ฟีเจอร์สำหรับพยากรณ์ดีมานด์" :table="tableOf(lead, 'ช่วง', 'การจอง')">
          <BarChart :data="lead" :format="int" name="ระยะเวลาจองล่วงหน้า" />
        </ChartCard>
        <ChartCard v-if="show.has('length')" title="ระยะเวลาเช่า" :table="tableOf(length, 'ช่วง', 'การจอง')">
          <BarChart :data="length" :format="int" name="ระยะเวลาเช่า" />
        </ChartCard>
        <ChartCard v-if="show.has('nationality')" title="สัญชาติลูกค้า" :table="tableOf(lists.nationality, 'ประเทศ', 'การจอง')">
          <BarList :data="lists.nationality" :format="int" />
        </ChartCard>
        <ChartCard v-if="show.has('funnel')" title="สถานะการจอง (สร้างในช่วงนี้)" note="ดู drop-off ระหว่างจองกับชำระเงิน" :table="tableOf(lists.funnel, 'สถานะ', 'จำนวน')">
          <BarList :data="lists.funnel" :format="int" />
        </ChartCard>
        <ChartCard v-if="show.has('payments')" title="ช่องทางชำระเงิน" :table="tableOf(lists.payments, 'วิธี', 'ยอด', thb)">
          <BarList :data="lists.payments" :format="thb" />
        </ChartCard>
        <ChartCard v-if="show.has('age')" title="ช่วงอายุผู้เช่า" note="จากวันเกิดในเอกสาร ณ วันรับรถ" :table="tableOf(lists.age, 'อายุ', 'การจอง')">
          <BarList :data="lists.age" :format="int" />
        </ChartCard>
        <ChartCard v-if="show.has('gender')" title="เพศ / การรับรถ">
          <BarList :data="lists.gender" :format="int" />
          <BarList :data="lists.fulfillment" :format="int" />
        </ChartCard>
        <ChartCard v-if="show.has('delivery')" class="wide" title="ประสิทธิภาพการส่งรถ" note="ETA จาก Google Routes เทียบเวลาจริง">
          <div class="mini">
            <div><small>งานส่งรถ</small><strong>{{ int(dl.deliveries) }}</strong></div>
            <div><small>ระยะทางเฉลี่ย</small><strong>{{ dl.avg_distance_km == null ? '—' : `${dl.avg_distance_km.toFixed(1)} กม.` }}</strong></div>
            <div><small>เวลาประมาณการ</small><strong>{{ mins(dl.avg_estimated_min) }}</strong></div>
            <div><small>เวลาจริงเฉลี่ย</small><strong>{{ mins(dl.avg_actual_min) }}</strong></div>
            <div><small>คลาดเคลื่อนจาก ETA</small><strong>{{ dl.avg_eta_error_min == null ? '—' : `${dl.avg_eta_error_min > 0 ? '+' : ''}${Math.round(dl.avg_eta_error_min)} นาที` }}</strong></div>
          </div>
        </ChartCard>
      </div>
      <p v-if="!picked.length" class="hint">ยังไม่ได้เลือกกราฟ — กด “เลือกกราฟที่แสดง” เพื่อเพิ่ม</p>
    </template>
    <div v-else-if="loading" class="skeleton" style="height: 320px" />
    </template>
  </div>
</template>

<style scoped>
.dash {
  display: grid;
  gap: 16px;
}
/* ---- hero: big numbers on one glass slab */
.hero {
  display: grid;
  grid-template-columns: minmax(180px, 1.1fr) auto repeat(3, minmax(0, 1fr));
  align-items: center;
  gap: clamp(14px, 2.4vw, 32px);
  padding: clamp(18px, 2.4vw, 28px);
  border: 1px solid var(--viz-border);
  border-radius: 24px;
  background: linear-gradient(135deg, rgb(255 255 255 / 0.1), rgb(255 255 255 / 0.04));
  -webkit-backdrop-filter: var(--viz-glass);
  backdrop-filter: var(--viz-glass);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.1);
}
.eyebrow {
  color: #ff8a82;
}
.hero h2 {
  font-family: var(--font-body);
  font-size: clamp(1.6rem, 2.6vw, 2.3rem);
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: -0.01em;
  margin: 4px 0 6px;
}
.hero-title small {
  color: var(--viz-muted);
}
.ring {
  position: relative;
  display: grid;
  place-items: center;
}
.ring svg {
  transform: rotate(-90deg);
}
.ring circle {
  fill: none;
  stroke-width: 7;
}
.ring .track {
  stroke: rgb(255 255 255 / 0.12);
}
.ring .arc {
  stroke: var(--viz-cream);
  stroke-linecap: round;
  transition: stroke-dasharray var(--dur-slow) var(--ease-out);
}
.ring span {
  position: absolute;
  color: var(--viz-muted);
  font-size: 0.85rem;
}
.ring b {
  color: var(--viz-text);
  font-size: 1.5rem;
  font-weight: 600;
}
.stat {
  display: grid;
  gap: 2px;
  padding-left: clamp(12px, 2vw, 24px);
  border-left: 1px solid var(--viz-border);
}
.stat small {
  color: var(--viz-muted);
  font-size: 0.8rem;
}
.stat strong {
  font-family: var(--font-display);
  font-weight: 500;
  font-size: clamp(1.6rem, 2.8vw, 2.4rem);
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.stat sup {
  margin-left: 4px;
  font-size: 0.8rem;
  color: var(--viz-muted);
  vertical-align: super;
}
.stat em {
  font-style: normal;
  font-size: 0.75rem;
  color: var(--viz-muted);
}
.stat.alert strong {
  color: var(--bad);
}
@media (max-width: 1100px) {
  .hero {
    grid-template-columns: 1fr auto;
  }
  .stat {
    padding: 12px 0 0;
    border-left: 0;
    border-top: 1px solid var(--viz-border);
  }
}
@media (max-width: 560px) {
  .hero {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px 10px;
    padding: 16px;
    border-radius: 20px;
  }
  .hero-title {
    grid-column: 1 / 3;
  }
  .hero h2 {
    font-size: 1.35rem;
  }
  .ring {
    justify-self: end;
  }
  .ring svg {
    width: 76px;
    height: 76px;
  }
  .ring b {
    font-size: 1.1rem;
  }
  .stat {
    padding-top: 10px;
  }
  .stat small {
    font-size: 0.7rem;
  }
  .stat strong {
    font-size: 1.25rem;
  }
  .stat sup {
    font-size: 0.65rem;
  }
  .stat em {
    display: none;
  }
  .bar {
    gap: 8px;
  }
  .bar small {
    flex-basis: 100%;
    order: 9;
  }
  .refresh {
    margin-left: 0;
  }
  .seg button {
    padding: 6px 10px;
  }
}
/* ---- analytics toolbar */
.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 12px;
  margin-top: 8px;
}
.sec {
  font-family: var(--font-body);
  font-size: 1.05rem;
  font-weight: 600;
  letter-spacing: 0;
  margin-right: 4px;
}
.bar small {
  color: var(--viz-muted);
}
.seg {
  display: inline-flex;
  padding: 4px;
  border-radius: 999px;
  background: var(--viz-surface);
  border: 1px solid var(--viz-border);
  -webkit-backdrop-filter: var(--viz-glass);
  backdrop-filter: var(--viz-glass);
}
.seg button {
  padding: 6px 14px;
  border: 0;
  border-radius: 999px;
  background: none;
  color: var(--viz-muted);
  font-size: 0.82rem;
  cursor: pointer;
}
.seg button.on {
  background: var(--viz-cream);
  color: #15171e;
  font-weight: 600;
}
.refresh {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border: 1px solid var(--viz-border);
  border-radius: 999px;
  background: var(--viz-surface);
  color: var(--viz-text);
  font-size: 0.8rem;
  cursor: pointer;
}
.tiles {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
@media (max-width: 900px) {
  .tiles {
    grid-template-columns: repeat(2, 1fr);
  }
}
.tile {
  display: grid;
  gap: 2px;
  padding: 16px;
  border: 1px solid var(--viz-border);
  border-radius: 16px;
  background: var(--viz-surface);
  -webkit-backdrop-filter: var(--viz-glass);
  backdrop-filter: var(--viz-glass);
}
.tile small {
  font-size: 0.78rem;
  color: var(--viz-muted);
}
.tile strong {
  font-family: var(--font-display);
  font-weight: 500;
  font-size: 1.5rem;
  font-variant-numeric: tabular-nums;
}
.tile em {
  font-style: normal;
  font-size: 0.75rem;
  color: var(--viz-muted);
}
.tile em.up {
  color: var(--ok);
}
.tile em.down {
  color: var(--bad);
}
.charts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 360px), 1fr));
  gap: 12px;
}
.charts .wide {
  grid-column: 1 / -1;
}
.mini {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 12px;
}
.mini div {
  display: grid;
}
.mini small {
  color: var(--viz-muted);
  font-size: 0.75rem;
}
.mini strong {
  font-size: 1.15rem;
  color: var(--viz-text);
}
.hint.small {
  padding: 16px;
  font-size: 0.85rem;
}
/* ---- dispatch board */
.board {
  display: grid;
  grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
  gap: 14px;
  align-items: stretch;
}
.board.map {
  grid-template-columns: minmax(280px, 330px) minmax(0, 1fr) minmax(300px, 360px);
  height: clamp(620px, calc(100dvh - 120px), 900px);
}
.board.map > *,
.board.calendar > :first-child {
  min-height: 0;
}
.board.calendar > :first-child {
  max-height: 860px;
}
.stage {
  position: relative;
  min-height: 420px;
  border: 1px solid var(--viz-border);
  border-radius: 24px;
  overflow: hidden;
}
.stage > :first-child {
  position: absolute;
  inset: 0;
  border-radius: 0;
}
.stage-top {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 500;
  display: flex;
  gap: 8px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 38px;
  padding: 0 14px;
  border: 1px solid var(--viz-border);
  border-radius: 999px;
  background: rgb(18 22 34 / 0.8);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  color: var(--viz-text);
  font: inherit;
  font-size: 0.82rem;
  cursor: pointer;
}
.chip.round {
  width: 38px;
  padding: 0;
  justify-content: center;
  border-color: rgb(120 175 255 / 0.8);
  background: var(--viz-glow);
  box-shadow: 0 0 20px rgb(61 139 255 / 0.6);
}
.stats {
  position: absolute;
  left: 14px;
  right: 14px;
  bottom: 14px;
  z-index: 500;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  pointer-events: none;
}
.stats > div {
  display: grid;
  justify-items: center;
  gap: 2px;
  padding: 12px;
  border: 1px solid var(--viz-border);
  border-radius: 18px;
  background: rgb(60 66 82 / 0.55);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
  text-align: center;
}
.stats small {
  color: var(--viz-muted);
  font-size: 0.72rem;
}
.stats b {
  overflow: hidden;
  max-width: 100%;
  font-size: 1.15rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.side {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 12px;
  min-height: 0;
}
@media (max-width: 1280px) {
  .board.map {
    grid-template-columns: minmax(0, 1fr) minmax(300px, 360px);
    height: auto;
  }
  .board.map > :first-child {
    grid-column: 1 / -1;
    max-height: 340px;
  }
  .board.map .stage {
    height: 560px;
  }
}
@media (max-width: 900px) {
  .board,
  .board.map {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .board.calendar > :first-child,
  .board.map > :first-child {
    max-height: 320px;
  }
  .board.map .stage {
    order: -2;
    height: min(440px, 62dvh);
  }
  /* phones: map first, then who is driving / the selected job, then the list */
  .board.map .side {
    order: -1;
  }
  .dash:has(.board.map) .hero {
    display: none;
  }
  .side {
    grid-template-rows: auto auto;
  }
  .side > :first-child {
    max-height: 340px;
  }
  .stage-top {
    top: 10px;
    right: 10px;
  }
  .stats {
    left: 10px;
    right: 10px;
    bottom: 26px; /* clear of the map attribution */
    gap: 6px;
  }
  .stats > div {
    padding: 8px;
    border-radius: 14px;
  }
  .stats b {
    font-size: 0.95rem;
  }
  .stats {
    grid-template-columns: 1fr 1fr;
  }
  .stats > div:last-child {
    display: none;
  }
}
.hint {
  padding: 28px;
  border: 1px dashed var(--viz-border);
  border-radius: 16px;
  color: var(--viz-muted);
  text-align: center;
}
.err {
  color: var(--bad);
}
</style>
