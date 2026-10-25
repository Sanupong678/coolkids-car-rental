<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'

// "Which charts?" dropdown: a checklist the dashboard shows from. v-model is the
// array of selected keys; the parent decides where the choice is remembered.
const props = defineProps({
  options: { type: Array, required: true }, // [{ key, label }]
  modelValue: { type: Array, required: true },
})
const emit = defineEmits(['update:modelValue'])

const open = ref(false)
const root = ref(null)
const selected = computed(() => new Set(props.modelValue))

function toggle(key) {
  const next = new Set(selected.value)
  next.has(key) ? next.delete(key) : next.add(key)
  emit('update:modelValue', props.options.map((o) => o.key).filter((k) => next.has(k)))
}
const all = () => emit('update:modelValue', props.options.map((o) => o.key))
const none = () => emit('update:modelValue', [])

const onDoc = (e) => {
  if (open.value && !root.value?.contains(e.target)) open.value = false
}
const onKey = (e) => e.key === 'Escape' && (open.value = false)
onMounted(() => {
  document.addEventListener('pointerdown', onDoc)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDoc)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div ref="root" class="picker">
    <button type="button" class="trigger" :aria-expanded="open" aria-haspopup="true" @click="open = !open">
      <Icon name="layout" :size="14" /> เลือกกราฟที่แสดง
      <b>{{ modelValue.length }}/{{ options.length }}</b>
      <Icon name="chevron-down" :size="14" class="chev" :class="{ up: open }" />
    </button>
    <Transition name="pop">
      <div v-if="open" class="menu" role="group" aria-label="กราฟที่แสดง">
        <div class="quick">
          <button type="button" @click="all">เลือกทั้งหมด</button>
          <button type="button" @click="none">ล้าง</button>
        </div>
        <label v-for="o in options" :key="o.key" class="opt">
          <input type="checkbox" :checked="selected.has(o.key)" @change="toggle(o.key)" />
          <span>{{ o.label }}</span>
        </label>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.picker {
  position: relative;
}
.trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  border: 1px solid var(--viz-border);
  border-radius: 999px;
  background: var(--viz-surface);
  -webkit-backdrop-filter: var(--viz-glass);
  backdrop-filter: var(--viz-glass);
  color: var(--viz-text);
  font-size: 0.82rem;
  cursor: pointer;
}
.trigger b {
  padding: 0 7px;
  border-radius: 999px;
  background: var(--viz-surface-strong);
  font-size: 0.72rem;
}
.chev {
  transition: transform var(--dur-fast) var(--ease-out);
}
.chev.up {
  transform: rotate(180deg);
}
.menu {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 20;
  display: grid;
  gap: 2px;
  width: min(300px, 86vw);
  max-height: 60vh;
  overflow: auto;
  padding: 8px;
  border: 1px solid var(--viz-border);
  border-radius: 16px;
  background: rgb(20 25 42 / 0.86);
  -webkit-backdrop-filter: blur(24px) saturate(150%);
  backdrop-filter: blur(24px) saturate(150%);
  box-shadow: 0 24px 60px -20px rgb(0 0 0 / 0.7);
}
.quick {
  display: flex;
  justify-content: space-between;
  padding: 2px 6px 8px;
  border-bottom: 1px solid var(--viz-grid);
  margin-bottom: 4px;
}
.quick button {
  border: 0;
  background: none;
  color: var(--viz-muted);
  font-size: 0.75rem;
  cursor: pointer;
}
.quick button:hover {
  color: var(--viz-text);
}
.opt {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 8px;
  border-radius: 10px;
  font-size: 0.85rem;
  cursor: pointer;
}
.opt:hover {
  background: var(--viz-hover);
}
.opt input {
  width: 16px;
  height: 16px;
  accent-color: var(--series-1);
}
.pop-enter-active,
.pop-leave-active {
  transition:
    opacity var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
}
.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
