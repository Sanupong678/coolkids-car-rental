<script setup>
import { computed, ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'

// Left column of the dispatch board: the chosen day's hand-overs, searchable,
// with day stepping. Picking a row selects that job on the map.
const props = defineProps({
  date: { type: String, required: true },
  jobs: { type: Array, default: () => [] },
  selectedId: { type: String, default: null },
})
const emit = defineEmits(['select', 'update:date'])

const TZ = 'Asia/Bangkok'
const q = ref('')
const clock = (iso) => new Date(iso).toLocaleTimeString('th-TH', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
const dayLabel = computed(() => new Date(`${props.date}T00:00:00`).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))
const shown = computed(() => {
  const s = q.value.trim().toLowerCase()
  if (!s) return props.jobs
  return props.jobs.filter((j) => [j.number, j.vehicle.plate, j.customer.fullName, j.destination?.address].some((v) => v?.toLowerCase().includes(s)))
})
function step(n) {
  const d = new Date(`${props.date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  emit('update:date', d.toISOString().slice(0, 10))
}
const STATE = { CONFIRMED: 'new', PREPARING: 'info', READY: 'info', IN_DELIVERY: 'go', ACTIVE: 'ok', COMPLETED: 'ok' }
</script>

<template>
  <section class="orders">
    <header>
      <h3>รายการส่งรถ <b class="n">{{ jobs.length }}</b></h3>
      <div class="day">
        <button type="button" aria-label="วันก่อน" @click="step(-1)"><Icon name="chevron-left" :size="15" /></button>
        <span>{{ dayLabel }}</span>
        <button type="button" aria-label="วันถัดไป" @click="step(1)"><Icon name="chevron-right" :size="15" /></button>
      </div>
    </header>
    <label class="search">
      <Icon name="search" :size="15" />
      <input v-model="q" type="search" placeholder="ค้นหาเลขจอง / ทะเบียน / ลูกค้า" />
    </label>
    <div class="head" aria-hidden="true"><span>เวลา</span><span>รถ</span><span>ปลายทาง</span></div>
    <ul>
      <li v-for="j in shown" :key="j.id">
        <button type="button" :class="{ on: j.id === selectedId, done: j.delivered }" :aria-pressed="j.id === selectedId" @click="emit('select', j.id)">
          <span class="t"><i class="dot" :class="STATE[j.status]" />{{ clock(j.pickupAt) }}</span>
          <span class="car">{{ j.vehicle.plate }}<small>{{ j.vehicle.model }}</small></span>
          <span class="to">
            {{ j.fulfillment === 'DELIVERY' ? j.destination.address : 'รับที่สาขา' }}
            <small>{{ j.driver?.name ?? (j.fulfillment === 'DELIVERY' ? 'ยังไม่มีคนรับงาน' : j.customer.fullName) }}</small>
          </span>
        </button>
      </li>
      <li v-if="!shown.length" class="empty">{{ jobs.length ? 'ไม่พบรายการ' : 'ไม่มีงานส่งรถในวันนี้' }}</li>
    </ul>
  </section>
</template>

<style scoped>
.orders {
  display: grid;
  grid-template-rows: auto auto auto 1fr;
  gap: 12px;
  min-height: 0;
  padding: 18px;
  border: 1px solid var(--viz-border);
  border-radius: 24px;
  background: rgb(22 26 38 / 0.72);
  -webkit-backdrop-filter: var(--viz-glass);
  backdrop-filter: var(--viz-glass);
}
header {
  display: grid;
  gap: 10px;
}
h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-body);
  font-size: 1.02rem;
  font-weight: 600;
  letter-spacing: 0;
}
.n {
  display: grid;
  place-items: center;
  min-width: 26px;
  height: 26px;
  padding: 0 7px;
  border-radius: 999px;
  background: var(--viz-glow);
  font-size: 0.75rem;
  box-shadow: 0 0 14px rgb(61 139 255 / 0.6);
}
.day {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px;
  border: 1px solid var(--viz-border);
  border-radius: 999px;
  font-size: 0.82rem;
}
.day button {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 50%;
  background: none;
  color: var(--viz-text);
  cursor: pointer;
}
.day button:hover {
  background: var(--viz-hover);
}
.search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 42px;
  padding: 0 14px;
  border: 1px solid var(--viz-border);
  border-radius: 14px;
  background: rgb(255 255 255 / 0.04);
  color: var(--viz-muted);
}
.search input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: none;
  outline: 0;
  font: inherit;
  font-size: 0.85rem;
}
.head,
li button {
  display: grid;
  grid-template-columns: 64px 84px minmax(0, 1fr);
  gap: 8px;
}
.head {
  padding: 0 10px;
  color: var(--viz-muted);
  font-size: 0.72rem;
}
ul {
  display: grid;
  align-content: start;
  gap: 2px;
  min-height: 0;
  overflow: auto;
  margin: 0;
  padding: 0;
  list-style: none;
}
li button {
  width: 100%;
  padding: 12px 10px;
  border: 0;
  border-bottom: 1px solid var(--viz-grid);
  border-radius: 12px;
  background: none;
  color: var(--viz-text);
  font: inherit;
  font-size: 0.84rem;
  text-align: left;
  cursor: pointer;
}
li button:hover {
  background: var(--viz-hover);
}
li button.on {
  border-color: transparent;
  background: rgb(61 139 255 / 0.2);
  box-shadow: inset 0 0 0 1px rgb(61 139 255 / 0.5);
}
li button.done {
  color: var(--viz-muted);
}
.t {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--viz-muted);
}
.dot.new {
  background: var(--bad);
}
.dot.info {
  background: var(--series-1);
}
.dot.go {
  background: var(--warn);
}
.dot.ok {
  background: var(--ok);
}
.car,
.to {
  display: grid;
  min-width: 0;
}
.car small,
.to small {
  overflow: hidden;
  color: var(--viz-muted);
  font-size: 0.7rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.to {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 560px) {
  .orders {
    padding: 14px;
    border-radius: 18px;
  }
  .head,
  li button {
    grid-template-columns: 56px 72px minmax(0, 1fr);
  }
}
.empty {
  padding: 30px 8px;
  color: var(--viz-muted);
  text-align: center;
  font-size: 0.85rem;
}
</style>
