<script setup>
import { t as tr } from '@/i18n'
import { onBeforeUnmount, onMounted, ref } from 'vue'

// Scroll-driven studio hero. Three stacked canvases, all drawn at device
// resolution so the scene stays sharp up to 2560 px wide and beyond:
//   1. stage — light grey seamless studio with an overhead light panel; its floor
//              fades into the page background so the hero blends into the page
//   2. word  — the red "COOL KIDS" wordmark (pulses slowly via CSS)
//   3. car   — a background-free Civic side view (body + separately rotating
//              wheels), its floor reflection and contact shadow. It drives in
//              from the left in front of the wordmark and parks in the centre;
//              the wheels roll exactly with the distance travelled.
// The section is tall and its stage sticky: scrolling drives the car; once it
// has parked, the page continues. Reduced motion: the parked frame, no pin.
const props = defineProps({
  asset: { type: String, required: true }, // folder with meta.json, body-*.webp, wheel-*.webp
  alt: { type: String, default: '' },
})

const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const root = ref(null)
const stageCv = ref(null)
const wordCv = ref(null)
const carCv = ref(null)
const progress = ref(reduced ? 1 : 0)

const PARK_AT = 0.82 // share of the scroll used for driving; the rest is the parked hold
const PAGE_BG = '#f3f3f1' // the floor fades into this (tokens.css --bg)
let meta = null
let body = null
let wheels = []
let shown = progress.value
let raf = 0
let refl = null // scratch canvas for the floor reflection

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x))
const easeOut = (t) => 1 - (1 - t) ** 3

function img(src) {
  const i = new Image()
  i.decoding = 'async'
  i.src = src
  return i.decode().then(() => i)
}

async function load() {
  meta = await fetch(`${props.asset}/meta.json`).then((r) => r.json())
  const big = window.innerWidth * Math.min(window.devicePixelRatio || 1, 2) > 1700
  ;[body, ...wheels] = await Promise.all([
    img(`${props.asset}/${big ? 'body-3000' : 'body-1600'}.webp`),
    ...meta.wheels.map((w) => img(`${props.asset}/${w.src}`)),
  ])
}

// ---------- layout (canvas pixels) ----------
// The car is sized by both width and height so the scene keeps its proportions
// on wide-and-short as well as tall screens.
function layout(W, H) {
  const portrait = H > W
  const carW = portrait ? W * 0.92 : Math.min(W * 0.56, H * 1.12)
  const k = carW / meta.width // image px → canvas px
  const carH = meta.height * k
  const ground = H * (portrait ? 0.7 : 0.84)
  return { W, H, portrait, carW, carH, k, ground, parkX: (W - carW) / 2, startX: -carW * 1.15 }
}

// ---------- 1. light studio ----------
function paintStage(cv, L) {
  const g = cv.getContext('2d')
  const { W, H, ground } = L
  // seamless cyclorama: soft grey wall curving into a lighter floor that ends in the page colour
  let gr = g.createLinearGradient(0, 0, 0, H)
  gr.addColorStop(0, '#b9bbbf')
  gr.addColorStop(0.3, '#cfd0d3')
  gr.addColorStop(ground / H - 0.08, '#d9dadc')
  gr.addColorStop(ground / H, '#e4e4e5')
  gr.addColorStop(1, PAGE_BG)
  g.fillStyle = gr
  g.fillRect(0, 0, W, H)

  // overhead light panel along the top edge + light falling into the room
  const pw = W * (L.portrait ? 0.95 : 0.7)
  const px = (W - pw) / 2
  const ph = H * 0.035
  g.save()
  g.shadowColor = 'rgba(255,255,255,1)'
  g.shadowBlur = H * 0.18
  g.fillStyle = '#ffffff'
  g.fillRect(px, 0, pw, ph)
  g.restore()
  gr = g.createLinearGradient(0, 0, 0, H * 0.5)
  gr.addColorStop(0, 'rgba(255,255,255,0.75)')
  gr.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = gr
  g.beginPath()
  g.moveTo(px, 0)
  g.lineTo(px + pw, 0)
  g.lineTo(W, H * 0.5)
  g.lineTo(0, H * 0.5)
  g.closePath()
  g.fill()

  // light pool on the floor under the car
  g.save()
  g.translate(W / 2, ground)
  g.scale(1, 0.18)
  gr = g.createRadialGradient(0, 0, 0, 0, 0, pw * 0.6)
  gr.addColorStop(0, 'rgba(255,255,255,0.7)')
  gr.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = gr
  g.fillRect(-W, -H * 4, W * 2, H * 8)
  g.restore()

  // darker upper corners (studio falloff), faded out towards the floor so the
  // bottom of the hero blends into the page without an edge
  const v = document.createElement('canvas')
  v.width = W
  v.height = H
  const vg = v.getContext('2d')
  gr = vg.createRadialGradient(W / 2, H * 0.35, Math.min(W, H) * 0.35, W / 2, H * 0.35, Math.max(W, H) * 0.75)
  gr.addColorStop(0, 'rgba(60,62,68,0)')
  gr.addColorStop(1, 'rgba(60,62,68,0.35)')
  vg.fillStyle = gr
  vg.fillRect(0, 0, W, H)
  vg.globalCompositeOperation = 'destination-in'
  gr = vg.createLinearGradient(0, 0, 0, ground)
  gr.addColorStop(0, 'rgba(0,0,0,1)')
  gr.addColorStop(0.6, 'rgba(0,0,0,1)')
  gr.addColorStop(1, 'rgba(0,0,0,0)')
  vg.fillStyle = gr
  vg.fillRect(0, 0, W, H)
  g.drawImage(v, 0, 0)
}

// ---------- 2. red wordmark ----------
function paintWord(cv, L) {
  const g = cv.getContext('2d')
  const text = 'COOL KIDS'
  let size = L.H * 0.26
  g.font = `800 ${size}px Unbounded, sans-serif`
  size = Math.min(size, (size * L.W * (L.portrait ? 0.92 : 0.84)) / g.measureText(text).width)
  g.font = `800 ${size}px Unbounded, sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'alphabetic'
  // the car's roof covers the lower part of the letters
  const y = L.ground - L.carH * (L.portrait ? 0.8 : 0.5)
  const x = L.W / 2
  const gr = g.createLinearGradient(0, y - size * 0.75, 0, y)
  gr.addColorStop(0, '#ff5a4f')
  gr.addColorStop(0.55, '#e2362c')
  gr.addColorStop(1, '#b8231a')
  g.fillStyle = gr
  g.fillText(text, x, y)
  // thin top highlight for a slightly glossy letter
  g.save()
  g.globalCompositeOperation = 'source-atop'
  const hl = g.createLinearGradient(0, y - size * 0.75, 0, y - size * 0.55)
  hl.addColorStop(0, 'rgba(255,255,255,0.45)')
  hl.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = hl
  g.fillRect(0, y - size * 0.8, L.W, size * 0.3)
  g.restore()

  const small = Math.max(11, size * 0.075)
  g.font = `500 ${small}px Unbounded, sans-serif`
  if ('letterSpacing' in g) g.letterSpacing = `${small * 0.6}px`
  g.fillStyle = '#3a3b40'
  g.fillText('CAR RENTAL · BANGKOK', x, y - size * 0.9)
}

function resize() {
  const cvs = [stageCv.value, wordCv.value, carCv.value]
  if (cvs.some((c) => !c) || !meta) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const scale = Math.min(dpr, 3840 / Math.max(1, cvs[0].clientWidth))
  for (const c of cvs) {
    c.width = Math.round(c.clientWidth * scale)
    c.height = Math.round(c.clientHeight * scale)
  }
  const L = layout(cvs[0].width, cvs[0].height)
  paintStage(cvs[0], L)
  paintWord(cvs[1], L)
  draw()
  readScroll()
}

// ---------- 3. car (per frame) ----------
function drawCar(g, L, x, angle) {
  const { k, carW, carH, ground } = L
  const top = ground - carH
  g.drawImage(body, x, top, carW, carH)
  meta.wheels.forEach((w, i) => {
    const r = w.r * k
    g.save()
    g.translate(x + w.cx * k, top + w.cy * k)
    g.rotate(angle)
    g.drawImage(wheels[i], -r, -r, r * 2, r * 2)
    g.restore()
  })
}

function draw() {
  const c = carCv.value
  if (!c || !body || !c.width) return
  const ctx = c.getContext('2d')
  const L = layout(c.width, c.height)
  const { W, H, carW, ground, k } = L

  const drive = easeOut(clamp(shown / PARK_AT))
  const x = L.startX + (L.parkX - L.startX) * drive
  // roll without slipping: angle = distance / radius (wheel radius in canvas px)
  const angle = (x - L.startX) / (meta.wheels[0].r * k)

  ctx.clearRect(0, 0, W, H)

  // floor reflection: the mirrored car, faded to transparent with a gradient mask
  const rh = Math.ceil(L.carH * 0.55)
  refl ??= document.createElement('canvas')
  if (refl.width !== W || refl.height !== rh) {
    refl.width = W
    refl.height = rh
  }
  const rg = refl.getContext('2d')
  rg.globalCompositeOperation = 'source-over'
  rg.clearRect(0, 0, W, rh)
  rg.save()
  rg.scale(1, -1) // band y = ground − car y
  rg.translate(0, -ground)
  drawCar(rg, L, x, -angle)
  rg.restore()
  rg.globalCompositeOperation = 'destination-in'
  const mask = rg.createLinearGradient(0, 0, 0, rh)
  mask.addColorStop(0, 'rgba(0,0,0,1)')
  mask.addColorStop(1, 'rgba(0,0,0,0)')
  rg.fillStyle = mask
  rg.fillRect(0, 0, W, rh)
  ctx.globalAlpha = 0.14
  ctx.drawImage(refl, 0, ground)
  ctx.globalAlpha = 1

  // contact shadow
  ctx.save()
  const sh = ctx.createRadialGradient(0, 0, 0, 0, 0, carW * 0.55)
  sh.addColorStop(0, 'rgba(20,20,26,0.5)')
  sh.addColorStop(0.7, 'rgba(20,20,26,0.15)')
  sh.addColorStop(1, 'rgba(20,20,26,0)')
  ctx.translate(x + carW / 2, ground - L.carH * 0.02)
  ctx.scale(1, 0.06)
  ctx.fillStyle = sh
  ctx.fillRect(-carW, -carW, carW * 2, carW * 2)
  ctx.restore()

  drawCar(ctx, L, x, angle)
}

function readScroll() {
  const el = root.value
  if (!el || reduced) return
  const r = el.getBoundingClientRect()
  const span = r.height - window.innerHeight
  if (span > 0) progress.value = clamp(-r.top / span) // not laid out yet → keep the current value
  if (!raf && body) raf = requestAnimationFrame(loop)
}

// Eases the drawn position towards the scroll position; idles once settled.
function loop() {
  const t = progress.value
  shown = Math.abs(t - shown) < 0.0004 ? t : shown + (t - shown) * 0.16
  draw()
  raf = shown === t ? 0 : requestAnimationFrame(loop)
}

let ro
onMounted(async () => {
  window.addEventListener('scroll', readScroll, { passive: true })
  readScroll()
  await Promise.all([load(), document.fonts?.load('800 40px Unbounded').catch(() => {})])
  ro = new ResizeObserver(resize)
  ro.observe(stageCv.value)
  resize()
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
  <section ref="root" class="drive" :class="{ still: reduced }">
    <div class="pin">
      <canvas ref="stageCv" class="layer" aria-hidden="true" />
      <canvas ref="wordCv" class="layer word" aria-hidden="true" />
      <canvas ref="carCv" class="layer" role="img" :aria-label="alt" />
      <button v-if="!reduced" type="button" class="hint" :class="{ gone: progress > 0.03 }" @click="skip">
        <span class="mouse"><i /></span>
        {{ tr('home.scrollStart') }}
      </button>
      <div class="bar" :class="{ gone: progress >= PARK_AT }" aria-hidden="true">
        <i :style="{ transform: `scaleX(${Math.min(1, progress / PARK_AT)})` }" />
      </div>
      <slot :progress="progress" :done="progress > PARK_AT" />
    </div>
  </section>
</template>

<style scoped>
.drive {
  position: relative;
  height: 260vh; /* scroll distance for the drive-in + a short parked hold */
  background: #f3f3f1; /* = PAGE_BG */
}
.drive.still {
  height: 100svh;
}
.pin {
  position: sticky;
  top: 0;
  height: 100svh;
  overflow: hidden;
  isolation: isolate;
}
.layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
/* the wordmark breathes: slow fade between dim and full red with a soft glow */
.word {
  animation: pulse 3.2s ease-in-out infinite;
}
@keyframes pulse {
  0%,
  100% {
    opacity: 0.55;
    filter: drop-shadow(0 0 0 rgb(226 54 44 / 0));
  }
  50% {
    opacity: 1;
    filter: drop-shadow(0 0 28px rgb(226 54 44 / 0.45));
  }
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
  color: #2b2c31;
  font-size: 0.8rem;
  letter-spacing: 0.08em;
  cursor: pointer;
  transition:
    opacity 0.4s ease,
    transform 0.4s ease;
}
.hint.gone {
  opacity: 0;
  transform: translate(-50%, 12px);
  pointer-events: none;
}
.mouse {
  width: 24px;
  height: 38px;
  border: 1.5px solid currentColor;
  border-radius: 14px;
  display: grid;
  justify-items: center;
  padding-top: 7px;
}
.mouse i {
  width: 3px;
  height: 8px;
  border-radius: 2px;
  background: currentColor;
  animation: wheel 1.6s ease-in-out infinite;
}
.bar {
  position: absolute;
  left: 50%;
  bottom: 1rem;
  width: 120px;
  height: 3px;
  border-radius: 2px;
  transform: translateX(-50%);
  background: rgb(0 0 0 / 0.1);
  overflow: hidden;
  transition: opacity 0.5s ease;
}
.bar.gone {
  opacity: 0;
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
@media (prefers-reduced-motion: reduce) {
  .word {
    animation: none;
  }
}
</style>
