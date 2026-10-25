<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { listApprovals, reviewBooking } from '@/api/admin'
import { documentUrl } from '@/api/bookings'
import { useAuthStore } from '@/stores/auth'
import { money } from '@/utils/format'
import Icon from '@/components/ui/Icon.vue'

// LINE bookings waiting for staff: everything the customer sent (details, ID /
// licence photos of both drivers, stay location, reference, Facebook / IG).
// อนุมัติ → the customer gets the QR for the reservation fee on LINE.
// ขอแก้ไข → the customer is told what to fix and sends again.
const auth = useAuthStore()
const rows = ref([])
const loading = ref(true)
const busyId = ref(null)
const error = ref('')
const photos = ref({}) // `${number}:${kind}` → object URL
let timer

const TZ = 'Asia/Bangkok'
const time = (iso) => new Date(iso).toLocaleString('th-TH', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const STATE = { SUBMITTED: ['รอตรวจ', 'new'], APPROVED: ['อนุมัติแล้ว · รอโอน', 'ok'], CHANGES_REQUESTED: ['รอลูกค้าแก้ไข', 'warn'] }
const LABEL = {
  id_front: 'บัตร / พาสปอร์ต (หน้า)', id_back: 'บัตร (หลัง)', license_front: 'ใบขับขี่',
  driver2_id: 'บัตร ผู้ขับ 2', driver2_license: 'ใบขับขี่ ผู้ขับ 2', reference: 'เอกสารอ้างอิง',
}
const waiting = computed(() => rows.value.filter((b) => b.review.status === 'SUBMITTED').length)
// The booking form appends "· https://maps.google.com/?q=lat,lng" when the customer drops a pin.
const MAP_LINK = /\s*·?\s*https:\/\/maps\.google\.com\/\?q=[-\d.]+,[-\d.]+/
const socialHref = (s) => (/^https?:\/\//.test(s) ? s : /\./.test(s) ? `https://${s}` : null)

async function loadPhotos(b) {
  for (const [kind, has] of Object.entries(b.documents?.uploaded ?? {})) {
    const key = `${b.number}:${kind}`
    if (!has || photos.value[key]) continue
    const res = await fetch(documentUrl(b.number, kind), { credentials: 'include' })
    if (res.ok) photos.value = { ...photos.value, [key]: URL.createObjectURL(await res.blob()) }
  }
}

async function load() {
  error.value = ''
  try {
    rows.value = await listApprovals()
    rows.value.forEach(loadPhotos)
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

async function decide(b, decision) {
  let note
  if (decision === 'request_changes') {
    note = window.prompt(`แจ้งลูกค้า ${b.customer.fullName ?? ''} ว่าต้องแก้ไขอะไร`, 'รูปใบขับขี่ไม่ชัด กรุณาถ่ายใหม่')
    if (!note?.trim()) return
  } else if (!window.confirm(`อนุมัติ ${b.number}? ลูกค้าจะได้รับ QR โอนค่าจอง ${money(b.money.dueNowMinor, b.money.currency)} ทาง LINE`)) {
    return
  }
  busyId.value = b.id
  error.value = ''
  try {
    await reviewBooking(b.id, { decision, note: note?.trim() })
    await load()
  } catch (err) {
    error.value = err.message
  } finally {
    busyId.value = null
  }
}

// ?booking=COOL-… (the "ตรวจเอกสาร" button on the dispatch board) scrolls to that booking.
const route = useRoute()
const focus = ref(null)
watch([() => route.query.booking, rows], async ([n]) => {
  if (!n || n === focus.value || !rows.value.some((b) => b.number === n)) return
  focus.value = n
  await nextTick()
  document.getElementById(`ap-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
})

onMounted(() => {
  load()
  timer = setInterval(load, 30_000)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  Object.values(photos.value).forEach((u) => URL.revokeObjectURL(u))
})
</script>

<template>
  <div class="ap">
    <p class="intro">
      การจองจาก LINE ที่ลูกค้าส่งข้อมูลแล้ว <b>{{ waiting }}</b> รายการรอตรวจ · อนุมัติแล้วลูกค้าจะได้ QR โอนค่าจองทาง LINE · สลิปที่โอนแล้วอยู่ในแท็บ "ตรวจสลิป"
    </p>
    <p v-if="error" class="err" role="alert">{{ error }}</p>
    <div v-if="loading" class="empty">กำลังโหลด…</div>
    <p v-else-if="!rows.length" class="empty">ยังไม่มีการจองรอตรวจ</p>

    <ul v-else class="list">
      <li v-for="b in rows" :id="`ap-${b.number}`" :key="b.id" class="item" :class="{ focus: focus === b.number }">
        <div class="top">
          <span class="pill" :class="STATE[b.review.status]?.[1]">{{ STATE[b.review.status]?.[0] }}</span>
          <strong>{{ b.number }}</strong>
          <span class="muted">ส่งเมื่อ {{ b.review.submittedAt ? time(b.review.submittedAt) : '—' }} · ล็อกรถถึง {{ time(b.holdExpiresAt) }}</span>
          <b class="amt">{{ money(b.money.totalMinor, b.money.currency) }}</b>
        </div>

        <dl>
          <div><dt>รถ</dt><dd>{{ b.vehicle.brand }} {{ b.vehicle.model }} · {{ b.vehicle.plate }}</dd></div>
          <div><dt>รับ → คืน</dt><dd>{{ time(b.pickupAt) }} → {{ time(b.returnAt) }} ({{ b.rentalDays }} วัน)</dd></div>
          <div><dt>ลูกค้า</dt><dd>{{ b.customer.fullName ?? '—' }} · <a v-if="b.customer.phone" :href="`tel:${b.customer.phone}`">{{ b.customer.phone }}</a></dd></div>
          <div v-if="b.details.socialUrl">
            <dt>Facebook / IG</dt>
            <dd><a v-if="socialHref(b.details.socialUrl)" :href="socialHref(b.details.socialUrl)" target="_blank" rel="noopener noreferrer">{{ b.details.socialUrl }}</a><template v-else>{{ b.details.socialUrl }}</template></dd>
          </div>
          <div><dt>สถานที่ใช้รถ</dt><dd>{{ b.details.areaOfUse ?? '—' }}</dd></div>
          <div>
            <dt>ที่พัก / โลเคชั่น</dt>
            <dd>
              {{ b.details.stayLocation?.replace(MAP_LINK, '').trim() || '—' }}
              <a v-if="b.details.stayLocation?.match(MAP_LINK)" :href="b.details.stayLocation.match(MAP_LINK)[0]" target="_blank" rel="noopener noreferrer">เปิดหมุดใน Google Maps</a>
            </dd>
          </div>
          <div><dt>รับรถ</dt><dd>{{ b.fulfillment === 'DELIVERY' ? `ส่งถึงที่: ${b.delivery?.address}` : `ที่สาขา ${b.branch}` }}</dd></div>
          <div><dt>ค่าจอง</dt><dd>{{ money(b.money.dueNowMinor, b.money.currency) }} · ชำระวันรับรถ {{ money(b.money.payAtPickupMinor, b.money.currency) }}</dd></div>
          <div v-if="b.notes"><dt>หมายเหตุ</dt><dd>{{ b.notes }}</dd></div>
          <div v-if="b.review.note"><dt>ข้อความถึงลูกค้า</dt><dd>{{ b.review.note }}</dd></div>
        </dl>

        <div class="docs">
          <template v-for="(has, kind) in b.documents?.uploaded" :key="kind">
            <a v-if="has && photos[`${b.number}:${kind}`]" :href="photos[`${b.number}:${kind}`]" target="_blank" rel="noopener" class="doc">
              <img :src="photos[`${b.number}:${kind}`]" :alt="LABEL[kind]" />
              <small>{{ LABEL[kind] }}</small>
            </a>
            <span v-else-if="b.documents.required.includes(kind)" class="doc missing"><Icon name="camera" :size="18" /><small>ไม่มี{{ LABEL[kind] }}</small></span>
          </template>
        </div>

        <div v-if="b.review.status === 'SUBMITTED' && auth.can('bookings:write')" class="act">
          <button type="button" class="ok" :disabled="busyId === b.id" @click="decide(b, 'approve')"><Icon name="check" :size="14" /> อนุมัติ · ส่ง QR ค่าจอง</button>
          <button type="button" class="no" :disabled="busyId === b.id" @click="decide(b, 'request_changes')">ขอแก้ไข / ขอเอกสารเพิ่ม</button>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.ap {
  display: grid;
  gap: 14px;
}
.intro {
  color: var(--viz-muted);
  font-size: 0.85rem;
}
.list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.item {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--viz-border);
  border-radius: 18px;
  background: var(--viz-surface);
  -webkit-backdrop-filter: var(--viz-glass);
  backdrop-filter: var(--viz-glass);
}
.item.focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent);
}
.top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.muted {
  color: var(--viz-muted);
  font-size: 0.8rem;
}
.amt {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}
.pill {
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 0.75rem;
  background: rgb(91 157 255 / 0.18);
  color: #9cc4ff;
}
.pill.ok {
  background: rgb(95 211 154 / 0.18);
  color: #8fe5b8;
}
.pill.warn {
  background: rgb(255 181 71 / 0.18);
  color: #ffd29a;
}
dl {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
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
dd a {
  color: #ff8a82;
}
.docs {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.doc {
  display: grid;
  gap: 4px;
  width: 128px;
  color: inherit;
  text-decoration: none;
}
.doc img {
  width: 128px;
  height: 88px;
  object-fit: cover;
  border-radius: 10px;
  background: rgb(255 255 255 / 0.06);
}
.doc small {
  color: var(--viz-muted);
  font-size: 0.72rem;
}
.doc.missing {
  place-items: center;
  height: 88px;
  border: 1px dashed #ff8a82;
  border-radius: 10px;
  color: #ff8a82;
}
.act {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px dashed var(--viz-border);
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
</style>
