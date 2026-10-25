<script setup>
import { computed } from 'vue'
import { distanceKm, fmtKm } from '@/utils/geo'
import Icon from '@/components/ui/Icon.vue'

// Delivery staff beside the map: who is free, who has jobs, who is on the road,
// how far each one is from the selected drop-off, and a one-click assign.
// Positions come from the last time each person opened the site or pressed a job button.
const props = defineProps({
  staff: { type: Array, default: () => [] },
  job: { type: Object, default: null },
  canAssign: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
})
const emit = defineEmits(['assign'])


const TZ = 'Asia/Bangkok'
const clock = (iso) => new Date(iso).toLocaleTimeString('th-TH', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
const assignable = computed(() => props.job?.fulfillment === 'DELIVERY' && ['CONFIRMED', 'PREPARING', 'READY'].includes(props.job.status))
const people = computed(() =>
  props.staff
    .map((s) => {
      const state = s.onTheRoad
        ? ['กำลังส่งรถ', 'road']
        : s.jobs.length
          ? [`มีงาน ${s.jobs.length} · ${s.jobs.map((a) => clock(a.scheduledAt)).join(', ')}`, 'busy']
          : ['ว่าง', 'free']
      return { ...s, state, km: distanceKm(s.location, props.job?.destination) }
    })
    .sort((a, b) => (b.state[1] === 'free') - (a.state[1] === 'free') || (a.km ?? 1e9) - (b.km ?? 1e9)),
)
const free = computed(() => people.value.filter((p) => p.state[1] === 'free').length)
const initials = (n) =>
  String(n ?? '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
</script>

<template>
  <section class="drivers">
    <header>
      <h3>พนักงานส่งรถ</h3>
      <span class="count">ว่าง {{ free }}/{{ staff.length }}</span>
    </header>
    <p class="note"><Icon name="navigation" :size="12" /> ตำแหน่งอัปเดตเมื่อพนักงานเข้าเว็บ หรือกดสถานะงาน</p>
    <ul>
      <li v-for="p in people" :key="p.id" :class="{ current: job?.driver?.staffId === p.id }">
        <span class="av" :class="p.state[1]">{{ initials(p.name) }}</span>
        <span class="who">
          <strong>{{ p.name }}</strong>
          <small>{{ job?.driver?.staffId === p.id ? 'คนส่งคันนี้' : p.state[0] }}</small>
          <small class="loc">
            <Icon name="navigation" :size="10" />
            {{ p.location ? (job ? `ห่างจุดหมาย ${fmtKm(p.km)}` : 'แชร์ตำแหน่งแล้ว') : 'ยังไม่แชร์ตำแหน่ง' }}
          </small>
        </span>
        <button
          v-if="canAssign && assignable && job.driver?.staffId !== p.id"
          type="button"
          class="assign"
          :disabled="busy"
          @click="emit('assign', { bookingId: job.id, staffId: p.id })"
        >
          มอบหมาย
        </button>
        <Icon v-else-if="job?.driver?.staffId === p.id" name="check" :size="16" class="tick" />
      </li>
      <li v-if="!people.length" class="empty">ยังไม่มีพนักงานในระบบ</li>
    </ul>
  </section>
</template>

<style scoped>
.drivers {
  display: grid;
  grid-template-rows: auto auto 1fr;
  gap: 10px;
  min-height: 0;
  padding: 16px;
  border: 1px solid var(--viz-border);
  border-radius: 22px;
  background: rgb(22 26 38 / 0.72);
  -webkit-backdrop-filter: var(--viz-glass);
  backdrop-filter: var(--viz-glass);
}
header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
h3 {
  font-family: var(--font-body);
  font-size: 0.98rem;
  font-weight: 600;
  letter-spacing: 0;
}
.count {
  color: var(--viz-muted);
  font-size: 0.76rem;
}
.note {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--viz-muted);
  font-size: 0.72rem;
}
ul {
  display: grid;
  align-content: start;
  gap: 4px;
  min-height: 0;
  overflow: auto;
  margin: 0;
  padding: 0;
  list-style: none;
}
li {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-radius: 14px;
}
li:hover {
  background: var(--viz-hover);
}
li.current {
  background: rgb(61 139 255 / 0.18);
}
.av {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: #2f8f62;
  font-size: 0.72rem;
  font-weight: 700;
}
.av.busy {
  background: #9a6a1c;
}
.av.road {
  background: #2a64c4;
}
.who {
  display: grid;
  min-width: 0;
}
.who strong {
  font-size: 0.85rem;
  font-weight: 600;
}
.who small {
  overflow: hidden;
  color: var(--viz-muted);
  font-size: 0.72rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.loc {
  display: flex;
  align-items: center;
  gap: 4px;
}
.assign {
  padding: 6px 10px;
  border: 1px solid rgb(61 139 255 / 0.6);
  border-radius: 10px;
  background: rgb(61 139 255 / 0.15);
  color: #cfe0ff;
  font: inherit;
  font-size: 0.74rem;
  font-weight: 600;
  cursor: pointer;
}
.assign:disabled {
  opacity: 0.5;
}
.tick {
  color: var(--ok);
}
.empty {
  display: block;
  color: var(--viz-muted);
  text-align: center;
}
</style>
