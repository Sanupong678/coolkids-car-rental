<script setup>
import { onMounted, ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'

// White modal shell for the operations board's tools (ไมล์, ชำระเงิน, รายได้, สัญญา).
defineProps({ title: { type: String, required: true }, icon: { type: String, default: null }, wide: { type: Boolean, default: false } })
const emit = defineEmits(['close'])
const dialog = ref(null)
onMounted(() => dialog.value.showModal())
function close() {
  dialog.value?.close()
  emit('close')
}
</script>

<template>
  <dialog ref="dialog" class="od" :class="{ wide }" :aria-label="title" @cancel.prevent="close" @click.self="close">
    <div class="card">
      <header>
        <h3><Icon v-if="icon" :name="icon" :size="18" /> {{ title }}</h3>
        <button type="button" class="x" aria-label="ปิด" @click="close"><Icon name="x" :size="18" /></button>
      </header>
      <div class="body"><slot :close="close" /></div>
    </div>
  </dialog>
</template>

<style scoped>
.od {
  width: min(460px, calc(100vw - 16px));
  max-height: calc(100dvh - 16px);
  padding: 0;
  overflow: hidden;
  border: 0;
  background: transparent;
  color: #121319;
  color-scheme: light;
}
.od.wide {
  width: min(860px, calc(100vw - 16px));
}
.od::backdrop {
  background: rgb(8 9 12 / 0.55);
}
.card {
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - 16px);
  border-radius: 20px;
  background: #fff;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 18px 20px 6px;
}
h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1.05rem;
  font-weight: 700;
}
.x {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 50%;
  background: none;
  cursor: pointer;
}
.x:hover {
  background: #f2f3f5;
}
.body {
  display: grid;
  gap: 14px;
  padding: 10px 20px 20px;
  overflow-y: auto;
}
/* shared form bits for the slots */
.body :deep(.seg) {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.body :deep(.seg button) {
  min-height: 38px;
  padding: 0 16px;
  border: 1px solid #c9ccd4;
  border-radius: 12px;
  background: #fff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.body :deep(.seg button.on) {
  border-color: #0e2a52;
  background: #0e2a52;
  color: #fff;
}
.body :deep(label.f) {
  display: grid;
  gap: 6px;
  font-size: 0.85rem;
  font-weight: 600;
}
.body :deep(label.f input),
.body :deep(label.f textarea) {
  min-height: 46px;
  padding: 0 14px;
  border: 1px solid #c9ccd4;
  border-radius: 12px;
  background: #fafafa;
  font: inherit;
  font-weight: 400;
}
.body :deep(label.f textarea) {
  padding: 10px 14px;
}
.body :deep(.primary) {
  min-height: 46px;
  border: 0;
  border-radius: 12px;
  background: #0e2a52;
  color: #fff;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.body :deep(.primary:disabled) {
  background: #8a97ab;
  cursor: not-allowed;
}
.body :deep(.hint) {
  color: #6b6e7a;
  font-size: 0.78rem;
  text-align: center;
}
.body :deep(.err) {
  color: #c22a21;
  font-size: 0.85rem;
}
.body :deep(.ok) {
  color: #1f8a56;
  font-size: 0.85rem;
}
</style>
