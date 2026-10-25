<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { t } from '@/i18n'

// Draw-to-sign canvas (mouse, pen, touch via Pointer Events). Emits a PNG data
// URL after each stroke, or null when cleared. Rendered at device pixel ratio
// so the signature stays crisp on the printed contract.
const emit = defineEmits(['update:modelValue'])
defineProps({ modelValue: { type: String, default: null } })

const canvas = ref(null)
const empty = ref(true)
let ctx
let drawing = false
let last = null

function resize() {
  const c = canvas.value
  const ratio = window.devicePixelRatio || 1
  const { width, height } = c.getBoundingClientRect()
  c.width = Math.round(width * ratio)
  c.height = Math.round(height * ratio)
  ctx = c.getContext('2d')
  ctx.scale(ratio, ratio)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#111827'
  ctx.lineWidth = 2.4
  clear()
}

const point = (e) => {
  const r = canvas.value.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}

function down(e) {
  drawing = true
  last = point(e)
  canvas.value.setPointerCapture(e.pointerId)
  ctx.beginPath()
  ctx.arc(last.x, last.y, ctx.lineWidth / 2, 0, Math.PI * 2)
  ctx.fillStyle = ctx.strokeStyle
  ctx.fill()
}
function move(e) {
  if (!drawing) return
  const p = point(e)
  ctx.beginPath()
  ctx.moveTo(last.x, last.y)
  ctx.lineTo(p.x, p.y)
  ctx.stroke()
  last = p
}
function up() {
  if (!drawing) return
  drawing = false
  empty.value = false
  emit('update:modelValue', canvas.value.toDataURL('image/png'))
}

function clear() {
  if (!ctx) return
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.value.width, canvas.value.height)
  ctx.restore()
  empty.value = true
  emit('update:modelValue', null)
}

onMounted(() => {
  resize()
  window.addEventListener('resize', resize)
})
onBeforeUnmount(() => window.removeEventListener('resize', resize))
</script>

<template>
  <div class="sig">
    <canvas
      ref="canvas"
      :aria-label="t('sign.pad')"
      role="img"
      @pointerdown.prevent="down"
      @pointermove.prevent="move"
      @pointerup="up"
      @pointercancel="up"
      @pointerleave="up"
    />
    <span v-if="empty" class="hint">{{ t('sign.here') }}</span>
    <button type="button" class="clear" :disabled="empty" @click="clear">{{ t('sign.clear') }}</button>
  </div>
</template>

<style scoped>
.sig {
  position: relative;
  height: 150px;
  border: 1.5px dashed #c9cbd2;
  border-radius: 14px;
  background: #fff;
  overflow: hidden;
}
canvas {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
  cursor: crosshair;
}
.hint {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #a1a4ad;
  font-size: 0.9rem;
  pointer-events: none;
}
.clear {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 4px 10px;
  border: 1px solid #e3e4e8;
  border-radius: 999px;
  background: #fff;
  color: #4b5060;
  font-size: 0.75rem;
  cursor: pointer;
}
.clear:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
