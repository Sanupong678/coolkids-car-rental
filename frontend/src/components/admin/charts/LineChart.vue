<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

// Single-series area/line over time with a crosshair tooltip.
// One y-axis only; values arrive already in display units via `format`.
const props = defineProps({
  data: { type: Array, required: true }, // [{ label: 'YYYY-MM-DD', value: number }]
  format: { type: Function, default: (v) => v.toLocaleString() },
  formatLabel: { type: Function, default: (l) => l },
  height: { type: Number, default: 220 },
  color: { type: String, default: 'var(--series-1)' },
  name: { type: String, default: '' },
})

const root = ref(null)
const width = ref(240)
const hover = ref(null)
let ro
onMounted(() => {
  ro = new ResizeObserver(([e]) => (width.value = Math.max(240, e.contentRect.width)))
  ro.observe(root.value)
})
onBeforeUnmount(() => ro?.disconnect())

const pad = { top: 12, right: 12, bottom: 26, left: 56 }
const max = computed(() => {
  const m = Math.max(0, ...props.data.map((d) => d.value))
  if (m === 0) return 1
  const mag = 10 ** Math.floor(Math.log10(m))
  return Math.ceil(m / mag / 2) * 2 * mag // nice round top
})
const ticks = computed(() => [0, 0.25, 0.5, 0.75, 1].map((t) => t * max.value))
const x = (i) => pad.left + (props.data.length <= 1 ? 0 : (i / (props.data.length - 1)) * (width.value - pad.left - pad.right))
const y = (v) => pad.top + (1 - v / max.value) * (props.height - pad.top - pad.bottom)
const line = computed(() => props.data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(''))
const area = computed(() =>
  props.data.length ? `${line.value}L${x(props.data.length - 1)},${y(0)}L${x(0)},${y(0)}Z` : '',
)
const xLabels = computed(() => {
  const n = props.data.length
  if (!n) return []
  const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(width.value / 90))))
  return props.data.map((d, i) => ({ i, label: props.formatLabel(d.label) })).filter(({ i }) => i % step === 0 || i === n - 1)
})

function onMove(e) {
  const r = root.value.getBoundingClientRect()
  const px = e.clientX - r.left
  const n = props.data.length
  if (!n) return
  const i = Math.round(((px - pad.left) / (width.value - pad.left - pad.right)) * (n - 1))
  hover.value = Math.min(n - 1, Math.max(0, i))
}
</script>

<template>
  <div ref="root" class="lc" @pointermove="onMove" @pointerleave="hover = null">
    <svg :width="width" :height="height" role="img" :aria-label="name">
      <g class="grid">
        <g v-for="t in ticks" :key="t">
          <line :x1="pad.left" :x2="width - pad.right" :y1="y(t)" :y2="y(t)" />
          <text :x="pad.left - 8" :y="y(t)" dy="0.32em" text-anchor="end">{{ format(t) }}</text>
        </g>
        <text v-for="l in xLabels" :key="l.i" :x="x(l.i)" :y="height - 6" text-anchor="middle">{{ l.label }}</text>
      </g>
      <path :d="area" class="area" :style="{ fill: color }" />
      <path :d="line" class="line" :style="{ stroke: color }" />
      <g v-if="hover != null">
        <line class="cross" :x1="x(hover)" :x2="x(hover)" :y1="pad.top" :y2="height - pad.bottom" />
        <circle :cx="x(hover)" :cy="y(data[hover].value)" r="5" class="dot" :style="{ fill: color }" />
      </g>
    </svg>
    <div
      v-if="hover != null"
      class="tip"
      :style="{ left: `${Math.min(x(hover), width - 150)}px`, top: `${Math.max(0, y(data[hover].value) - 58)}px` }"
    >
      <small>{{ formatLabel(data[hover].label) }}</small>
      <strong>{{ format(data[hover].value) }}</strong>
    </div>
  </div>
</template>

<style scoped>
.lc {
  position: relative;
  width: 100%;
  /* size from the card, never from the svg (which is sized from us) */
  contain: inline-size;
  touch-action: pan-y;
}
svg {
  display: block;
  overflow: visible;
}
.grid line {
  stroke: var(--viz-grid);
  stroke-width: 1;
}
.grid text {
  fill: var(--viz-muted);
  font-size: 11px;
}
.area {
  opacity: 0.12;
}
.line {
  fill: none;
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.cross {
  stroke: var(--viz-muted);
  stroke-dasharray: 3 3;
}
.dot {
  stroke: var(--viz-surface);
  stroke-width: 2;
}
.tip {
  position: absolute;
  display: grid;
  min-width: 110px;
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
