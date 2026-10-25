<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getAvailability } from '@/api/catalogue'
import Icon from '@/components/ui/Icon.vue'
import { t, intlLocale } from '@/i18n'

// Availability calendar driven by the live availability ledger: two months side by side,
// one month on a phone (the arrows page through months; a range may span them).
// GREEN available · RED booked · ORANGE maintenance · GRAY unavailable.
// Customers can only select a contiguous range of AVAILABLE days; the server
// re-validates at checkout regardless (business rule 14).
const props = defineProps({ slug: { type: String, required: true } })
const emit = defineEmits(['select'])

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const today = new Date()
today.setHours(0, 0, 0, 0)

const monthStart = ref(new Date(today.getFullYear(), today.getMonth(), 1))
const status = ref({}) // 'YYYY-MM-DD' → status
const loading = ref(false)
const start = ref(null)
const end = ref(null)

const narrow = typeof window !== 'undefined' ? window.matchMedia('(max-width: 720px)') : null
const single = ref(narrow?.matches ?? false)
const onNarrow = (e) => (single.value = e.matches)
onMounted(() => narrow?.addEventListener('change', onNarrow))
onBeforeUnmount(() => narrow?.removeEventListener('change', onNarrow))

const months = computed(() =>
  (single.value ? [0] : [0, 1]).map((o) => new Date(monthStart.value.getFullYear(), monthStart.value.getMonth() + o, 1)),
)
const canPrev = computed(() => monthStart.value > new Date(today.getFullYear(), today.getMonth(), 1))

async function load() {
  loading.value = true
  const from = months.value[0]
  // always fetch two months, so paging forward on a phone is instant
  const to = new Date(from.getFullYear(), from.getMonth() + 2, 0)
  try {
    const days = await getAvailability(props.slug, iso(from), iso(to))
    status.value = { ...status.value, ...Object.fromEntries(days.map((d) => [d.date, d.status])) }
  } finally {
    loading.value = false
  }
}
watch(monthStart, load)
onMounted(load)

function cells(month) {
  const first = (month.getDay() + 6) % 7 // Monday-first
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  return [
    ...Array.from({ length: first }, () => null),
    ...Array.from({ length: count }, (_, i) => {
      const d = new Date(month.getFullYear(), month.getMonth(), i + 1)
      return { date: iso(d), day: i + 1, status: status.value[iso(d)] ?? 'LOADING' }
    }),
  ]
}

const rangeFree = (a, b) => {
  for (let d = new Date(a); iso(d) <= b; d.setDate(d.getDate() + 1)) if (status.value[iso(d)] !== 'AVAILABLE') return false
  return true
}

function pick(c) {
  if (!c || c.status !== 'AVAILABLE') return
  if (!start.value || end.value || c.date < start.value) {
    start.value = c.date
    end.value = null
  } else if (rangeFree(start.value, c.date)) {
    end.value = c.date
    emit('select', { from: start.value, to: c.date })
  } else {
    start.value = c.date
  }
}
const inRange = (d) => start.value && d >= start.value && d <= (end.value ?? start.value)

const LABEL = computed(() => Object.fromEntries(['AVAILABLE', 'BOOKED', 'MAINTENANCE', 'UNAVAILABLE'].map((k) => [k, t(`cal.${k}`)])))
// Monday-first weekday initials in the chosen language (1 Jan 2024 was a Monday).
const DOW = computed(() => Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(intlLocale(), { weekday: 'narrow' })))
const fmtMonth = (d) => d.toLocaleDateString(intlLocale(), { month: 'long', year: 'numeric' })
</script>

<template>
  <div class="cal" :aria-busy="loading">
    <div class="top">
      <button type="button" :disabled="!canPrev" :aria-label="t('cal.prev')" @click="monthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1)">
        <Icon name="chevron-left" />
      </button>
      <h4 v-if="single" class="now" aria-live="polite">{{ fmtMonth(months[0]) }}</h4>
      <ul v-else class="legend">
        <li v-for="(l, k) in LABEL" :key="k"><i :class="k" />{{ l }}</li>
      </ul>
      <button type="button" :aria-label="t('cal.next')" @click="monthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1)">
        <Icon name="chevron-right" />
      </button>
    </div>
    <ul v-if="single" class="legend">
      <li v-for="(l, k) in LABEL" :key="k"><i :class="k" />{{ l }}</li>
    </ul>
    <div class="months" :class="{ single }">
      <div v-for="m in months" :key="m.toISOString()" class="month">
        <h4 v-if="!single">{{ fmtMonth(m) }}</h4>
        <div class="dow"><span v-for="(d, i) in DOW" :key="i">{{ d }}</span></div>
        <div class="days">
          <template v-for="(c, i) in cells(m)" :key="i">
            <span v-if="!c" />
            <button
              v-else
              type="button"
              :class="[c.status, { sel: inRange(c.date), edge: c.date === start || c.date === end }]"
              :disabled="c.status !== 'AVAILABLE'"
              :aria-label="`${c.date}: ${LABEL[c.status] ?? t('cal.loading')}`"
              :aria-pressed="inRange(c.date)"
              @click="pick(c)"
            >
              {{ c.day }}
            </button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cal {
  display: grid;
  gap: var(--s-4);
}
.top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--s-3);
}
.top button {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--border-strong);
  border-radius: 50%;
  background: none;
  cursor: pointer;
}
.top button:disabled {
  opacity: 0.3;
  cursor: default;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--s-4);
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
.legend li {
  display: flex;
  align-items: center;
  gap: 6px;
}
.legend i {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}
.months {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--s-6);
}
h4 {
  font-family: var(--font-body);
  font-weight: 600;
  margin-bottom: var(--s-3);
}
.top .now {
  margin: 0;
  font-size: var(--fs-lg);
}
.dow,
.days {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
}
.dow span {
  text-align: center;
  font-size: 0.68rem;
  color: var(--text-muted);
  padding-bottom: 4px;
}
.days button {
  position: relative;
  aspect-ratio: 1;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  font-size: var(--fs-sm);
  cursor: pointer;
  transition:
    transform var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out);
}
.days button:disabled {
  cursor: not-allowed;
}
.AVAILABLE,
.legend .AVAILABLE {
  background: rgb(63 168 119 / 0.18);
  /* readable on both the dark and the light page */
  color: color-mix(in srgb, var(--avail-free) 55%, var(--text));
}
.legend .AVAILABLE {
  background: var(--avail-free);
}
.days .AVAILABLE:hover {
  transform: scale(1.08);
  background: rgb(63 168 119 / 0.35);
}
.BOOKED {
  background: rgb(212 87 76 / 0.2);
  color: #f0a39b;
}
.legend .BOOKED {
  background: var(--avail-booked);
}
.MAINTENANCE {
  background: rgb(224 145 58 / 0.22);
  color: #f2c48f;
}
.legend .MAINTENANCE {
  background: var(--avail-maintenance);
}
.UNAVAILABLE,
.LOADING {
  background: rgb(255 255 255 / 0.03);
  color: var(--c-ink-500);
}
.legend .UNAVAILABLE {
  background: var(--avail-blocked);
}
.LOADING {
  animation: pulse 1.2s infinite;
}
.days button.sel {
  background: var(--accent);
  color: var(--text-inverse);
}
.days button.edge {
  box-shadow: 0 0 0 2px var(--bg), 0 0 0 3px var(--accent);
}
@keyframes pulse {
  50% {
    opacity: 0.5;
  }
}
.months.single {
  grid-template-columns: 1fr;
}
</style>
