<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

// Single-series vertical bars (magnitude by category or by day) with a per-bar
// hover tooltip. Thin bars, 4px rounded tops anchored to the baseline, 2px gaps.
const props = defineProps({
  data: { type: Array, required: true }, // [{ label, value }]
  format: { type: Function, default: (v) => v.toLocaleString() },
  formatLabel: { type: Function, default: (l) => l },
  height: { type: Number, default: 200 },
  color: { type: String, default: 'var(--series-1)' },
  name: { type: String, default: '' },
})

const root = ref(null)
const width = ref(220)
const hover = ref(null)
let ro
onMounted(() => {
  ro = new ResizeObserver(([e]) => (width.value = Math.max(220, e.contentRect.width)))
  ro.observe(root.value)
})
onBeforeUnmount(() => ro?.disconnect())

const pad = { top: 10, right: 8, bottom: 26, left: 44 }
const max = computed(() => {
  const m = Math.max(0, ...props.data.map((d) => d.value))
  if (m === 0) return 1
  if (m <= 5) return Math.ceil(m)
  const mag = 10 ** Math.floor(Math.log10(m))
  return Math.ceil(m / mag / 2) * 2 * mag
})
const ticks = computed(() => {
  const t = [0, 0.5, 1].map((f) => f * max.value)
  return [...new Set(t.map((v) => (max.value <= 5 ? Math.round(v) : v)))]
})
const plotW = computed(() => width.value - pad.left - pad.right)
const slot = computed(() => plotW.value / Math.max(1, props.data.length))
const barW = computed(() => Math.max(2, Math.min(36, slot.value - 2)))
const bx = (i) => pad.left + i * slot.value + (slot.value - barW.value) / 2
const y = (v) => pad.top + (1 - v / max.value) * (props.height - pad.top - pad.bottom)
const showLabel = (i) => {
  const step = Math.max(1, Math.ceil(props.data.length / Math.max(2, Math.floor(width.value / 46))))
  return i % step === 0
}
// Rounded top corners only (data end), square at the baseline.
function bar(i, v) {
  const x0 = bx(i)
  const y0 = y(v)
  const h = y(0) - y0
  const r = Math.min(4, barW.value / 2, h)
  if (h <= 0) return ''
  return `M${x0},${y(0)}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + barW.value - r}Q${x0 + barW.value},${y0} ${x0 + barW.value},${y0 + r}V${y(0)}Z`
}
</script>

<template>
  <div ref="root" class="bc" @pointerleave="hover = null">
    <svg :width="width" :height="height" role="img" :aria-label="name">
      <g class="grid">
        <g v-for="t in ticks" :key="t">
          <line :x1="pad.left" :x2="width - pad.right" :y1="y(t)" :y2="y(t)" />
          <text :x="pad.left - 8" :y="y(t)" dy="0.32em" text-anchor="end">{{ format(t) }}</text>
        </g>
      </g>
      <g v-for="(d, i) in data" :key="d.label">
        <!-- hit target is the full column, larger than the mark -->
        <rect :x="pad.left + i * slot" :y="pad.top" :width="slot" :height="height - pad.top - pad.bottom" fill="transparent" @pointerenter="hover = i" />
        <path :d="bar(i, d.value)" :style="{ fill: color }" :class="{ dim: hover != null && hover !== i }" />
        <text v-if="showLabel(i)" class="xl" :x="bx(i) + barW / 2" :y="height - 8" text-anchor="middle">{{ formatLabel(d.label) }}</text>
      </g>
    </svg>
    <div v-if="hover != null" class="tip" :style="{ left: `${Math.min(Math.max(bx(hover) + barW / 2, 60), width - 60)}px`, top: `${Math.max(0, y(data[hover].value) - 54)}px` }">
      <small>{{ formatLabel(data[hover].label) }}</small>
      <strong>{{ format(data[hover].value) }}</strong>
    </div>
  </div>
</template>

<style scoped>
.bc {
  position: relative;
  width: 100%;
  /* size from the card, never from the svg (which is sized from us) */
  contain: inline-size;
}
svg {
  display: block;
  overflow: visible;
}
.grid line {
  stroke: var(--viz-grid);
}
.grid text,
.xl {
  fill: var(--viz-muted);
  font-size: 11px;
}
path {
  transition: opacity var(--dur-fast) var(--ease-out);
  pointer-events: none;
}
path.dim {
  opacity: 0.45;
}
.tip {
  position: absolute;
  display: grid;
  min-width: 90px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--viz-tip-bg);
  color: var(--viz-tip-text);
  font-size: 12px;
  pointer-events: none;
  transform: translateX(-50%);
  white-space: nowrap;
}
.tip small {
  opacity: 0.75;
}
.tip strong {
  font-size: 14px;
}
</style>
