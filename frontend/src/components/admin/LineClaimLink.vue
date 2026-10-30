<script setup>
import { ref } from 'vue'
import { claimLink } from '@/api/admin'

// Staff: "ส่งให้ลูกค้าติดตามใน LINE". Makes a one-time link for this booking and
// copies it; staff paste it in the LINE chat with the customer. When the customer
// opens it in LINE the booking moves to their LINE account and its updates go there.
const props = defineProps({ number: { type: String, required: true } })
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
const until = (iso) => new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
</script>

<template>
  <div class="lcl">
    <button type="button" class="make" :disabled="busy" @click="make">
      {{ busy ? 'กำลังสร้างลิงก์…' : link ? 'สร้างลิงก์ใหม่' : 'ส่งให้ลูกค้าติดตามใน LINE' }}
    </button>
    <template v-if="link">
      <div class="row">
        <input :value="link.url" readonly aria-label="ลิงก์ติดตามการจอง" @focus="$event.target.select()" />
        <button type="button" class="copy" @click="copy">{{ copied ? 'คัดลอกแล้ว ✓' : 'คัดลอก' }}</button>
      </div>
      <small>วางลิงก์นี้ในแชต LINE กับลูกค้า · ลูกค้ากดแล้วจะได้รับแจ้งสถานะทาง LINE · ใช้ได้ครั้งเดียว ถึง {{ until(link.expiresAt) }}</small>
    </template>
    <small v-else>ลิงก์ใช้ได้ครั้งเดียว ลูกค้ากดในแอป LINE แล้วการจองจะผูกกับ LINE ของลูกค้า</small>
    <p v-if="error" class="err" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
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
.make:disabled {
  opacity: 0.6;
}
.row {
  display: flex;
  gap: 6px;
}
.row input {
  flex: 1;
  min-width: 0;
  min-height: 36px;
  padding: 0 10px;
  border: 1px solid #d9dbe1;
  border-radius: 10px;
  background: #fff;
  color: #121319;
  font: inherit;
  font-size: 0.8rem;
}
.copy {
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid #d9dbe1;
  border-radius: 10px;
  background: #fff;
  color: #121319;
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}
small {
  color: #6b6d75;
  font-size: 0.75rem;
}
.err {
  color: #c22a21;
  font-size: 0.8rem;
}
</style>
