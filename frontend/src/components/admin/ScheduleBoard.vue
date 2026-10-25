<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { getSchedule } from '@/api/admin'
import { getVehicle } from '@/api/catalogue'
import Icon from '@/components/ui/Icon.vue'
import BookingModal from '@/components/booking/BookingModal.vue'

// "ปฏิทินการจอง": every car on a row, days across, each booking a bar coloured
// by where it stands (awaiting approval · to hand over · on rent · deposit to
// return). Pressing a bar opens that booking on the operations board.
const router = useRouter()
const TZ = 'Asia/Bangkok'
const DAY = 86_400_000
const CELL = 40 // px per day
const SPAN = 45 // days shown

const iso = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
const addDays = (s, n) => iso(new Date(new Date(`${s}T12:00:00+07:00`).getTime() + n * DAY))
const from = ref(addDays(iso(new Date()), -7))
const to = computed(() => addDays(from.value, SPAN - 1))
const data = ref(null)
const error = ref('')
const scroller = ref(null)

async function load() {
  error.value = ''
  try {
    data.value = await getSchedule(from.value, to.value)
  } catch (err) {
    error.value = err.message
  }
}
onMounted(async () => {
  await load()
  await nextTick()
  // Start with today in view, a week in from the left edge.
  if (scroller.value) scroller.value.scrollLeft = 0
})
watch(from, load)

const today = iso(new Date())
const days = computed(() =>
  Array.from({ length: SPAN }, (_, i) => {
    const s = addDays(from.value, i)
    const d = new Date(`${s}T12:00:00+07:00`)
    const dow = d.getUTCDay()
    return {
      iso: s, n: Number(s.slice(8)), dow,
      wd: ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'][dow],
      weekend: dow === 0 || dow === 6, today: s === today,
      monthStart: i === 0 || s.endsWith('-01'),
      month: d.toLocaleDateString('th-TH', { month: 'short', year: 'numeric', timeZone: TZ }),
    }
  }),
)
const origin = computed(() => new Date(`${from.value}T00:00:00+07:00`).getTime())
// Bar geometry in pixels, clipped to the visible range.
function place(start, end) {
  const total = SPAN * CELL
  const x0 = Math.max(0, ((new Date(start).getTime() - origin.value) / DAY) * CELL)
  const x1 = Math.min(total, ((new Date(end).getTime() - origin.value) / DAY) * CELL)
  return x1 > x0 ? { left: `${x0}px`, width: `${Math.max(x1 - x0, 18)}px` } : null
}

const PHASE = {
  pending: ['รออนุมัติ', 'pending'],
  handover: ['รอส่งมอบ', 'handover'],
  active: ['ใช้งาน', 'active'],
  deposit: ['รอคืนมัดจำ', 'deposit'],
  done: ['จบงาน', 'done'],
}
const rows = computed(() =>
  (data.value?.cars ?? []).map((c) => ({
    ...c,
    bars: data.value.bookings.filter((b) => b.vehicleId === c.id).map((b) => ({ ...b, style: place(b.start, b.end) })).filter((b) => b.style),
    blocks: data.value.maintenance.filter((m) => m.vehicleId === c.id).map((m) => ({ ...m, style: place(m.start, m.end) })).filter((m) => m.style),
  })),
)
const label = (b) => `${b.customer ?? ''} ${b.review === 'SUBMITTED' ? 'รอตรวจเอกสาร' : PHASE[b.phase][0]}`.trim()
const openBooking = (b) => router.push({ query: { tab: 'operations', booking: b.number } })
const shift = (n) => (from.value = addDays(from.value, n))
const goToday = () => (from.value = addDays(iso(new Date()), -7))

// "จองให้ลูกค้า": staff key in a booking for a customer who books by phone / LINE / walk-in.
const pickSlug = ref('')
const staffCar = ref(null)
const opening = ref(false)
async function bookFor() {
  if (!pickSlug.value || opening.value) return
  opening.value = true
  error.value = ''
  try {
    staffCar.value = await getVehicle(pickSlug.value)
  } catch (err) {
    error.value = err.message
  } finally {
    opening.value = false
  }
}
function closeStaff() {
  staffCar.value = null
  load()
}
</script>

<template>
  <section class="sched">
    <header>
      <div>
        <h2>ปฏิทินการจอง</h2>
        <p>แต่ละแถวคือรถหนึ่งคัน · กดแถบเพื่อเปิดการจองนั้นในหน้างานส่งรถ</p>
      </div>
      <div class="book-for">
        <select v-model="pickSlug" aria-label="เลือกรถ">
          <option value="">เลือกรถ…</option>
          <option v-for="c in data?.cars ?? []" :key="c.id" :value="c.slug">{{ c.fleetNo ? `${c.fleetNo} · ` : '' }}{{ c.name }} ({{ c.plate }})</option>
        </select>
        <button type="button" class="add" :disabled="!pickSlug || opening" @click="bookFor">+ จองให้ลูกค้า</button>
      </div>
      <div class="nav">
        <button type="button" aria-label="ย้อนกลับ 2 สัปดาห์" @click="shift(-14)"><Icon name="chevron-left" :size="16" /></button>
        <button type="button" class="today" @click="goToday">วันนี้</button>
        <button type="button" aria-label="ถัดไป 2 สัปดาห์" @click="shift(14)"><Icon name="chevron-right" :size="16" /></button>
      </div>
    </header>
    <p v-if="error" class="err" role="alert">{{ error }}</p>

    <div ref="scroller" class="grid-wrap">
      <div class="grid" :style="{ '--cell': `${CELL}px`, '--days': SPAN }">
        <div class="corner">รถ</div>
        <div class="head">
          <div class="months">
            <template v-for="(d, i) in days" :key="d.iso">
              <span v-if="d.monthStart" class="m" :style="{ left: `${i * CELL}px` }">{{ d.month }}</span>
            </template>
          </div>
          <div class="days">
            <span v-for="d in days" :key="d.iso" :class="{ we: d.weekend, today: d.today }">
              <small>{{ d.wd }}</small><b>{{ d.n }}</b>
            </span>
          </div>
        </div>

        <template v-for="r in rows" :key="r.id">
          <div class="car">
            <img v-if="r.image" :src="r.image" alt="" loading="lazy" />
            <div>
              <strong><span class="no">{{ r.fleetNo ?? '–' }}</span> {{ r.name }}</strong>
              <small>{{ r.plate }}</small>
            </div>
          </div>
          <div class="lane">
            <span v-for="d in days" :key="d.iso" class="cell" :class="{ we: d.weekend, today: d.today }" />
            <span v-for="(m, i) in r.blocks" :key="`m${i}`" class="bar maint" :style="m.style" :title="`ซ่อมบำรุง ${m.reason ?? ''}`">ซ่อมบำรุง</span>
            <button
              v-for="b in r.bars"
              :key="b.id"
              type="button"
              class="bar"
              :class="PHASE[b.phase][1]"
              :style="b.style"
              :title="`${b.number} · ${label(b)}`"
              @click="openBooking(b)"
            >
              {{ label(b) }}
            </button>
          </div>
        </template>
      </div>
    </div>

    <footer class="legend">
      <span><i class="pending" /> รออนุมัติ</span>
      <span><i class="handover" /> รอส่งมอบ</span>
      <span><i class="active" /> ใช้งาน</span>
      <span><i class="deposit" /> รอคืนมัดจำ</span>
      <span><i class="maint" /> ซ่อมบำรุง</span>
    </footer>
    <BookingModal v-if="staffCar" :vehicle="staffCar" staff @close="closeStaff" />
  </section>
</template>

<style scoped>
.sched {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--viz-border);
  border-radius: 20px;
  background: var(--viz-surface);
  -webkit-backdrop-filter: var(--viz-glass);
  backdrop-filter: var(--viz-glass);
}
header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-end;
  gap: 10px;
}
h2 {
  font-family: var(--font-body);
  font-size: 1.2rem;
  font-weight: 700;
}
header p {
  color: var(--viz-muted);
  font-size: 0.8rem;
}
.nav {
  display: flex;
  gap: 6px;
}
.nav button {
  display: grid;
  place-items: center;
  min-width: 36px;
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--viz-border);
  border-radius: 10px;
  background: rgb(255 255 255 / 0.06);
  color: var(--viz-text);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.grid-wrap {
  overflow-x: auto;
  border: 1px solid var(--viz-border);
  border-radius: 14px;
}
.grid {
  display: grid;
  grid-template-columns: 210px calc(var(--cell) * var(--days));
  min-width: max-content;
}
.corner,
.car {
  position: sticky;
  left: 0;
  z-index: 3;
  background: #151a28;
}
.corner {
  display: grid;
  place-items: center;
  border-bottom: 1px solid var(--viz-border);
  color: var(--viz-muted);
  font-size: 0.8rem;
}
.head {
  border-bottom: 1px solid var(--viz-border);
}
.months {
  position: relative;
  height: 22px;
}
.months .m {
  position: absolute;
  top: 3px;
  padding: 1px 8px;
  border-radius: 999px;
  background: rgb(255 255 255 / 0.08);
  color: var(--viz-muted);
  font-size: 0.7rem;
  white-space: nowrap;
}
.days {
  display: grid;
  grid-template-columns: repeat(var(--days), var(--cell));
}
.days span {
  display: grid;
  justify-items: center;
  padding: 2px 0 6px;
  font-size: 0.7rem;
}
.days small {
  color: var(--viz-muted);
}
.days .we {
  color: #ff8a82;
}
.days .today b {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #0e2a52;
  color: #fff;
}
.car {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 46px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--viz-border);
  border-right: 1px solid var(--viz-border);
}
.car img {
  width: 42px;
  height: 30px;
  object-fit: contain;
  border-radius: 6px;
  background: #fff;
}
.car div {
  display: grid;
  min-width: 0;
}
.car strong {
  overflow: hidden;
  font-size: 0.78rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.car small {
  color: var(--viz-muted);
  font-size: 0.7rem;
}
.no {
  margin-right: 2px;
  color: #9cc4ff;
}
.lane {
  position: relative;
  display: grid;
  grid-template-columns: repeat(var(--days), var(--cell));
  border-bottom: 1px solid var(--viz-border);
}
.cell {
  border-right: 1px solid rgb(255 255 255 / 0.05);
}
.cell.we {
  background: rgb(255 120 110 / 0.06);
}
.cell.today {
  background: rgb(156 196 255 / 0.12);
}
.bar {
  position: absolute;
  top: 8px;
  height: 30px;
  overflow: hidden;
  padding: 0 8px;
  border: 0;
  border-radius: 8px;
  color: #fff;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 600;
  line-height: 30px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.bar:hover,
.bar:focus-visible {
  filter: brightness(1.15);
  outline: 2px solid #fff;
}
.pending {
  background: #e3b341;
  color: #2b2100;
}
.handover {
  background: #2fa8d8;
}
.active {
  background: #8b6cf0;
}
.deposit {
  background: #f08a3c;
}
.done {
  background: #5d6577;
}
.maint {
  background: repeating-linear-gradient(135deg, #6b7280 0 6px, #4b5563 6px 12px);
  cursor: default;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  color: var(--viz-muted);
  font-size: 0.78rem;
}
.legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.legend i {
  width: 12px;
  height: 12px;
  border-radius: 4px;
}
.err {
  color: #ff8a82;
}
@media (max-width: 640px) {
  .grid {
    grid-template-columns: 130px calc(var(--cell) * var(--days));
  }
  .car img {
    display: none;
  }
}

.book-for {
  display: flex;
  gap: 6px;
  margin-left: auto;
}
.book-for select {
  max-width: 260px;
  padding: 8px 10px;
  border: 1px solid #e3e4e8;
  border-radius: 10px;
  font: inherit;
  font-size: 0.85rem;
}
.book-for .add {
  padding: 8px 14px;
  border: 0;
  border-radius: 10px;
  background: #e2362c;
  color: #fff;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.book-for .add:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
