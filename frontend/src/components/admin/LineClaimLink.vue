<script setup>
import { onMounted, ref } from 'vue'
import { claimLink } from '@/api/admin'

// Staff: "ส่งให้ลูกค้าติดตามใน LINE". Makes a one-time link for this booking and
// copies it; staff paste it in the LINE chat with the customer. When the customer
// opens it in LINE the booking moves to their LINE account and its updates go there.
const props = defineProps({
  number: { type: String, required: true },
  // make the link at once (the "ลิงก์ LINE" toggle): staff pressed it to send one
  auto: { type: Boolean, default: false },
})
const link = ref(null) // { url, expiresAt }
const copied = ref(false)
const busy = ref(false)
const error = ref('')

async function make() {
  busy.value = true
  error.value = ''
  try {
    link.value = await claimLink(props.number)
    await copy()
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = false
  }
}
async function copy() {
  copied.value = false
  try {
    await navigator.clipboard.writeText(link.value.url)
    copied.value = true
  } catch {
    // clipboard blocked: the link is shown, select it by hand
  }
}
onMounted(() => props.auto && make())
const until = (iso) => new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
</script>

<template>
  <div class="lcl">
    <button v-if="!link" type="button" class="make" :disabled="busy" @click="make">
      {{ busy ? 'กำลังสร้างลิงก์…' : 'ส่งให้ลูกค้าติดตามใน LINE' }}
    </button>
    <template v-else>
      <div class="row">
        <input :value="link.url" readonly aria-label="ลิงก์ติดตามการจอง" @focus="$event.target.select()" />
        <button type="button" class="copy" :class="{ done: copied }" @click="copy">{{ copied ? 'คัดลอกแล้ว ✓' : 'คัดลอก' }}</button>
        <button type="button" class="again" :disabled="busy" title="ลิงก์เดิมจะใช้ไม่ได้" @click="make">{{ busy ? 'กำลังสร้าง…' : 'สร้างลิงก์ใหม่' }}</button>
      </div>
      <small>วางลิงก์นี้ในแชต LINE กับลูกค้า · ลูกค้ากดแล้วจะได้รับแจ้งสถานะทาง LINE · ใช้ได้ครั้งเดียว ถึง {{ until(link.expiresAt) }} · สร้างลิงก์ใหม่แล้วลิงก์เดิมจะใช้ไม่ได้</small>
    </template>
    <small v-if="!link">ลิงก์ใช้ได้ครั้งเดียว ลูกค้ากดในแอป LINE แล้วการจองจะผูกกับ LINE ของลูกค้า</small>
    <p v-if="error" class="err" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
/* Follows the surrounding theme: colours come from the text colour around it, so the
   link reads on the dark back-office board and in the light booking form alike. */
.lcl {
  display: grid;
  gap: 6px;
  width: 100%;
  text-align: left;
}
.make {
  justify-self: start;
  min-height: 38px;
  padding: 0 16px;
  border: 0;
  border-radius: 999px;
  background: #06c755;
  color: #fff;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.make:disabled,
.again:disabled {
  opacity: 0.6;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.row input {
  flex: 1 1 260px;
  min-width: 0;
  min-height: 38px;
  padding: 0 12px;
  border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, currentColor 6%, transparent);
  color: inherit;
  font: inherit;
  font-size: 0.82rem;
}
.copy,
.again {
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}
.copy.done {
  border-color: #06c755;
  color: #06c755;
}
small {
  opacity: 0.7;
  font-size: 0.75rem;
}
.err {
  color: #e2362c;
  font-size: 0.8rem;
}
</style>
