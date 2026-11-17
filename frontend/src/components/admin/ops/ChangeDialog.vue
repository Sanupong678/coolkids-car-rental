<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { addOnBooking, changeBooking, listVehicles, quoteBookingChange } from '@/api/admin'
import OpsDialog from './OpsDialog.vue'

// Two tools on a booking the customer changes their mind about:
//   เปลี่ยนรถ / เปลี่ยนวัน (mode "change") — same booking number, another car and / or dates.
//     What was paid stays on the booking; the dialog shows the difference: collect more, or
//     give back. The car can be swapped until it leaves the shop.
//   จองเพิ่ม (mode "addon") — the same car for more days (moves the return date; once the car
//     is with the renter that is "ใช้งานต่อ"), or another car on the same bill: a new booking
//     number with the renter's details and documents, confirmed at once, no reservation fee.
const props = defineProps({
  booking: { type: Object, required: true },
  mode: { type: String, default: 'change' }, // 'change' | 'addon'
})
const emit = defineEmits(['close', 'saved', 'extend'])

const tz = 'Asia/Bangkok'
const part = (d, o) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, ...o }).format(d)
const dayOf = (d) => part(d, { year: 'numeric', month: '2-digit', day: '2-digit' })
const timeOf = (d) => part(d, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const at = (day, time) => (day && time ? new Date(`${day}T${time}:00+07:00`) : null)
const baht = (m) => `฿${(Math.abs(m) / 100).toLocaleString('th-TH')}`
const fmt = (d) => d.toLocaleString('th-TH', { timeZone: tz, day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })

const b = props.booking
const SWAPPABLE = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY']
const canSwap = SWAPPABLE.includes(b.status)
// addon: 'same' = same car, more days · 'other' = another car on the bill
const kind = ref(props.mode === 'addon' ? 'other' : 'change')

const pickup = new Date(b.pickupAt)
const ret = new Date(b.returnAt)
// an extra car starts with the booking's dates (or from the next hour when those have begun)
const nextHour = new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000)
const start = props.mode === 'addon' && pickup < nextHour ? nextHour : pickup
const end = props.mode === 'addon' && ret < new Date(start.getTime() + 86_400_000) ? new Date(start.getTime() + 2 * 86_400_000) : ret
const pDay = ref(dayOf(start))
const pTime = ref(timeOf(start))
const rDay = ref(dayOf(end))
const rTime = ref(timeOf(end))
const slug = ref(b.vehicle.slug)

const cars = ref([])
onMounted(async () => {
  try {
    cars.value = (await listVehicles()).filter((v) => !v.archived && v.status === 'ACTIVE')
  } catch (err) {
    error.value = err.message
  }
})
watch(kind, (k) => {
  // "same car, more days" keeps the pick-up and car; the other modes start from the booking's dates
  if (k === 'same') {
    slug.value = b.vehicle.slug
    pDay.value = dayOf(pickup)
    pTime.value = timeOf(pickup)
    rDay.value = dayOf(new Date(ret.getTime() + 86_400_000))
    rTime.value = timeOf(ret)
  } else {
    pDay.value = dayOf(start)
    pTime.value = timeOf(start)
    rDay.value = dayOf(end)
    rTime.value = timeOf(end)
  }
})

const body = computed(() => {
  const p = at(pDay.value, pTime.value)
  const r = at(rDay.value, rTime.value)
  if (!p || !r) return null
  return { vehicleSlug: slug.value, pickupAt: p.toISOString(), returnAt: r.toISOString() }
})

const quote = ref(null)
const quoting = ref(false)
const error = ref('')
// the Thai reason the API gives per field, else its message
const why = (err) => Object.values(err.details ?? {}).flat().find((m) => typeof m === 'string') ?? err.message
let seq = 0
async function requote() {
  const req = body.value
  quote.value = null
  error.value = ''
  if (!req) return
  const mine = ++seq
  quoting.value = true
  try {
    const q = await quoteBookingChange(b.number, { ...req, ...(kind.value === 'other' ? { addOn: true } : {}) })
    if (mine === seq) quote.value = q
  } catch (err) {
    if (mine === seq) error.value = why(err)
  } finally {
    if (mine === seq) quoting.value = false
  }
}
let timer
watch([body, kind], () => {
  clearTimeout(timer)
  timer = setTimeout(requote, 350)
}, { immediate: true })

const busySet = computed(() => new Set(quote.value?.busy ?? []))
const carLabel = (v) => `${v.fleetNo ? `#${v.fleetNo} ` : ''}${v.brand} ${v.model}${v.trim ? ` ${v.trim}` : ''} · ${v.licensePlate ?? ''} · ${baht(v.dailyRateMinor)}/วัน`
const unchanged = computed(() => kind.value !== 'other' && body.value
  && body.value.vehicleSlug === b.vehicle.slug
  && new Date(body.value.pickupAt).getTime() === pickup.getTime()
  && new Date(body.value.returnAt).getTime() === ret.getTime())

const busy = ref(false)
const done = ref('')
async function save() {
  if (!body.value || !quote.value) return
  busy.value = true
  error.value = ''
  try {
    if (kind.value === 'other') {
      const r = await addOnBooking(b.number, body.value)
      done.value = r.confirmed
        ? `จองเพิ่มแล้ว: ${r.booking.number} (ยืนยันแล้ว อยู่ในแท็บ "เตรียมส่งรถ")`
        : `สร้าง ${r.booking.number} แล้ว แต่บัญชีนี้ยังไม่มีรูปบัตร / ใบขับขี่ — อยู่ในแท็บ "ยังกรอกไม่เสร็จ" กด "กรอกต่อ" เพื่อแนบเอกสาร`
    } else {
      await changeBooking(b.number, body.value)
      emit('saved')
      emit('close')
    }
  } catch (err) {
    error.value = why(err)
  } finally {
    busy.value = false
  }
}
const title = computed(() => (props.mode === 'addon' ? `จองเพิ่ม — ${b.number}` : `เปลี่ยนรถ / เปลี่ยนวัน — ${b.number}`))
</script>

<template>
  <OpsDialog :title="title" :icon="mode === 'addon' ? 'calendar' : 'car'" @close="emit('close')">
    <div class="now">
      <small>ตอนนี้</small>
      <b>{{ b.vehicle.brand }} {{ b.vehicle.model }} · {{ b.vehicle.plate }}</b>
      <span>{{ fmt(pickup) }} – {{ fmt(ret) }}</span>
      <span>ยอดรวม {{ baht(b.money.totalMinor) }} · มัดจำ {{ baht(b.money.depositMinor) }}</span>
    </div>

    <p v-if="done" class="ok" role="status">{{ done }}</p>
    <form v-else class="f-wrap" @submit.prevent="save">
      <div v-if="mode === 'addon'" class="seg" role="radiogroup">
        <button type="button" role="radio" :aria-checked="kind === 'other'" :class="{ on: kind === 'other' }" @click="kind = 'other'">เพิ่มอีกคัน</button>
        <button type="button" role="radio" :aria-checked="kind === 'same'" :class="{ on: kind === 'same' }" @click="kind = 'same'">คันเดิม เพิ่มวัน</button>
      </div>

      <template v-if="kind === 'same' && b.status === 'ACTIVE'">
        <p class="hint">รถอยู่กับลูกค้าแล้ว เพิ่มวันด้วย "ใช้งานต่อ" (ออกสัญญารอบใหม่ ใช้มัดจำเดิม)</p>
        <button type="button" class="primary" @click="emit('extend')">ไปที่ ใช้งานต่อ</button>
      </template>
      <template v-else>
        <label v-if="kind !== 'same'" class="f">
          {{ kind === 'other' ? 'รถคันที่จองเพิ่ม' : 'รถ' }}
          <select v-model="slug" :disabled="kind === 'change' && !canSwap">
            <option v-for="v in cars" :key="v.slug" :value="v.slug" :disabled="kind === 'other' && v.slug === b.vehicle.slug">
              {{ carLabel(v) }}{{ v.slug === b.vehicle.slug ? ' (คันเดิม)' : busySet.has(v.slug) ? ' — ไม่ว่าง' : '' }}
            </option>
          </select>
          <small v-if="kind === 'change' && !canSwap" class="note">รถออกไปหาลูกค้าแล้ว เปลี่ยนได้เฉพาะวัน (หรือใช้ "จองเพิ่ม")</small>
        </label>
        <div v-if="kind !== 'same'" class="two">
          <label class="f">วันรับรถ<input v-model="pDay" type="date" required /></label>
          <label class="f">เวลา<input v-model="pTime" type="time" step="1800" required /></label>
        </div>
        <div class="two">
          <label class="f">{{ kind === 'same' ? 'วันคืนรถใหม่' : 'วันคืนรถ' }}<input v-model="rDay" type="date" required /></label>
          <label class="f">เวลา<input v-model="rTime" type="time" step="1800" required /></label>
        </div>

        <p v-if="quoting" class="hint">กำลังคำนวณ…</p>
        <p v-else-if="kind === 'other' && slug === b.vehicle.slug" class="hint">เลือกรถคันที่ลูกค้าจะเช่าเพิ่ม (คันที่ขึ้นว่า "ไม่ว่าง" มีคิวในช่วงวันนี้แล้ว)</p>
        <div v-else-if="quote && kind === 'other'" class="sum" :class="{ bad: !quote.available }">
          <span>{{ quote.after.vehicle }} · {{ quote.after.days }} วัน ({{ baht(quote.after.dailyMinor) }}/วัน)</span>
          <span>ค่าเช่า <b>{{ baht(quote.after.rentalMinor) }}</b><template v-if="quote.after.tripMinor"> + ค่าส่ง/รับรถ {{ baht(quote.after.tripMinor) }}</template></span>
          <span>เก็บตอนส่งรถ <b>{{ baht(quote.after.totalMinor) }}</b> + มัดจำ {{ baht(quote.after.depositMinor) }}</span>
          <small>ไม่เก็บค่าจอง 1,000฿ · ใช้ข้อมูลและเอกสารลูกค้าเดิม · เลขจองใหม่ ผูกบิลเดียวกับ {{ b.number }}</small>
          <strong v-if="!quote.available">รถคันนี้ไม่ว่างในช่วงวันที่เลือก</strong>
        </div>
        <div v-else-if="quote && !unchanged" class="sum" :class="{ bad: !quote.available }">
          <span v-if="quote.swapped">{{ quote.before.vehicle }} → <b>{{ quote.after.vehicle }}</b></span>
          <span>ยอดรวม {{ baht(quote.before.totalMinor) }} ({{ quote.before.days }} วัน) → <b>{{ baht(quote.after.totalMinor) }}</b> ({{ quote.after.days }} วัน)</span>
          <span>ส่วนต่าง <b>{{ quote.differenceMinor >= 0 ? '+' : '−' }}{{ baht(quote.differenceMinor) }}</b></span>
          <span v-if="quote.depositDifferenceMinor">มัดจำ {{ baht(quote.before.depositMinor) }} → <b>{{ baht(quote.after.depositMinor) }}</b></span>
          <span>จ่ายค่าเช่ามาแล้ว {{ baht(quote.paidMinor) }}</span>
          <span v-if="quote.refundMinor" class="refund">ต้องคืนลูกค้า <b>{{ baht(quote.refundMinor) }}</b></span>
          <span v-else>คงเหลือเก็บตอนส่งรถ <b>{{ baht(quote.leftToCollectMinor) }}</b></span>
          <strong v-if="!quote.available">รถคันนี้ไม่ว่างในช่วงวันที่เลือก</strong>
        </div>

        <p v-if="error" class="err" role="alert">{{ error }}</p>
        <button type="submit" class="primary" :disabled="busy || quoting || !quote || !quote.available || unchanged || (kind === 'other' && slug === b.vehicle.slug)">
          {{ busy ? 'กำลังบันทึก…' : kind === 'other' ? 'ยืนยันจองเพิ่ม' : 'ยืนยันการเปลี่ยน · ออกสัญญาใหม่' }}
        </button>
      </template>
    </form>
    <button v-if="done" type="button" class="primary" @click="emit('saved'); emit('close')">ปิด</button>
  </OpsDialog>
</template>

<style scoped>
.now {
  display: grid;
  gap: 2px;
  padding: 14px;
  border-radius: 14px;
  background: #f2f3f5;
  font-size: 0.85rem;
}
.now small {
  color: #6b6e7a;
  font-size: 0.75rem;
}
.f-wrap {
  display: grid;
  gap: 12px;
}
.seg {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.seg button {
  padding: 10px;
  border: 1px solid #d9dce3;
  border-radius: 10px;
  background: #fff;
  color: #14161f;
  font: inherit;
  cursor: pointer;
}
.seg button.on {
  border-color: #14161f;
  background: #14161f;
  color: #fff;
  font-weight: 700;
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
.f input,
.f select {
  width: 100%;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid #d9dce3;
  border-radius: 10px;
  background: #fff;
  color: #14161f;
  font: inherit;
  font-weight: 400;
}
.note {
  color: #8a5a00;
  font-weight: 400;
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
.sum.bad {
  border-color: #f2c4c0;
  background: #fdf0ef;
}
.sum strong,
.refund {
  color: #c62828;
}
.ok {
  padding: 12px 14px;
  border-radius: 12px;
  background: #effaf3;
  color: #1f6b46;
  font-size: 0.9rem;
}
.err {
  color: #c62828;
  font-size: 0.85rem;
}
.primary {
  width: 100%;
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
  font-size: 0.8rem;
}
</style>
