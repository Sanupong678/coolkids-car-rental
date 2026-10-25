<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { listSlips, reviewSlip, slipImageUrl } from '@/api/admin'
import { useAuthStore } from '@/stores/auth'
import { money } from '@/utils/format'
import Icon from '@/components/ui/Icon.vue'

// PromptPay slips. Most are confirmed automatically against the bank (SlipOK);
// the ones the bank could not answer for land here under "รอตรวจ" with the car
// still held. Staff compare the slip with their bank app, then approve (the
// booking is confirmed) or reject (the customer is told on LINE to send another).
const auth = useAuthStore()
const TABS = [
  ['NEEDS_REVIEW', 'รอตรวจ'],
  ['VERIFIED', 'ผ่าน'],
  ['REJECTED', 'ไม่ผ่าน'],
]
const tab = ref('NEEDS_REVIEW')
const slips = ref([])
const images = ref({})
const loading = ref(false)
const busyId = ref(null)
const error = ref('')
const refs = ref({}) // slip id → bank reference typed by staff
let timer

const tz = 'Asia/Bangkok'
const time = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { timeZone: tz, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')
const BOOKING = { PENDING: 'รอชำระ', CONFIRMED: 'ยืนยันแล้ว', EXPIRED: 'หมดเวลา (ปล่อยรถแล้ว)', CANCELLED: 'ยกเลิก' }

async function loadImage(id) {
  const res = await fetch(slipImageUrl(id), { credentials: 'include' })
  if (res.ok) images.value = { ...images.value, [id]: URL.createObjectURL(await res.blob()) }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    slips.value = await listSlips(tab.value)
    slips.value.filter((s) => !images.value[s.id]).forEach((s) => loadImage(s.id))
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

async function decide(s, decision) {
  let reason
  if (decision === 'reject') {
    reason = window.prompt(`เหตุผลที่สลิปของ ${s.booking.number} ไม่ผ่าน (ลูกค้าจะเห็นข้อความนี้)`, 'ยอดเงินยังไม่เข้าบัญชี')
    if (reason == null) return
  } else if (!window.confirm(`ยืนยันว่าได้รับเงิน ${money(s.booking.expectedMinor, s.booking.currency)} สำหรับ ${s.booking.number} แล้ว?`)) {
    return
  }
  busyId.value = s.id
  error.value = ''
  try {
    const transRef = refs.value[s.id]?.trim() || undefined
    await reviewSlip(s.id, { decision, reason: reason?.trim() || undefined, transRef })
    await load()
  } catch (err) {
    error.value = err.message
  } finally {
    busyId.value = null
  }
}

watch(tab, load)
onMounted(() => {
  load()
  timer = setInterval(() => tab.value === 'NEEDS_REVIEW' && load(), 30_000)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  Object.values(images.value).forEach((u) => URL.revokeObjectURL(u))
})
</script>

<template>
  <div class="slips">
    <div class="tabs" role="tablist" aria-label="สถานะสลิป">
      <button v-for="[k, l] in TABS" :key="k" type="button" role="tab" :aria-selected="tab === k" :class="{ on: tab === k }" @click="tab = k">
        {{ l }}<span v-if="k === tab">{{ slips.length }}</span>
      </button>
    </div>
    <p v-if="error" class="err" role="alert">{{ error }}</p>

    <ul v-if="slips.length" class="list">
      <li v-for="s in slips" :key="s.id" class="slip">
        <a v-if="images[s.id]" :href="images[s.id]" target="_blank" rel="noopener" class="img" title="เปิดรูปสลิปขนาดเต็ม">
          <img :src="images[s.id]" :alt="`สลิปของ ${s.booking.number}`" />
        </a>
        <span v-else class="img ph"><Icon name="receipt" :size="22" /></span>

        <div class="info">
          <div class="top">
            <strong>{{ s.booking.number }}</strong>
            <span class="pill" :class="{ bad: s.booking.status === 'EXPIRED' }">{{ BOOKING[s.booking.status] ?? s.booking.status }}</span>
            <b class="amt">{{ money(s.booking.expectedMinor, s.booking.currency) }}</b>
          </div>
          <dl>
            <div><dt>ลูกค้า</dt><dd>{{ s.customer.fullName ?? '—' }} · {{ s.customer.phone ?? '—' }}</dd></div>
            <div><dt>รถ</dt><dd>{{ s.booking.vehicle }}</dd></div>
            <div><dt>ส่งสลิป</dt><dd>{{ time(s.createdAt) }}</dd></div>
            <div v-if="s.slip.amountMinor != null">
              <dt>ยอดในสลิป</dt>
              <dd :class="{ mismatch: s.slip.amountMinor !== s.booking.expectedMinor }">{{ money(s.slip.amountMinor, s.booking.currency) }}</dd>
            </div>
            <div v-if="s.slip.transferredAt"><dt>เวลาโอน</dt><dd>{{ time(s.slip.transferredAt) }}</dd></div>
            <div v-if="s.slip.senderName"><dt>ผู้โอน</dt><dd>{{ s.slip.senderName }}</dd></div>
            <div v-if="s.slip.transRef"><dt>เลขอ้างอิง</dt><dd class="mono">{{ s.slip.transRef }}</dd></div>
            <div v-if="s.rejectReason"><dt>เหตุผล</dt><dd>{{ s.rejectReason }}</dd></div>
            <div v-if="s.reviewedBy"><dt>ตรวจโดย</dt><dd>{{ s.reviewedBy }} · {{ time(s.reviewedAt) }}</dd></div>
          </dl>
          <p v-if="s.status === 'NEEDS_REVIEW'" class="why">
            {{ s.provider === 'manual' ? 'ยังไม่ได้เชื่อมระบบตรวจสลิปอัตโนมัติ' : 'ธนาคารยังตอบไม่ได้ในตอนนั้น' }} · ตรวจยอดเข้าในแอปธนาคารก่อนอนุมัติ
          </p>
          <div v-if="s.status === 'NEEDS_REVIEW' && auth.can('bookings:write')" class="act">
            <input v-if="!s.slip.transRef" v-model="refs[s.id]" type="text" inputmode="text" maxlength="64" placeholder="เลขอ้างอิงจากสลิป (ไม่บังคับ)" aria-label="เลขอ้างอิงจากสลิป" />
            <button type="button" class="ok" :disabled="busyId === s.id" @click="decide(s, 'approve')"><Icon name="check" :size="14" /> ได้รับเงินแล้ว</button>
            <button type="button" class="no" :disabled="busyId === s.id" @click="decide(s, 'reject')"><Icon name="x" :size="14" /> ไม่ผ่าน</button>
          </div>
        </div>
      </li>
    </ul>
    <p v-else-if="!loading" class="empty">{{ tab === 'NEEDS_REVIEW' ? 'ไม่มีสลิปรอตรวจ สลิปที่ธนาคารยืนยันได้จะผ่านอัตโนมัติ' : 'ยังไม่มีรายการ' }}</p>
  </div>
</template>

<style scoped>
.slips {
  display: grid;
  gap: 14px;
}
.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.tabs button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px solid var(--viz-border);
  border-radius: 999px;
  background: var(--viz-surface);
  -webkit-backdrop-filter: var(--viz-glass);
  backdrop-filter: var(--viz-glass);
  color: var(--viz-text);
  font-size: 0.85rem;
  cursor: pointer;
}
.tabs button span {
  min-width: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
  font-size: 0.72rem;
  font-weight: 700;
  text-align: center;
}
.tabs button.on {
  background: var(--viz-cream);
  border-color: var(--viz-cream);
  color: #15171e;
  font-weight: 600;
}
.list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.slip {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 16px;
  padding: 16px;
  border: 1px solid var(--viz-border);
  border-radius: 18px;
  background: var(--viz-surface);
  -webkit-backdrop-filter: var(--viz-glass);
  backdrop-filter: var(--viz-glass);
}
.img {
  display: grid;
  place-items: center;
  align-self: start;
  overflow: hidden;
  border-radius: 12px;
  background: rgb(255 255 255 / 0.06);
  aspect-ratio: 3 / 4;
}
.img img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top;
}
.ph {
  color: var(--viz-muted);
}
.info {
  display: grid;
  align-content: start;
  gap: 10px;
  min-width: 0;
}
.top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.pill {
  padding: 2px 10px;
  border-radius: 999px;
  background: rgb(91 157 255 / 0.18);
  color: #9cc4ff;
  font-size: 0.75rem;
}
.pill.bad {
  background: rgb(255 120 110 / 0.18);
  color: #ff8a82;
}
.amt {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}
dl {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px 16px;
  margin: 0;
  font-size: 0.86rem;
}
dl div {
  display: grid;
  gap: 2px;
}
dt {
  color: var(--viz-muted);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.mono {
  font-family: ui-monospace, monospace;
}
.mismatch {
  color: #ff8a82;
  font-weight: 700;
}
.why {
  margin: 0;
  color: #ffd29a;
  font-size: 0.8rem;
}
.act {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px dashed var(--viz-border);
}
.act input {
  flex: 1 1 200px;
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid var(--viz-border);
  border-radius: 10px;
  background: rgb(255 255 255 / 0.06);
  color: var(--viz-text);
  font: inherit;
}
.act button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 40px;
  padding: 0 14px;
  border-radius: 10px;
  font-weight: 600;
  font-size: 0.85rem;
  cursor: pointer;
}
.act .ok {
  border: 0;
  background: #5fd39a;
  color: #0b2a1c;
}
.act .no {
  border: 1px solid var(--viz-border);
  background: transparent;
  color: var(--viz-text);
}
.act button:disabled {
  opacity: 0.6;
}
.err {
  color: #ff8a82;
}
.empty {
  padding: 32px 16px;
  color: var(--viz-muted);
  text-align: center;
}
@media (max-width: 640px) {
  .slip {
    grid-template-columns: 1fr;
  }
  .img {
    max-height: 260px;
    aspect-ratio: auto;
  }
}
</style>
