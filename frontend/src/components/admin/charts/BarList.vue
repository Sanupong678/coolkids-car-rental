<script setup>
import { computed } from 'vue'

// Ranked horizontal bars (top vehicles, categories, nationalities). The value is
// a direct label in ink colour; the bar carries magnitude only. Hovering a row
// reveals its secondary measure.
const props = defineProps({
  data: { type: Array, required: true }, // [{ label, value, sub? }]
  format: { type: Function, default: (v) => v.toLocaleString() },
  color: { type: String, default: 'var(--series-1)' },
})
const max = computed(() => Math.max(1, ...props.data.map((d) => d.value)))
</script>

<template>
  <ul class="bl">
    <li v-for="d in data" :key="d.label" :title="d.sub ? `${d.label}: ${format(d.value)} · ${d.sub}` : undefined">
      <span class="name">{{ d.label }}</span>
      <span class="track"><i :style="{ width: `${(d.value / max) * 100}%`, background: color }" /></span>
      <span class="val">{{ format(d.value) }}<small v-if="d.sub">{{ d.sub }}</small></span>
    </li>
    <li v-if="!data.length" class="none">ยังไม่มีข้อมูลในช่วงนี้</li>
  </ul>
</template>

<style scoped>
.bl {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
li {
  display: grid;
  grid-template-columns: minmax(90px, 34%) 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 4px 6px;
  border-radius: 6px;
  font-size: 0.82rem;
}
li:hover {
  background: var(--viz-hover);
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--viz-text);
}
.track {
  height: 10px;
}
.track i {
  display: block;
  height: 100%;
  min-width: 2px;
  border-radius: 0 4px 4px 0;
}
.val {
  display: grid;
  justify-items: end;
  font-weight: 600;
  color: var(--viz-text);
  font-variant-numeric: tabular-nums;
}
.val small {
  font-weight: 400;
  font-size: 0.7rem;
  color: var(--viz-muted);
}
.none {
  display: block;
  color: var(--viz-muted);
}
</style>
