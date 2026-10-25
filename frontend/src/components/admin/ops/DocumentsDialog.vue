<script setup>
import { computed, onMounted, ref } from 'vue'
import { listBookingDocuments, sendBookingDocument, sendContract, signBookingDocument } from '@/api/admin'
import { contractPdfUrl } from '@/api/bookings'
import Icon from '@/components/ui/Icon.vue'
import SignaturePad from '@/components/booking/SignaturePad.vue'
import OpsDialog from './OpsDialog.vue'

// Every paper of a booking, filled with the customer's real data:
//   สัญญาเช่า (rental agreement) · ใบจอง (booking slip) · ใบเสร็จ (one per payment)
// Preview, print, download the PDF, sign (shop / customer) and send to the
// customer by LINE or e-mail.
const props = defineProps({ booking: { type: Object, required: true } })
const emit = defineEmits(['close'])
const BASE = import.meta.env.VITE_API_BASE ?? '/api/v1'

const tab = ref('contract') // contract | booking | receipt
const receiptId = ref(null)
const docs = ref(null)
const lang = ref('th')
const frame = ref(null)
const email = ref(props.booking.customerEmail && !/@(line\.coolkids\.invalid|coolkids\.local)$/i.test(props.booking.customerEmail) ? props.booking.customerEmail : '')
const busy = ref(null)
const result = ref('')
const error = ref('')
const signing = ref(null) // 'SHOP' | 'CUSTOMER'
const signature = ref(null)
const stamp = ref(0) // reloads the preview after signing

async function load() {
  try {
    docs.value = await listBookingDocuments(props.booking.id)
    receiptId.value ??= docs.value.receipts[0]?.id ?? null
  } catch (err) {
    error.value = err.message
  }
}
onMounted(load)

const q = computed(() => (tab.value === 'booking' ? 'kind=booking' : `kind=receipt&receipt=${receiptId.value}`))
const src = computed(() =>
  tab.value === 'contract'
    ? `/admin/contracts/${props.booking.id}/print?lang=${lang.value}&auto=0`
    : `${BASE}/admin/bookings/${props.booking.id}/documents/view?${q.value}&v=${stamp.value}`,
)
const pdf = computed(() => (tab.value === 'contract' ? contractPdfUrl(props.booking.number, { download: true }) : `${BASE}/admin/bookings/${props.booking.id}/documents/pdf?${q.value}`))
const current = computed(() => (tab.value === 'booking' ? docs.value?.booking : docs.value?.receipts.find((r) => r.id === receiptId.value)))
const ready = computed(() => tab.value !== 'receipt' || receiptId.value)
const money = (m) => `฿${(m / 100).toLocaleString('th-TH')}`

function print() {
  if (tab.value === 'contract') window.open(`/admin/contracts/${props.booking.id}/print?lang=${lang.value}`, '_blank', 'noopener')
  else frame.value?.contentWindow?.print()
}

async function send(via) {
  busy.value = via
  error.value = ''
  result.value = ''
  try {
    const r =
      tab.value === 'contract'
        ? await sendContract(props.booking.id, via, via === 'email' ? email.value.trim() : undefined)
        : await sendBookingDocument(props.booking.id, { kind: tab.value, receiptId: receiptId.value ?? undefined, via, email: via === 'email' ? email.value.trim() || undefined : undefined })
    result.value = via === 'email' ? `ส่ง PDF ไปที่ ${r.to} แล้ว` : r.delivered ? 'ส่งลิงก์ทาง LINE แล้ว' : 'บันทึกแล้ว · ยังไม่ได้เชื่อม LINE OA จึงยังไม่ส่งจริง'
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = null
  }
}

async function saveSignature() {
  if (!signature.value) return
  busy.value = 'sign'
  error.value = ''
  try {
    await signBookingDocument(props.booking.id, { kind: tab.value, receiptId: receiptId.value ?? undefined, party: signing.value, signature: signature.value })
    signing.value = null
    signature.value = null
    stamp.value += 1
    await load()
    result.value = 'บันทึกลายเซ็นแล้ว'
  } catch (err) {
    error.value = err.message
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <OpsDialog :title="`เอกสาร — ${booking.number}`" icon="receipt" wide @close="emit('close')">
    <div class="tabs" role="tablist">
      <button type="button" role="tab" :aria-selected="tab === 'contract'" :class="{ on: tab === 'contract' }" @click="tab = 'contract'">สัญญาเช่า</button>
      <button type="button" role="tab" :aria-selected="tab === 'booking'" :class="{ on: tab === 'booking' }" @click="tab = 'booking'">ใบจอง</button>
      <button type="button" role="tab" :aria-selected="tab === 'receipt'" :class="{ on: tab === 'receipt' }" @click="tab = 'receipt'">
        ใบเสร็จ <span v-if="docs">{{ docs.receipts.length }}</span>
      </button>
    </div>

    <div v-if="tab === 'receipt'" class="chips">
      <button v-for="r in docs?.receipts ?? []" :key="r.id" type="button" :class="{ on: r.id === receiptId }" @click="receiptId = r.id">
        <Icon name="receipt" :size="13" /> {{ r.number }} <small>{{ r.purpose }} {{ money(r.amountMinor) }}</small>
      </button>
      <p v-if="docs && !docs.receipts.length" class="hint">ยังไม่มีการรับเงิน · ใบเสร็จออกอัตโนมัติทุกครั้งที่รับเงิน</p>
    </div>

    <div class="bar">
      <div v-if="tab === 'contract'" class="seg" role="group" aria-label="ภาษา">
        <button v-for="[k, t] in [['th', 'ไทย'], ['en', 'English'], ['zh', '中文']]" :key="k" type="button" :class="{ on: lang === k }" @click="lang = k">{{ t }}</button>
      </div>
      <span class="grow" />
      <template v-if="tab !== 'contract' && ready">
        <button type="button" class="btn" @click="signing = 'SHOP'"><Icon name="sparkles" :size="15" /> เซ็นชื่อ<small v-if="current?.signed?.shop"> ✓ร้าน</small><small v-if="current?.signed?.customer"> ✓ลูกค้า</small></button>
      </template>
      <a v-if="ready" :href="pdf" class="btn"><Icon name="printer" :size="15" /> ดาวน์โหลด PDF</a>
      <button v-if="ready" type="button" class="btn" @click="print"><Icon name="printer" :size="15" /> พิมพ์</button>
    </div>

    <div v-if="signing" class="signbox">
      <div class="seg" role="radiogroup" aria-label="ผู้เซ็น">
        <button type="button" :class="{ on: signing === 'SHOP' }" @click="signing = 'SHOP'">ผู้ให้บริการ (ร้าน)</button>
        <button type="button" :class="{ on: signing === 'CUSTOMER' }" @click="signing = 'CUSTOMER'">{{ tab === 'booking' ? 'ผู้จอง' : 'ผู้ชำระเงิน' }} (ลูกค้า)</button>
      </div>
      <SignaturePad v-model="signature" />
      <div class="row">
        <button type="button" class="primary" :disabled="!signature || busy === 'sign'" @click="saveSignature">บันทึกลายเซ็น</button>
        <button type="button" class="btn" @click="signing = null">ยกเลิก</button>
      </div>
    </div>

    <iframe v-if="ready" ref="frame" :key="src" :src="src" class="paper" title="ตัวอย่างเอกสาร" />

    <div v-if="ready" class="send">
      <button type="button" class="line" :disabled="busy !== null" @click="send('line')">{{ busy === 'line' ? 'กำลังส่ง…' : 'ส่งเข้า LINE ลูกค้า' }}</button>
      <form class="mail" @submit.prevent="send('email')">
        <input v-model="email" type="email" placeholder="อีเมลลูกค้า" aria-label="อีเมลลูกค้า" />
        <button type="submit" class="primary" :disabled="busy !== null || !email.trim()"><Icon name="mail" :size="15" /> {{ busy === 'email' ? 'กำลังส่ง…' : 'ส่งอีเมล (แนบ PDF)' }}</button>
      </form>
    </div>
    <p v-if="result" class="ok" role="status">{{ result }}</p>
    <p v-if="error" class="err" role="alert">{{ error }}</p>
  </OpsDialog>
</template>

<style scoped>
.tabs,
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.tabs button,
.chips button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid #c9ccd4;
  border-radius: 999px;
  background: #fff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.tabs button.on,
.chips button.on {
  border-color: #0e2a52;
  background: #0e2a52;
  color: #fff;
}
.tabs span {
  min-width: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: #e2362c;
  color: #fff;
  font-size: 0.72rem;
}
.chips small {
  opacity: 0.75;
  font-weight: 400;
}
.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.grow {
  flex: 1;
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid #c9ccd4;
  border-radius: 12px;
  background: #fff;
  color: #121319;
  font: inherit;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
}
.btn small {
  color: #1f8a56;
}
.signbox {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid #e3e5ec;
  border-radius: 14px;
  background: #fafafa;
}
.row {
  display: flex;
  gap: 8px;
}
.row .primary {
  padding: 0 18px;
}
.paper {
  width: 100%;
  height: min(60dvh, 680px);
  border: 1px solid #e3e5ec;
  border-radius: 12px;
  background: #f2f3f5;
}
.send {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px;
}
.line {
  min-height: 46px;
  padding: 0 16px;
  border: 0;
  border-radius: 12px;
  background: #06c755;
  color: #fff;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.line:disabled {
  opacity: 0.6;
}
.mail {
  display: flex;
  gap: 8px;
}
.mail input {
  flex: 1;
  min-width: 0;
  min-height: 46px;
  padding: 0 14px;
  border: 1px solid #c9ccd4;
  border-radius: 12px;
  font: inherit;
}
.mail .primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 16px;
}
@media (max-width: 640px) {
  .send {
    grid-template-columns: 1fr;
  }
  .mail {
    flex-direction: column;
  }
}
</style>
