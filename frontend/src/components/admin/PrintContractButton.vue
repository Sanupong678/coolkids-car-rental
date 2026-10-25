<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'

// "Print contract" with a language choice. The agreement is printed in one
// language at a time on A4 (Thai, English or Chinese) from a dedicated page.
const props = defineProps({ bookingId: { type: String, required: true }, compact: { type: Boolean, default: false } })

const LANGS = [
  ['th', 'ภาษาไทย'],
  ['en', 'English'],
  ['zh', '中文'],
]
const open = ref(false)
const root = ref(null)

function print(lang) {
  open.value = false
  window.open(`/admin/contracts/${props.bookingId}/print?lang=${lang}`, '_blank', 'noopener')
}

const onDoc = (e) => {
  if (open.value && !root.value?.contains(e.target)) open.value = false
}
onMounted(() => document.addEventListener('pointerdown', onDoc))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDoc))
</script>

<template>
  <div ref="root" class="pcb">
    <button type="button" class="btn" :class="{ compact }" :aria-expanded="open" aria-haspopup="menu" @click="open = !open">
      <Icon name="printer" :size="14" /> <span v-if="!compact">พิมพ์สัญญา</span>
    </button>
    <div v-if="open" class="menu" role="menu" aria-label="เลือกภาษาสัญญา">
      <small>ภาษาของสัญญา (A4)</small>
      <button v-for="[code, label] in LANGS" :key="code" type="button" role="menuitem" @click="print(code)">{{ label }}</button>
    </div>
  </div>
</template>

<style scoped>
.pcb {
  position: relative;
  display: inline-block;
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px solid var(--viz-border);
  border-radius: 10px;
  background: var(--viz-surface);
  color: var(--viz-text);
  font-weight: 600;
  font-size: 0.85rem;
  cursor: pointer;
}
.btn.compact {
  padding: 6px 8px;
}
.btn:hover {
  background: var(--viz-surface-strong);
}
.menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 6px);
  z-index: 30;
  display: grid;
  min-width: 170px;
  padding: 6px;
  border: 1px solid var(--viz-border);
  border-radius: 12px;
  background: rgb(20 25 42 / 0.92);
  -webkit-backdrop-filter: blur(20px);
  backdrop-filter: blur(20px);
  box-shadow: 0 18px 40px -16px rgb(0 0 0 / 0.7);
}
.menu small {
  padding: 4px 8px 6px;
  color: var(--viz-muted);
  font-size: 0.7rem;
}
.menu button {
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: none;
  color: var(--viz-text);
  text-align: left;
  font: inherit;
  font-size: 0.86rem;
  cursor: pointer;
}
.menu button:hover {
  background: var(--viz-hover);
}
</style>
