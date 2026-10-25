<script setup>
import { ref } from 'vue'

// Frame for one chart: title, optional note, and a chart ⇄ table toggle so every
// figure has an accessible, copy-pasteable table view.
defineProps({
  title: { type: String, required: true },
  note: { type: String, default: '' },
  table: { type: Object, default: null }, // { columns: [..], rows: [[..]] }
})
const asTable = ref(false)
</script>

<template>
  <section class="cc">
    <header>
      <div>
        <h3>{{ title }}</h3>
        <small v-if="note">{{ note }}</small>
      </div>
      <button v-if="table" type="button" :aria-pressed="asTable" @click="asTable = !asTable">{{ asTable ? 'กราฟ' : 'ตาราง' }}</button>
    </header>
    <div v-if="asTable && table" class="tbl">
      <table>
        <thead>
          <tr><th v-for="c in table.columns" :key="c">{{ c }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in table.rows" :key="i"><td v-for="(v, j) in r" :key="j">{{ v }}</td></tr>
        </tbody>
      </table>
    </div>
    <slot v-else />
  </section>
</template>

<style scoped>
.cc {
  display: grid;
  align-content: start;
  gap: 12px;
  min-width: 0;
  padding: 18px;
  border: 1px solid var(--viz-border);
  border-radius: 18px;
  background: var(--viz-surface);
  -webkit-backdrop-filter: var(--viz-glass);
  backdrop-filter: var(--viz-glass);
}
header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}
h3 {
  font-family: var(--font-body);
  font-size: 0.95rem;
  font-weight: 600;
  letter-spacing: 0;
  color: var(--viz-text);
}
small {
  color: var(--viz-muted);
  font-size: 0.75rem;
}
header button {
  padding: 3px 10px;
  border: 1px solid var(--viz-border);
  border-radius: 999px;
  background: none;
  color: var(--viz-muted);
  font-size: 0.72rem;
  cursor: pointer;
}
.tbl {
  max-height: 260px;
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
}
th,
td {
  padding: 5px 8px;
  border-bottom: 1px solid var(--viz-grid);
  text-align: left;
}
td:not(:first-child),
th:not(:first-child) {
  text-align: right;
}
</style>
