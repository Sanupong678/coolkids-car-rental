<script setup>
import { computed, ref } from 'vue'
import { extendBooking } from '@/api/admin'
import OpsDialog from './OpsDialog.vue'

// "ใช้งานต่อ": the renter keeps the same car longer. Staff pick the new return day and
// time; the extra days are priced at the car's day rate (editable, no reservation fee).
// The booking keeps its card on the board, ends later, and gets a contract for the new
// round; the customer is told the new dates.
const props = defineProps({ booking: { type: Object, required: true } })
const emit = defineEmits(['close', 'saved'])

const tz = 'Asia/Bangkok'
const part = (d, o) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, ...o }).format(d)
const from = new Date(props.booking.returnAt)
const plusDay = new Date(from.getTime() + 86_400_000)
const day = ref(part(plusDay, { year: 'numeric', month: '2-digit', day: '2-digit' }))
const time = ref(part(from, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }))
const until = computed(() => (day.value && time.value ? new Date(`${day.value}T${time.value}:00+07:00`) : null))
const days = computed(() => (until.value > from ? Math.ceil((until.value - from) / 86_400_000) : 0))
const daily = props.booking.ops?.dailyMinor ?? 0
// The extra rent follows the days picked (day rate × days) and is shown in the box; staff
// may type another amount, and "คิดตามราคารายวัน" puts the worked-out one back.
const autoMinor = computed(() => daily * days.value)
const typed = ref('') // baht as typed; '' = not touched → worked out from the days
const manual = computed(() => typed.value !== '')
const shown = computed({
  get: () => (manual.value ? typed.value : (autoMinor.value / 100).toLocaleString('th-TH')),
  set: (x) => (typed.value = x),
})
const rentMinor = computed(() => (manual.value ? Math.round(Number(String(typed.value).replace(/[,\s]/g, '')) * 100) : autoMinor.value))
const round = (props.booking.ops?.extensions?.length ?? 0) + 2
const baht = (m) => `฿${(m / 100).toLocaleString('th-TH')}`
const fmt = (d) => d.toLocaleString('th-TH', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })

const busy = ref(false)
const error = ref('')
async function save() {
  if (!days.value) return (error.value = 'วันคืนรถใหม่ต้องหลังวันคืนรถเดิม')
  if (!Number.isFinite(rentMinor.value) || rentMinor.value < 0) return (error.value = 'กรอกค่าเช่าเป็นตัวเลข')
  busy.value = true
  error.value = ''
  try {
    await extendBooking(props.booking.number, { returnAt: until.value.toISOString(), rentalMinor: rentMinor.value })
    emit('saved')
    emit('close')
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <OpsDialog :title="`ใช้งานต่อ — ${booking.number}`" icon="calendar" @close="emit('close')">
    <div class="now">
      <div><small>คืนรถเดิม</small><b>{{ fmt(from) }}</b></div>
      <div><small>สัญญารอบที่</small><b>{{ round }}</b></div>
    </div>
    <form class="f-wrap" @submit.prevent="save">
      <div class="two">
        <label class="f">วันคืนรถใหม่<input v-model="day" type="date" required /></label>
        <label class="f">เวลา<input v-model="time" type="time" step="60" required /></label>
      </div>
      <label class="f">
        ค่าเช่าเพิ่ม (บาท)
        <input v-model="shown" type="text" inputmode="decimal" />
        <small class="calc">
          <template v-if="manual">กรอกเอง · <button type="button" class="link" @click="typed = ''">คิดตามราคารายวัน ({{ baht(daily) }} × {{ days }} วัน = {{ baht(autoMinor) }})</button></template>
          <template v-else>ราคารายวัน {{ baht(daily) }} × {{ days }} วัน = {{ baht(autoMinor) }}</template>
        </small>
      </label>
      <div class="sum">
        <span>ใช้ต่อ <b>{{ days }} วัน</b><template v-if="until && days"> · ถึง {{ fmt(until) }}</template></span>
        <span>เรียกเก็บเพิ่ม <b>{{ baht(rentMinor || 0) }}</b></span>
        <small>ไม่คิดค่าจองเพิ่ม · ใช้มัดจำเดิม · ยอดเพิ่มรวมในการ์ดเดิม</small>
      </div>
      <p v-if="error" class="err" role="alert">{{ error }}</p>
      <button type="submit" class="primary" :disabled="busy || !days">{{ busy ? 'กำลังบันทึก…' : 'ยืนยันใช้งานต่อ · ออกสัญญารอบใหม่' }}</button>
    </form>
    <p class="hint">ระบบจะแจ้งลูกค้าทาง LINE / อีเมล ว่าใช้ต่อถึงวันไหน พร้อมให้เซ็นสัญญารอบใหม่</p>
  </OpsDialog>
</template>

<style scoped>
.now {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  padding: 14px;
  border-radius: 14px;
  background: #f2f3f5;
}
.now small {
  display: block;
  color: #6b6e7a;
  font-size: 0.75rem;
}
.f-wrap {
  display: grid;
  gap: 12px;
}
.two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.f {
  display: grid;
  gap: 6px;
  font-size: 0.85rem;
  font-weight: 600;
}
.f input {
  padding: 10px 12px;
  border: 1px solid #d9dce3;
  border-radius: 10px;
  background: #fff;
  color: #14161f;
  font: inherit;
  font-weight: 400;
}
.calc {
  color: #6b6e7a;
  font-size: 0.78rem;
  font-weight: 400;
}
.link {
  padding: 0;
  border: 0;
  background: none;
  color: #2f5fb3;
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}
.sum {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid #bfe6cf;
  border-radius: 12px;
  background: #effaf3;
  color: #1f6b46;
  font-size: 0.88rem;
}
.sum small {
  color: #4b7a62;
}
.err {
  color: #c62828;
  font-size: 0.85rem;
}
.primary {
  padding: 12px;
  border: 0;
  border-radius: 12px;
  background: #e2362c;
  color: #fff;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.primary:disabled {
  opacity: 0.5;
  cursor: default;
}
.hint {
  color: #6b6e7a;
  font-size: 0.78rem;
}
</style>
