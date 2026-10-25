<script setup>
import { ref } from 'vue'
import { recordMileage } from '@/api/admin'
import OpsDialog from './OpsDialog.vue'

// "อัปเดตเลขไมล์": odometer at hand-over (ไมล์ส่งรถ) and at return (ไมล์รับคืน).
// Each reading becomes the car's current odometer and feeds its service reminders.
const props = defineProps({ booking: { type: Object, required: true } })
const emit = defineEmits(['close', 'saved'])

const start = ref(props.booking.ops?.odometerStartKm ?? null)
const end = ref(props.booking.ops?.odometerEndKm ?? null)
const kind = ref(start.value == null ? 'PICKUP' : 'RETURN')
const km = ref('')
const busy = ref(false)
const error = ref('')
const fmt = (v) => (v == null ? '—' : `${v.toLocaleString('th-TH')} กม.`)

async function save() {
  const value = Number(String(km.value).replace(/[,\s]/g, ''))
  if (!Number.isInteger(value) || value < 0) {
    error.value = 'กรอกเลขไมล์เป็นตัวเลข'
    return
  }
  busy.value = true
  error.value = ''
  try {
    const r = await recordMileage(props.booking.id, kind.value, value)
    start.value = r.startKm
    end.value = r.endKm
    km.value = ''
    emit('saved', r)
    if (kind.value === 'PICKUP') kind.value = 'RETURN'
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <OpsDialog :title="`อัปเดตเลขไมล์ — ${booking.number}`" icon="gauge" @close="emit('close')">
    <div class="now">
      <div><small>ไมล์ส่ง</small><b>{{ fmt(start) }}</b></div>
      <div><small>ไมล์รับคืน</small><b>{{ fmt(end) }}</b></div>
      <div v-if="start != null && end != null" class="dist"><small>ระยะที่ใช้</small><b>{{ (end - start).toLocaleString('th-TH') }} กม.</b></div>
    </div>
    <div>
      <p class="lbl">ประเภท</p>
      <div class="seg">
        <button type="button" :class="{ on: kind === 'PICKUP' }" @click="kind = 'PICKUP'">ไมล์ส่งรถ</button>
        <button type="button" :class="{ on: kind === 'RETURN' }" @click="kind = 'RETURN'">ไมล์รับคืน</button>
      </div>
    </div>
    <form class="f-wrap" @submit.prevent="save">
      <label class="f">เลขไมล์ (กม.)<input v-model="km" type="text" inputmode="numeric" placeholder="เช่น 45000" autofocus /></label>
      <p v-if="error" class="err" role="alert">{{ error }}</p>
      <button type="submit" class="primary" :disabled="busy || !String(km).trim()">{{ busy ? 'กำลังบันทึก…' : 'บันทึกเลขไมล์' }}</button>
    </form>
    <p class="hint">ระบบจะบันทึกประวัติอัตโนมัติเข้าหน้า "ซ่อมบำรุง" ของรถคันนี้</p>
  </OpsDialog>
</template>

<style scoped>
.now {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 8px;
  padding: 14px;
  border-radius: 14px;
  background: #f2f3f5;
  text-align: center;
}
.now small {
  display: block;
  color: #6b6e7a;
  font-size: 0.75rem;
}
.now b {
  font-variant-numeric: tabular-nums;
}
.dist b {
  color: #1f8a56;
}
.lbl {
  margin-bottom: 6px;
  font-size: 0.85rem;
  font-weight: 600;
}
.f-wrap {
  display: grid;
  gap: 12px;
}
</style>
