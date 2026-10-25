<script setup>
import { t as tr } from '@/i18n'
import { onBeforeUnmount, onMounted, ref } from 'vue'

// Scroll-driven hero film. The clip is a pre-rendered frame sequence
// (f###.webp) plus a car alpha mask per frame (m###.webp). Each frame is
// composited on a canvas in three layers:
//   1. the street scene
//   2. the "COOL KIDS" wordmark, sitting in the scene
//   3. the car again, cut out by its mask — so the car drives in front of the text
// The film stops at manifest.lastFrame (later frames are close-ups where the
// car would hide the whole wordmark). The section is tall and its stage is sticky: scrolling scrubs the film, the
// wordmark fades in as the car arrives, and only once the last frame is reached
// does the page continue to the content below.
const props = defineProps({
  base: { type: String, required: true }, // folder holding manifest.json + frames
  alt: { type: String, default: '' },
  focusX: { type: Number, default: 0.55 }, // which part of the square frame to keep when cropping
  focusY: { type: Number, default: 0.48 },
})

const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const root = ref(null)
const canvas = ref(null)
const progress = ref(reduced ? 1 : 0) // 0 → 1 over the pinned scroll
const ready = ref(false)

let manifest = null
let frames = []
let masks = []
let shown = reduced ? 1 : 0 // eased progress actually drawn
let raf = 0
let ctx = null
const scratch = typeof document !== 'undefined' ? document.createElement('canvas') : null
const sctx = scratch?.getContext('2d')

const pad = (n) => String(n).padStart(3, '0')
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x))
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

function load(src) {
  const img = new Image()
  img.decoding = 'async'
  img.src = src
  return img
}

async function preload() {
  manifest = await fetch(`${props.base}/manifest.json`).then((r) => r.json())
  const n = manifest.lastFrame ?? manifest.frames
  frames = new Array(n)
  masks = new Array(n)
  // final frame first (reduced motion / poster), then the first, then the rest in order
  const order = [n - 1, 0, ...Array.from({ length: n - 2 }, (_, i) => i + 1)]
  for (const i of order) {
    frames[i] = load(`${props.base}/f${pad(i + 1)}.webp`)
    masks[i] = i + 1 >= manifest.firstMask ? load(`${props.base}/m${pad(i + 1)}.webp`) : null
    if (i === order[1]) await frames[i].decode().catch(() => {})
  }
  ready.value = true
}

// Nearest frame that has finished loading (scrubbing can outrun the network).
function pick(i) {
  for (let d = 0; d < frames.length; d++) {
    for (const j of [i - d, i + d]) {
      const f = frames[j]
      if (f?.complete && f.naturalWidth) return j
    }
  }
  return -1
}

function resize() {
  const c = canvas.value
  if (!c) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  c.width = Math.round(c.clientWidth * dpr)
  c.height = Math.round(c.clientHeight * dpr)
  draw()
}

function draw() {
  const c = canvas.value
  if (!c || !manifest) return
  ctx ??= c.getContext('2d')
  const W = c.width
  const H = c.height
  const n = frames.length
  const i = pick(Math.round(shown * (n - 1)))
  if (i < 0) return
  const frame = frames[i]
  const fw = manifest.width
  const fh = manifest.height

  // cover-fit the square frame, keeping the focus point in view
  const s = Math.max(W / fw, H / fh)
  // portrait screens see only a slice of the square frame: pan from the car's
  // start (right edge) to its final position as the film plays
  const fx = props.focusX + (1 - shown) * 0.32
  const dx = clamp(W / 2 - fx * fw * s, W - fw * s, 0)
  const dy = clamp(H / 2 - props.focusY * fh * s, H - fh * s, 0)

  ctx.clearRect(0, 0, W, H)
  ctx.drawImage(frame, dx, dy, fw * s, fh * s)

  // 2 — wordmark, revealed while the car approaches
  const t = smooth(0.2, 0.62, shown)
  if (t > 0) {
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    // as large as fits 94% of the width (and a third of the height)
    let size = H * 0.34
    ctx.font = `800 ${size}px Unbounded, sans-serif`
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'
    size = Math.min(size, (size * W * 0.94) / ctx.measureText('COOL KIDS').width)
    ctx.font = `800 ${size}px Unbounded, sans-serif`
    // baseline high enough that the letters' top half clears the car roof
    const y = W > H ? H * 0.4 : H * 0.25
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${(1 - t) * size * 0.25}px`
    ctx.globalAlpha = t
    const g = ctx.createLinearGradient(0, y - size * 0.8, 0, y + size * 0.05)
    g.addColorStop(0, '#ff5d52')
    g.addColorStop(0.65, '#e2362c')
    g.addColorStop(1, 'rgba(160, 24, 18, 0.85)')
    ctx.shadowColor = 'rgba(226, 54, 44, 0.55)'
    ctx.shadowBlur = size * 0.35 * t
    ctx.fillStyle = g
    ctx.fillText('COOL KIDS', W / 2, y + (1 - t) * size * 0.25)
    ctx.shadowBlur = 0

    const tt = smooth(0.55, 0.8, shown)
    if (tt > 0) {
      const small = Math.max(11, size * 0.085)
      ctx.globalAlpha = tt
      ctx.font = `500 ${small}px Unbounded, sans-serif`
      if ('letterSpacing' in ctx) ctx.letterSpacing = `${small * 0.6}px`
      ctx.fillStyle = '#fff'
      ctx.fillText('CAR RENTAL · BANGKOK', W / 2, Math.max(y - size * 0.95, 120 * (W / canvas.value.clientWidth)))
    }
    ctx.restore()

    // 3 — the car on top, cut out of the same frame by its mask
    const mask = masks[i]
    if (mask?.complete && mask.naturalWidth && sctx) {
      scratch.width = fw
      scratch.height = fh
      sctx.globalCompositeOperation = 'source-over'
      sctx.drawImage(mask, 0, 0)
      sctx.globalCompositeOperation = 'source-in'
      sctx.drawImage(frame, 0, 0)
      ctx.drawImage(scratch, dx, dy, fw * s, fh * s)
    }
  }
}

function readScroll() {
  const el = root.value
  if (!el || reduced) return
  const r = el.getBoundingClientRect()
  const span = r.height - window.innerHeight
  if (span > 0) progress.value = clamp(-r.top / span) // not laid out yet → keep the current value
}

function loop() {
  const target = progress.value
  const next = Math.abs(target - shown) < 0.0005 ? target : shown + (target - shown) * 0.2
  if (next !== shown || !ready.value) {
    shown = next
    draw()
  }
  raf = requestAnimationFrame(loop)
}

let ro
onMounted(async () => {
  window.addEventListener('scroll', readScroll, { passive: true })
  ro = new ResizeObserver(resize)
  ro.observe(canvas.value)
  readScroll()
  await preload()
  await document.fonts?.load('800 40px Unbounded').catch(() => {})
  resize()
  raf = requestAnimationFrame(loop)
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', readScroll)
  ro?.disconnect()
  cancelAnimationFrame(raf)
})

const skip = () => {
  const el = root.value
  window.scrollTo({ top: el.offsetTop + el.offsetHeight - window.innerHeight, behavior: 'smooth' })
}
</script>

<template>
  <section ref="root" class="film" :class="{ still: reduced }">
    <div class="pin">
      <canvas ref="canvas" role="img" :aria-label="alt" />
      <div class="shade" :style="{ opacity: 0.35 + progress * 0.65 }" aria-hidden="true" />

      <button v-if="!reduced" type="button" class="hint" :class="{ gone: progress > 0.04 }" @click="skip">
        <span class="mouse"><i /></span>
        {{ tr('home.scrollBegin') }}
      </button>
      <div class="bar" aria-hidden="true"><i :style="{ transform: `scaleX(${progress})` }" /></div>

      <slot :progress="progress" :done="progress > 0.86" />
    </div>
  </section>
</template>

<style scoped>
.film {
  position: relative;
  height: 320vh; /* scroll distance that plays the whole clip */
  background: #07080c;
}
.film.still {
  height: 100svh;
}
.pin {
  position: sticky;
  top: 0;
  height: 100svh;
  overflow: hidden;
  isolation: isolate;
  color: #fff;
  border-radius: 0 0 28px 28px;
}
canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: -2;
  display: block;
}
.shade {
  position: absolute;
  inset: 0;
  z-index: -1;
  background:
    linear-gradient(180deg, rgb(7 8 12 / 0.55), transparent 22%),
    linear-gradient(0deg, rgb(7 8 12 / 0.9) 4%, transparent 42%);
  pointer-events: none;
}
.hint {
  position: absolute;
  left: 50%;
  bottom: 2.25rem;
  transform: translateX(-50%);
  display: grid;
  justify-items: center;
  gap: 10px;
  border: 0;
  background: none;
  color: rgb(255 255 255 / 0.8);
  font-size: 0.8rem;
  letter-spacing: 0.08em;
  cursor: pointer;
  transition: opacity 0.4s ease, transform 0.4s ease;
}
.hint.gone {
  opacity: 0;
  transform: translate(-50%, 12px);
  pointer-events: none;
}
.mouse {
  width: 24px;
  height: 38px;
  border: 1.5px solid rgb(255 255 255 / 0.7);
  border-radius: 14px;
  display: grid;
  justify-items: center;
  padding-top: 7px;
}
.mouse i {
  width: 3px;
  height: 8px;
  border-radius: 2px;
  background: #fff;
  animation: wheel 1.6s ease-in-out infinite;
}
.bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  background: rgb(255 255 255 / 0.08);
}
.bar i {
  display: block;
  height: 100%;
  background: var(--accent);
  transform-origin: left;
}
@keyframes wheel {
  0% {
    transform: translateY(0);
    opacity: 1;
  }
  70% {
    transform: translateY(10px);
    opacity: 0;
  }
  100% {
    opacity: 0;
  }
}
@media (max-width: 720px) {
  .pin {
    border-radius: 0 0 20px 20px;
  }
}
</style>
