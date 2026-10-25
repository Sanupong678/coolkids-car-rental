<script setup>
import { computed } from 'vue'
import { distanceKm, fmtKm } from '@/utils/geo'
import Icon from '@/components/ui/Icon.vue'
import PrintContractButton from '@/components/admin/PrintContractButton.vue'

// The selected job: distance, branch → customer route, and who is driving it.
// Until a driver presses "รับงานนี้" the card says nobody has taken it yet.
const props = defineProps({
  job: { type: Object, required: true },
  canAccept: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
})
const emit = defineEmits(['accept', 'act'])

const TZ = 'Asia/Bangkok'
const clock = (iso) => new Date(iso).toLocaleTimeString('th-TH', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
const isDelivery = computed(() => props.job.fulfillment === 'DELIVERY')
const km = computed(() =>
  props.job.destination?.distanceMeters != null ? props.job.destination.distanceMeters / 1000 : distanceKm(props.job.branch, props.job.destination),
)
const ON_ROAD = { VEHICLE_PICKED_UP: 'รับรถจากสาขาแล้ว', EN_ROUTE: 'กำลังส่งรถ', ARRIVING: 'ใกล้ถึงแล้ว', ASSIGNED: 'รับงานแล้ว' }
const driverNote = computed(() => {
  const d = props.job.driver
  if (!d) return ''
  if (props.job.delivered) return 'ส่งมอบรถเรียบร้อย'
  return `${ON_ROAD[d.assignmentStatus] ?? 'รับงานแล้ว'}${d.assignedAt ? ` · ${clock(d.assignedAt)}` : ''}`
})
const initials = (n) =>
  String(n ?? '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

// One next step; the button disappears once the car has been handed over.
const next = computed(() => {
  const j = props.job
  if (j.status === 'CONFIRMED') return ['PREPARING', 'เตรียมเอกสาร']
  if (j.status === 'PREPARING') return isDelivery.value ? ['IN_DELIVERY', 'ออกส่งรถ'] : ['READY', 'รถพร้อมให้รับ']
  if (j.status === 'IN_DELIVERY' || j.status === 'READY') return ['ACTIVE', 'ส่งมอบแล้ว']
  return null
})
</script>

<template>
  <article class="card">
    <header>
      <span class="badge"><Icon name="car" :size="20" /></span>
      <div>
        <strong>#{{ job.number }}</strong>
        <small>{{ job.vehicle.plate }} • {{ job.vehicle.brand }} {{ job.vehicle.model }}</small>
      </div>
      <PrintContractButton :booking-id="job.id" compact />
    </header>

    <div class="route">
      <div class="dist">
        <small>{{ isDelivery ? 'ระยะทาง' : 'รับที่สาขา' }}</small>
        <b>{{ isDelivery ? fmtKm(km) : clock(job.pickupAt) }}</b>
      </div>
      <ol class="line">
        <li class="from">
          <span>{{ job.branch.name }}</span>
          <small>รับ {{ clock(job.pickupAt) }}</small>
        </li>
        <li v-if="isDelivery" class="to">
          <span>{{ job.customer.fullName ?? 'ลูกค้า' }}</span>
          <small>{{ job.destination.address }}</small>
        </li>
      </ol>
    </div>

    <div class="who" :class="{ empty: !job.driver }">
      <template v-if="job.driver">
        <span class="av"><img v-if="job.driver.avatarUrl" :src="job.driver.avatarUrl" alt="" />{{ job.driver.avatarUrl ? '' : initials(job.driver.name) }}</span>
        <span class="name">
          <strong>{{ job.driver.name }}</strong>
          <small>{{ driverNote }}</small>
        </span>
        <a v-if="job.driver.phone" class="call" :href="`tel:${job.driver.phone}`" :aria-label="`โทรหา ${job.driver.name}`"><Icon name="phone" :size="18" /></a>
      </template>
      <template v-else-if="isDelivery">
        <span class="av ghost"><Icon name="user" :size="18" /></span>
        <span class="name">
          <strong>ยังไม่มีคนรับงาน</strong>
          <small>คนส่งรถกด “รับงานนี้” หรือมอบหมายจากรายชื่อด้านบน</small>
        </span>
        <button v-if="canAccept" type="button" class="accept" :disabled="busy" @click="emit('accept', job)">รับงานนี้</button>
      </template>
      <template v-else>
        <span class="av ghost"><Icon name="pin" :size="18" /></span>
        <span class="name">
          <strong>ลูกค้ารับรถเองที่สาขา</strong>
          <small>{{ job.customer.fullName }} · {{ job.customer.phone }}</small>
        </span>
        <a v-if="job.customer.phone" class="call" :href="`tel:${job.customer.phone}`" aria-label="โทรหาลูกค้า"><Icon name="phone" :size="18" /></a>
      </template>
    </div>

    <button v-if="next" type="button" class="step" :disabled="busy" @click="emit('act', { job, status: next[0] })">
      {{ next[1] }} <Icon name="arrow-right" :size="14" />
    </button>
  </article>
</template>

<style scoped>
.card {
  display: grid;
  gap: 14px;
  padding: 18px;
  border: 1px solid var(--viz-border);
  border-radius: 24px;
  background: rgb(22 26 38 / 0.82);
  -webkit-backdrop-filter: var(--viz-glass);
  backdrop-filter: var(--viz-glass);
  box-shadow: 0 20px 50px -24px rgb(0 0 0 / 0.8);
}
header {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 12px;
}
.badge {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  border: 1px solid var(--viz-border);
  border-radius: 14px;
}
header strong {
  display: block;
  font-size: 1rem;
  font-weight: 600;
}
header small {
  color: var(--viz-muted);
  font-size: 0.78rem;
}
.route {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 18px;
  align-items: start;
}
.dist small {
  display: block;
  color: var(--viz-muted);
  font-size: 0.8rem;
}
.dist b {
  font-size: 1.9rem;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.line {
  display: grid;
  gap: 14px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.line li {
  position: relative;
  display: grid;
  padding-left: 28px;
  min-width: 0;
}
.line li::before {
  content: '';
  position: absolute;
  top: 3px;
  left: 0;
  width: 16px;
  height: 16px;
  border: 2px solid #fff;
  border-radius: 50%;
}
.line .from::before {
  border-color: var(--viz-glow);
  background: var(--viz-glow);
}
.line .from:not(:last-child)::after {
  content: '';
  position: absolute;
  top: 21px;
  bottom: -13px;
  left: 8px;
  width: 2px;
  background: linear-gradient(var(--viz-glow), #fff);
}
.line span {
  font-weight: 600;
  font-size: 0.9rem;
}
.line small {
  overflow: hidden;
  color: var(--viz-muted);
  font-size: 0.76rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.who {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border: 1px solid var(--viz-border);
  border-radius: 18px;
  background: rgb(255 255 255 / 0.05);
}
.av {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  overflow: hidden;
  border-radius: 50%;
  background: #2a64c4;
  font-weight: 700;
  font-size: 0.85rem;
}
.av img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.av.ghost {
  background: rgb(255 255 255 / 0.08);
  color: var(--viz-muted);
}
.name {
  display: grid;
  min-width: 0;
}
.name strong {
  font-weight: 600;
}
.name small {
  color: var(--viz-muted);
  font-size: 0.76rem;
}
.call {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: #3fbf7a;
  color: #fff;
  box-shadow: 0 0 22px rgb(63 191 122 / 0.55);
}
@media (max-width: 560px) {
  .card {
    padding: 14px;
    border-radius: 18px;
  }
  .route {
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .dist b {
    font-size: 1.5rem;
  }
}
.accept,
.step {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 14px;
  border: 0;
  border-radius: 12px;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.accept {
  background: var(--viz-glow);
  color: #fff;
  box-shadow: 0 0 20px rgb(61 139 255 / 0.5);
}
.step {
  background: var(--viz-cream);
  color: #15171e;
}
.accept:disabled,
.step:disabled {
  opacity: 0.5;
}
</style>
