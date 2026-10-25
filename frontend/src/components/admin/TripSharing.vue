<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { getDispatchStaff, markArrived, reportMyLocation } from '@/api/admin'
import { currentPosition } from '@/utils/staffLocation'
import Icon from '@/components/ui/Icon.vue'

// While this staff member drives a delivery ("ออกส่งรถ" pressed, not yet handed
// over), their phone streams its GPS so the customer sees the car on a map and
// gets LINE alerts when it is near / has arrived. Outside a trip nothing is sent.
// Browsers pause GPS in the background, so the bar asks the driver to keep this
// page open, and holds a screen wake lock where supported.

const SEND_EVERY_MS = 15_000
const SEND_IF_MOVED_M = 150
const CHECK_TRIP_MS = 30_000

const trip = ref(null) // { bookingId } of the job on the road, or null
const lastSent = ref(null)
const note = ref('')
const error = ref('')
const busy = ref(false)
let watchId = null
let checkTimer
let wakeLock = null
let last = null

const TZ = 'Asia/Bangkok'
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
const clock = (d) => d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const sentText = computed(() => (lastSent.value ? `ส่งตำแหน่งล่าสุด ${clock(lastSent.value)}` : 'กำลังหาสัญญาณ GPS…'))

function metersBetween(a, b) {
  const rad = (d) => (d * Math.PI) / 180
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
}

async function send(pos) {
  try {
    const r = await reportMyLocation(pos)
    last = { ...pos, at: Date.now() }
    lastSent.value = new Date()
    error.value = ''
    const a = r.alerts?.[0]
    if (a) note.value = a.alert === 'arrived' ? 'แจ้งลูกค้าแล้วว่ารถถึงจุดส่ง' : 'แจ้งลูกค้าแล้วว่ารถใกล้ถึง'
  } catch {
    error.value = 'ส่งตำแหน่งไม่สำเร็จ จะลองใหม่อัตโนมัติ'
  }
}

function onFix({ coords }) {
  const pos = { lat: coords.latitude, lng: coords.longitude, accuracy: Math.round(coords.accuracy), speed: coords.speed, heading: coords.heading }
  if (!last || Date.now() - last.at >= SEND_EVERY_MS || metersBetween(last, pos) >= SEND_IF_MOVED_M) send(pos)
}

async function start() {
  if (watchId != null || !('geolocation' in navigator)) return
  watchId = navigator.geolocation.watchPosition(onFix, (e) => (error.value = e.code === 1 ? 'กรุณาอนุญาตให้เข้าถึงตำแหน่ง เพื่อให้ลูกค้าติดตามรถได้' : 'สัญญาณ GPS อ่อน'), {
    enableHighAccuracy: true,
    maximumAge: 5000,
    timeout: 20_000,
  })
  wakeLock = await navigator.wakeLock?.request('screen').catch(() => null)
}

function stop() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId)
  watchId = null
  wakeLock?.release().catch(() => {})
  wakeLock = null
  last = null
  lastSent.value = null
}

async function checkTrip() {
  try {
    const { staff, meId } = await getDispatchStaff(today())
    const me = staff.find((s) => s.id === meId)
    const job = me?.onTheRoad ? me.jobs.find((j) => ['VEHICLE_PICKED_UP', 'EN_ROUTE', 'ARRIVING'].includes(j.status)) : null
    trip.value = me?.onTheRoad ? { bookingId: job?.bookingId ?? null } : null
  } catch {
    return // offline for a moment: keep the current state
  }
  if (trip.value) start()
  else {
    stop()
    note.value = ''
  }
}

async function arrived() {
  if (!trip.value?.bookingId || busy.value) return
  busy.value = true
  try {
    const r = await markArrived(trip.value.bookingId, await currentPosition({ timeout: 4000 }))
    note.value = r.notified ? 'แจ้งลูกค้าแล้วว่ารถถึงจุดส่ง' : 'ลูกค้าได้รับแจ้งว่ารถถึงแล้ว'
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}

// Wake locks drop when the tab is hidden; take it again when the driver comes back.
async function onVisible() {
  if (document.visibilityState === 'visible' && watchId != null && !wakeLock) wakeLock = await navigator.wakeLock?.request('screen').catch(() => null)
}

onMounted(() => {
  checkTrip()
  checkTimer = setInterval(checkTrip, CHECK_TRIP_MS)
  document.addEventListener('visibilitychange', onVisible)
})
onBeforeUnmount(() => {
  clearInterval(checkTimer)
  document.removeEventListener('visibilitychange', onVisible)
  stop()
})
</script>

<template>
  <section v-if="trip" class="trip" role="status" aria-live="polite">
    <div class="state">
      <i class="pulse" aria-hidden="true" />
      <div>
        <strong>กำลังแชร์ตำแหน่งให้ลูกค้า</strong>
        <small>{{ sentText }} · เปิดหน้านี้ไว้ระหว่างขับ</small>
      </div>
    </div>
    <p v-if="note" class="note"><Icon name="check" :size="14" /> {{ note }}</p>
    <p v-if="error" class="err">{{ error }}</p>
    <button v-if="trip.bookingId" type="button" class="arrived" :disabled="busy" @click="arrived">
      <Icon name="flag" :size="15" /> แจ้งลูกค้าว่าถึงแล้ว
    </button>
  </section>
</template>

<style scoped>
.trip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 16px;
  padding: 12px 16px;
  border: 1px solid rgb(95 211 154 / 0.4);
  border-radius: 18px;
  background: rgb(20 60 44 / 0.75);
  color: #eafff4;
}
.state {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1 1 240px;
}
.state div {
  display: grid;
}
.state small {
  color: rgb(234 255 244 / 0.75);
}
.pulse {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #5fd39a;
  box-shadow: 0 0 0 0 rgb(95 211 154 / 0.6);
  animation: pulse 1.8s ease-out infinite;
}
@keyframes pulse {
  to {
    box-shadow: 0 0 0 12px rgb(95 211 154 / 0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .pulse {
    animation: none;
  }
}
.note,
.err {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 0.85rem;
}
.err {
  color: #ffd29a;
}
.arrived {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 16px;
  border: 0;
  border-radius: 999px;
  background: #5fd39a;
  color: #0b2a1c;
  font-weight: 700;
  cursor: pointer;
}
.arrived:disabled {
  opacity: 0.6;
}
</style>
