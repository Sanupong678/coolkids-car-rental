<script setup>
import { computed } from 'vue'
import Icon from '@/components/ui/Icon.vue'

// Month grid of car hand-overs (Mon-first, Bangkok days). Each day lists its
// jobs as time · plate chips; picking a day opens that day's planner.
const props = defineProps({
  month: { type: String, required: true }, // 'YYYY-MM'
  days: { type: Object, default: () => ({}) }, // { 'YYYY-MM-DD': [job] }
  selected: { type: String, default: null },
  today: { type: String, required: true },
  loading: { type: Boolean, default: false },
})
const emit = defineEmits(['update:month', 'select'])

const TZ = 'Asia/Bangkok'
const WEEK = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.']
const MAX_CHIPS = 3

const title = computed(() =>
  new Date(`${props.month}-01T00:00:00`).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' }),
)
const pad = (n) => String(n).padStart(2, '0')
const cells = computed(() => {
  const [y, m] = props.month.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1))
  const lead = (first.getUTCDay() + 6) % 7 // Monday-first
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const out = Array.from({ length: lead }, () => null)
  for (let d = 1; d <= count; d++) out.push(`${props.month}-${pad(d)}`)
  while (out.length % 7) out.push(null)
  return out
})

function shift(n) {
  const [y, m] = props.month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  emit('update:month', `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`)
}
const goToday = () => {
  emit('update:month', props.today.slice(0, 7))
  emit('select', props.today)
}

const clock = (iso) => new Date(iso).toLocaleTimeString('th-TH', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
const jobsOf = (day) => props.days[day] ?? []
const openCount = (day) => jobsOf(day).filter((j) => !j.delivered).length
const monthTotal = computed(() => Object.values(props.days).reduce((n, list) => n + list.length, 0))
</script>

<template>
  <section class="cal" :aria-busy="loading">
    <header>
      <div class="ttl">
        <h3>ปฏิทินส่งรถ · {{ title }}</h3>
        <small>{{ monthTotal }} งานในเดือนนี้ · กดวันที่เพื่อดูเวลาและมอบหมายคนส่ง</small>
      </div>
      <div class="nav">
        <button type="button" aria-label="เดือนก่อน" @click="shift(-1)"><Icon name="chevron-left" :size="16" /></button>
        <button type="button" class="today" @click="goToday">วันนี้</button>
        <button type="button" aria-label="เดือนถัดไป" @click="shift(1)"><Icon name="chevron-right" :size="16" /></button>
      </div>
    </header>

    <div class="grid" role="grid">
      <div v-for="w in WEEK" :key="w" class="wd" role="columnheader">{{ w }}</div>
      <template v-for="(day, i) in cells" :key="day ?? `pad-${i}`">
        <div v-if="!day" class="cell pad" aria-hidden="true" />
        <button
          v-else
          type="button"
          class="cell"
          :class="{ today: day === today, sel: day === selected, has: jobsOf(day).length, past: day < today }"
          :aria-pressed="day === selected"
          :aria-label="`${Number(day.slice(8))} — ${jobsOf(day).length} งาน`"
          @click="emit('select', day)"
        >
          <span class="num">
            {{ Number(day.slice(8)) }}
            <b v-if="openCount(day)" class="badge">{{ openCount(day) }}</b>
          </span>
          <span v-for="j in jobsOf(day).slice(0, MAX_CHIPS)" :key="j.id" class="chip" :class="{ done: j.delivered, branch: j.fulfillment !== 'DELIVERY' }">
            {{ clock(j.pickupAt) }} · {{ j.vehicle.plate }}
          </span>
          <span v-if="jobsOf(day).length > MAX_CHIPS" class="more">+{{ jobsOf(day).length - MAX_CHIPS }} งาน</span>
        </button>
      </template>
    </div>
    <p class="legend">
      <span><i class="dot del" /> ส่งถึงที่</span>
      <span><i class="dot br" /> รับที่สาขา</span>
      <span><i class="dot dn" /> ส่งมอบแล้ว</span>
    </p>
  </section>
</template>

<style scoped>
.cal {
  display: grid;
  gap: 12px;
  padding: 18px;
  border: 1px solid var(--viz-border);
  border-radius: 20px;
  background: var(--viz-surface);
  -webkit-backdrop-filter: var(--viz-glass);
  backdrop-filter: var(--viz-glass);
}
header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-end;
  gap: 10px;
}
h3 {
  font-family: var(--font-body);
  font-size: 1.05rem;
  font-weight: 600;
  letter-spacing: 0;
}
small {
  color: var(--viz-muted);
  font-size: 0.78rem;
}
.nav {
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--viz-border);
  border-radius: 999px;
  background: rgb(255 255 255 / 0.04);
}
.nav button {
  display: grid;
  place-items: center;
  min-width: 32px;
  height: 30px;
  padding: 0 8px;
  border: 0;
  border-radius: 999px;
  background: none;
  color: var(--viz-text);
  font-size: 0.8rem;
  cursor: pointer;
}
.nav button:hover {
  background: var(--viz-hover);
}
.nav .today {
  padding: 0 12px;
  background: var(--viz-surface-strong);
}
.grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  border-top: 1px solid var(--viz-grid);
  border-left: 1px solid var(--viz-grid);
  border-radius: 12px;
  overflow: hidden;
}
.wd {
  padding: 8px;
  border-right: 1px solid var(--viz-grid);
  border-bottom: 1px solid var(--viz-grid);
  color: var(--viz-muted);
  font-size: 0.75rem;
  text-align: center;
  background: rgb(255 255 255 / 0.03);
}
.cell {
  display: grid;
  align-content: start;
  gap: 4px;
  min-height: 104px;
  padding: 6px;
  border: 0;
  border-right: 1px solid var(--viz-grid);
  border-bottom: 1px solid var(--viz-grid);
  background: none;
  color: var(--viz-text);
  text-align: left;
  font: inherit;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}
.cell.pad {
  cursor: default;
  background: rgb(0 0 0 / 0.08);
}
.cell:not(.pad):hover {
  background: var(--viz-hover);
}
.cell.past .num {
  opacity: 0.55;
}
.cell.today {
  background: rgb(91 157 255 / 0.1);
}
.cell.today .num {
  color: #9cc4ff;
  opacity: 1;
}
.cell.sel {
  background: rgb(91 157 255 / 0.2);
  box-shadow: inset 0 0 0 2px var(--series-1);
}
.num {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
}
.badge {
  min-width: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
  font-size: 0.68rem;
  text-align: center;
}
.chip {
  overflow: hidden;
  padding: 3px 6px;
  border-left: 3px solid var(--warn);
  border-radius: 6px;
  background: rgb(255 255 255 / 0.1);
  color: var(--viz-text);
  font-size: 0.7rem;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-variant-numeric: tabular-nums;
}
.chip.branch {
  border-left-color: var(--series-1);
}
.chip.done {
  border-left-color: var(--ok);
  color: var(--viz-muted);
}
.more {
  color: var(--viz-muted);
  font-size: 0.68rem;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  color: var(--viz-muted);
  font-size: 0.75rem;
}
.legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 3px;
}
.dot.del {
  background: var(--warn);
}
.dot.br {
  background: var(--series-1);
}
.dot.dn {
  background: var(--ok);
}
@media (max-width: 720px) {
  .cal {
    padding: 12px;
    border-radius: 18px;
  }
  h3 {
    font-size: 0.95rem;
  }
  .wd {
    padding: 6px 0;
    font-size: 0.68rem;
  }
  .cell {
    min-height: 52px;
    padding: 4px;
  }
  .num {
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    font-size: 0.78rem;
  }
  .badge {
    min-width: 16px;
    padding: 0 4px;
    font-size: 0.6rem;
  }
  .legend {
    gap: 10px;
    font-size: 0.7rem;
  }
  .chip,
  .more {
    display: none;
  }
}
</style>
