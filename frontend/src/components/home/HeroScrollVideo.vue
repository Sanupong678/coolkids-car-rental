<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from '@/i18n'
import { ambientTargets } from '@/composables/ambient'

// Full-bleed hero video driven by the scroll wheel (reference: "A website makes it real").
// The section is tall and its stage is sticky: scrolling down scrubs the clip
// forward, scrolling up rewinds it. The clip ends at 82% of the pinned scroll and
// then holds on its last frame while the headline, the LINE button and the search
// bar (slot) rise in.
// Ambient light: the colour along the frame's bottom edge is sampled into the
// CSS variable --amb (the stage feathers into it and the next section starts
// from it), and a blurred, mirrored copy of the frame is painted below the stage
// so the footage's light spills onto the page instead of stopping at a hard edge.
// The clip is encoded with a keyframe every 2 frames so seeking stays instant.
// Reduced motion: no pin, last frame and copy shown at once.
// Phones (iOS Safari above all) don't draw frames of a video that has never played,
// so seeking alone left the stage blank: the clip is started and paused right away
// once. If the browser refuses (Low Power Mode, data saver) the hero falls back to
// the still layout over the poster.
const props = defineProps({
  src: { type: String, required: true },
  poster: { type: String, default: null },
  line: { type: String, default: null }, // LINE booking URL
  headline: { type: String, default: null }, // CMS headline (Thai)
})
const { t, tc } = useI18n()

const END = 0.82 // share of the pinned scroll that plays the clip; the rest holds the last frame
const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const root = ref(null)
const video = ref(null)
const glow = ref(null)
const still = ref(reduced)
const progress = ref(reduced ? 1 : 0)
const ended = ref(reduced)

let shown = 0 // eased progress actually on screen
let raf = 0
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x))

function readScroll() {
  const el = root.value
  if (!el || still.value) return
  const r = el.getBoundingClientRect()
  const span = r.height - window.innerHeight
  if (span > 0) progress.value = clamp(-r.top / span)
}

// Paint the current frame, tiny, into the glow canvas (CSS blurs and stretches it).
let gctx = null
function paintGlow() {
  const v = video.value
  const c = glow.value
  if (!v || !c || v.readyState < 2) return
  gctx ??= c.getContext('2d', { willReadFrequently: true })
  // mirrored, so the frame's bottom edge meets the stage's bottom edge
  gctx.setTransform(1, 0, 0, -1, 0, c.height)
  gctx.drawImage(v, 0, 0, c.width, c.height)
  const d = gctx.getImageData(0, 0, c.width, 4).data
  let r = 0, g = 0, b = 0
  for (let i = 0; i < d.length; i += 4) {
    r += d[i]
    g += d[i + 1]
    b += d[i + 2]
  }
  const n = d.length / 4
  // a touch darker than the raw edge, matching the stage's bottom shade
  for (const t of ambientTargets) t.getContext('2d').drawImage(v, 0, 0, t.width, t.height)
  document.documentElement.style.setProperty('--amb', `rgb(${(r / n) * 0.8} ${(g / n) * 0.8} ${(b / n) * 0.82})`)
}

function loop() {
  const v = video.value
  const target = progress.value
  shown = Math.abs(target - shown) < 0.0004 ? target : shown + (target - shown) * 0.16
  if (v && v.duration && !v.seeking) {
    const time = clamp(shown / END) * (v.duration - 0.04)
    if (Math.abs(v.currentTime - time) > 1 / 60) v.currentTime = time
  }
  ended.value = shown >= END - 0.005
  raf = requestAnimationFrame(loop)
}

function onReady() {
  const v = video.value
  if (!v) return
  if (still.value) v.currentTime = v.duration - 0.04
  paintGlow()
}

onMounted(() => {
  const v = video.value
  v?.addEventListener('seeked', paintGlow)
  v?.addEventListener('loadeddata', onReady)
  if (v && v.readyState >= 2) onReady()
  if (reduced) return
  v?.play()
    .then(() => v.pause())
    .catch(() => {
      // can't play here: show the poster and the copy, no pin
      still.value = true
      progress.value = 1
      ended.value = true
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', readScroll)
      window.removeEventListener('resize', readScroll)
    })
  window.addEventListener('scroll', readScroll, { passive: true })
  window.addEventListener('resize', readScroll)
  readScroll()
  shown = progress.value
  raf = requestAnimationFrame(loop)
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', readScroll)
  window.removeEventListener('resize', readScroll)
  video.value?.removeEventListener('seeked', paintGlow)
  video.value?.removeEventListener('loadeddata', onReady)
  cancelAnimationFrame(raf)
})

// "Scroll to play" hint: jump straight to the end of the clip.
function skip() {
  const el = root.value
  window.scrollTo({ top: el.offsetTop + (el.offsetHeight - window.innerHeight) * (END + 0.02), behavior: 'smooth' })
}
const lines = () => tc(props.headline, 'hero.title').replace(/ (?=สำหรับ)/, '\n').split('\n')
</script>

<template>
  <section ref="root" class="sv" :class="{ still, ended }">
    <canvas ref="glow" class="glow" width="48" height="27" aria-hidden="true" />

    <div class="pin">
      <div class="stage">
      <video
        ref="video"
        class="bg"
        :src="props.src"
        :poster="props.poster"
        muted
        playsinline
        preload="auto"
        disablepictureinpicture
        aria-hidden="true"
        tabindex="-1"
      />
      <span class="shade" aria-hidden="true" />
      </div>

      <!-- copy and search stack from the bottom edge, so they never overlap -->
      <div class="dock">
      <div class="container copy">
        <span class="kicker"><i /> {{ t('hero.kicker') }}</span>
        <h1>
          <span v-for="(l, i) in lines()" :key="l" class="ln"><span :style="{ transitionDelay: `${120 + i * 110}ms` }">{{ l }}</span></span>
        </h1>
        <div class="act">
          <a v-if="line" :href="line" target="_blank" rel="noopener" class="cta">{{ t('hero.cta') }}</a>
          <p>{{ t('hero.body') }}<br />{{ t('hero.sub') }}</p>
        </div>
      </div>

      <div class="search"><slot /></div>
      </div>

      <button v-if="!still" type="button" class="hint" :class="{ gone: progress > 0.03 }" @click="skip">
        <span class="mouse"><i /></span>
        {{ t('hero.hint') }}
      </button>
      <div v-if="!still" class="bar" aria-hidden="true"><i :style="{ transform: `scaleX(${Math.min(1, progress / END)})` }" /></div>
    </div>
  </section>
</template>

<style scoped>
.sv {
  position: relative;
  z-index: 1; /* the glow hangs over the top of the next section */
  height: 260vh; /* scroll distance: the clip plays over the first 82% of the pin */
  isolation: isolate;
}
.sv.still {
  height: auto;
}
.pin {
  position: sticky;
  top: 0;
  height: 100svh;
  min-height: 600px;
  overflow: hidden;
  color: #fff;
  background: var(--amb, #2a2b2e);
}
/* footage, feathered at the bottom into the sampled ambient colour */
.stage {
  position: absolute;
  inset: 0;
  -webkit-mask-image: linear-gradient(180deg, #000 72%, transparent 100%);
  mask-image: linear-gradient(180deg, #000 72%, transparent 100%);
}
.still .pin {
  position: relative;
}
.bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 60% 50%;
}
.shade {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(180deg, rgb(10 11 15 / 0.45) 0%, transparent 18%),
    linear-gradient(0deg, rgb(10 11 15 / 0.7) 0%, transparent 55%),
    linear-gradient(90deg, rgb(10 11 15 / 0.45) 0%, transparent 60%);
  opacity: 0.35;
  transition: opacity 0.9s var(--ease-out);
  pointer-events: none;
}
.ended .shade {
  opacity: 1;
}

/* ambient light: the current frame, blurred, spilling below the stage */
.glow {
  position: absolute;
  z-index: -1;
  left: -10%;
  width: 120%;
  top: 100%;
  height: 60vh;
  filter: blur(56px) saturate(1.6);
  opacity: 0.85;
  /* fades in just below the seam (which is the flat --amb), then out */
  -webkit-mask-image: linear-gradient(180deg, transparent 0%, #000 20%, rgb(0 0 0 / 0.4) 55%, transparent 100%);
  mask-image: linear-gradient(180deg, transparent 0%, #000 20%, rgb(0 0 0 / 0.4) 55%, transparent 100%);
  pointer-events: none;
}

/* copy: hidden while the clip plays, rises in on the held last frame */
.dock {
  position: absolute;
  inset: auto 0 clamp(1.25rem, 4vh, 2.5rem);
  display: grid;
  gap: clamp(1.5rem, 5vh, 3.25rem);
}
.copy {
  display: grid;
  gap: clamp(1rem, 2.4vh, 1.6rem);
  justify-items: start;
}
.kicker {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: var(--fs-xs);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: rgb(255 255 255 / 0.75);
}
.kicker i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 12px var(--accent);
}
h1 {
  display: grid;
  font-size: clamp(2.6rem, 1rem + 5.6vw, 6.4rem);
  font-weight: 600;
  line-height: 1.04;
  letter-spacing: -0.02em;
  text-shadow: 0 2px 30px rgb(0 0 0 / 0.25);
}
.ln {
  display: block;
  overflow: hidden;
  padding-bottom: 0.08em; /* room for Thai descenders */
}
.ln > span {
  display: block;
  transform: translateY(105%);
  transition: transform 0.9s var(--ease-out);
}
.act {
  display: flex;
  align-items: center;
  gap: clamp(1rem, 2vw, 1.75rem);
  flex-wrap: wrap;
}
.cta {
  display: inline-flex;
  align-items: center;
  height: 52px;
  padding: 0 1.9rem;
  background: #fff;
  color: #111;
  font-size: var(--fs-sm);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  transition:
    background var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
}
.cta:hover {
  background: #ececec;
}
.act p {
  font-size: var(--fs-sm);
  line-height: 1.5;
  color: rgb(255 255 255 / 0.82);
}
.kicker,
.act {
  opacity: 0;
  transform: translateY(16px);
  transition:
    opacity 0.7s var(--ease-out),
    transform 0.7s var(--ease-out);
}
.act {
  transition-delay: 0.45s;
}
.search {
  opacity: 0;
  transform: translateY(24px);
  transition:
    opacity 0.8s var(--ease-out) 0.6s,
    transform 0.8s var(--ease-out) 0.6s;
}
.sv:not(.ended) .copy,
.sv:not(.ended) .search {
  pointer-events: none;
}
.ended .ln > span {
  transform: none;
}
.ended .kicker,
.ended .act,
.ended .search {
  opacity: 1;
  transform: none;
}
/* rewinding hides the copy quickly, without the stagger */
.sv:not(.ended) .ln > span,
.sv:not(.ended) .kicker,
.sv:not(.ended) .act,
.sv:not(.ended) .search {
  transition-duration: 0.35s;
  transition-delay: 0s !important;
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
  color: rgb(255 255 255 / 0.85);
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
  border: 1.5px solid rgb(255 255 255 / 0.75);
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
  top: 64px;
  height: 2px;
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
@media (max-width: 860px) {
  .bg {
    object-position: 62% 50%;
  }
}
@media (max-width: 560px) {
  .dock {
    gap: 1.25rem;
  }
  .cta {
    height: 46px;
    padding: 0 1.4rem;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ln > span,
  .kicker,
  .act,
  .search,
  .shade {
    transition: none !important;
  }
}
</style>
