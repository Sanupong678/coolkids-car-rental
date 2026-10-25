<script setup>
import { t as tr } from '@/i18n'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

// Hero motion graphic, pure SVG + CSS (no video, ~0 KB of assets):
//   1. a two-tone family crossover drives in from the left, wheels rolling
//   2. it brakes (tail lights flare, nose dips), the headlights flicker on
//   3. the front door swings open, cabin glows, a puddle lamp projects the logo
//   4. the giant "COOL KIDS" wordmark behind the car fills in
// Everything is keyed off one timeline in the <style> block. Remount the
// component (change its :key) to replay. Reduced-motion users get the final frame.
defineProps({ still: { type: Boolean, default: false } })

// Deterministic skyline so SSR/CSR and replays look identical.
function rng(seed) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
}
const r = rng(7)
const buildings = []
for (let x = -20; x < 1620; ) {
  const w = 34 + Math.round(r() * 70)
  const h = 40 + Math.round(r() * (x > 520 && x < 1080 ? 110 : 170))
  const windows = []
  for (let wy = 500 - h + 12; wy < 488; wy += 14) {
    for (let wx = x + 6; wx < x + w - 8; wx += 11) {
      if (r() < 0.22) windows.push({ x: wx, y: wy, d: (r() * 6).toFixed(2), tw: r() < 0.25 })
    }
  }
  buildings.push({ x, w, h, windows })
  x += w + 2 + Math.round(r() * 8)
}

// Perspective floor lines towards a vanishing point on the horizon.
const floorLines = Array.from({ length: 17 }, (_, i) => -2400 + i * 300)

// Narrow screens: crop the scene to the car instead of shrinking it.
const narrow = ref(false)
let mq
const sync = () => (narrow.value = mq.matches)
onMounted(() => {
  mq = window.matchMedia('(max-width: 720px)')
  sync()
  mq.addEventListener('change', sync)
})
onBeforeUnmount(() => mq?.removeEventListener('change', sync))
const viewBox = computed(() => (narrow.value ? '330 90 940 580' : '0 0 1600 900'))
</script>

<template>
  <svg
    class="stage"
    :class="{ still }"
    :viewBox="viewBox"
    :preserveAspectRatio="narrow ? 'xMidYMid meet' : 'xMidYMid slice'"
    role="img"
    :aria-label="tr('home.driveInAlt')"
  >
    <defs>
      <linearGradient id="ck-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#090b12" />
        <stop offset="0.45" stop-color="#141826" />
        <stop offset="0.55" stop-color="#1e2232" />
        <stop offset="0.56" stop-color="#11131b" />
        <stop offset="1" stop-color="#07080c" />
      </linearGradient>
      <radialGradient id="ck-horizon" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#e2362c" stop-opacity="0.32" />
        <stop offset="0.5" stop-color="#7a2a3a" stop-opacity="0.12" />
        <stop offset="1" stop-color="#000" stop-opacity="0" />
      </radialGradient>
      <linearGradient id="ck-title" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ff5a4f" />
        <stop offset="0.55" stop-color="#e2362c" />
        <stop offset="1" stop-color="#e2362c" stop-opacity="0.15" />
      </linearGradient>
      <linearGradient id="ck-paint" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="256">
        <stop offset="0" stop-color="#ffffff" />
        <stop offset="0.42" stop-color="#eef0f4" />
        <stop offset="0.7" stop-color="#cfd4dc" />
        <stop offset="1" stop-color="#8e95a2" />
      </linearGradient>
      <linearGradient id="ck-glass" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2a3142" />
        <stop offset="1" stop-color="#0a0c12" />
      </linearGradient>
      <radialGradient id="ck-rim" cx="0.4" cy="0.35" r="0.7">
        <stop offset="0" stop-color="#f4f6f9" />
        <stop offset="0.6" stop-color="#a9afba" />
        <stop offset="1" stop-color="#5d636e" />
      </radialGradient>
      <linearGradient id="ck-beam" gradientUnits="userSpaceOnUse" x1="806" y1="0" x2="1380" y2="0">
        <stop offset="0" stop-color="#fffaf0" stop-opacity="0.6" />
        <stop offset="0.35" stop-color="#fff6e0" stop-opacity="0.18" />
        <stop offset="1" stop-color="#fff6e0" stop-opacity="0" />
      </linearGradient>
      <radialGradient id="ck-pool" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#fff8e8" stop-opacity="0.38" />
        <stop offset="1" stop-color="#fff8e8" stop-opacity="0" />
      </radialGradient>
      <radialGradient id="ck-puddle" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#ff5a4f" stop-opacity="0.55" />
        <stop offset="1" stop-color="#ff5a4f" stop-opacity="0" />
      </radialGradient>
      <radialGradient id="ck-cabin" cx="0.55" cy="0.45" r="0.6">
        <stop offset="0" stop-color="#ff6a5f" stop-opacity="0.55" />
        <stop offset="1" stop-color="#ff6a5f" stop-opacity="0" />
      </radialGradient>
      <linearGradient id="ck-reflect-fade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity="0.22" />
        <stop offset="0.45" stop-color="#fff" stop-opacity="0" />
      </linearGradient>
      <mask id="ck-reflect-mask" maskUnits="userSpaceOnUse" x="0" y="560" width="1600" height="340">
        <rect x="0" y="560" width="1600" height="340" fill="url(#ck-reflect-fade)" />
      </mask>
      <clipPath id="ck-body-clip">
        <path id="ck-body-shape" d="M22 250 C12 220 10 170 18 140 C22 122 28 112 36 104 L72 40 C84 20 104 12 136 10 L440 4 C476 4 500 14 520 30 L598 112 C680 118 748 128 784 146 C806 158 814 180 814 206 C814 226 810 244 800 252 L712 254 A82 82 0 0 0 548 254 L222 254 A82 82 0 0 0 58 254 L40 254 C32 254 26 254 22 250 Z" />
      </clipPath>
      <filter id="ck-glow" x="-50%" y="-200%" width="200%" height="500%">
        <feGaussianBlur stdDeviation="5" result="b" />
        <feMerge><feMergeNode in="b" /><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <filter id="ck-soft" x="-20%" y="-200%" width="140%" height="500%">
        <feGaussianBlur stdDeviation="9" />
      </filter>

      <!-- Wheel: dark machined rim, silver spokes, brand-red centre cap -->
      <g id="ck-wheel">
        <circle r="60" fill="#101116" />
        <circle r="55" fill="none" stroke="#24262d" stroke-width="3" />
        <circle r="41" fill="#2a2d35" />
        <g fill="url(#ck-rim)">
          <path v-for="a in [0, 72, 144, 216, 288]" :key="a" :transform="`rotate(${a})`" d="M-7 -9 L7 -9 L5 -40 L-5 -40 Z" />
        </g>
        <circle r="40" fill="none" stroke="#b9bec8" stroke-width="2" opacity="0.55" />
        <circle r="10" fill="#e2362c" />
        <circle r="3.5" fill="#fff" opacity="0.8" />
      </g>
    </defs>

    <!-- ===== Backdrop ===== -->
    <rect x="-400" y="0" width="2400" height="900" fill="url(#ck-sky)" />
    <ellipse cx="800" cy="500" rx="900" ry="190" fill="url(#ck-horizon)" />
    <g class="city">
      <g v-for="(b, i) in buildings" :key="i">
        <rect :x="b.x" :y="500 - b.h" :width="b.w" :height="b.h" fill="#121522" />
        <rect
          v-for="(w, j) in b.windows"
          :key="j"
          :x="w.x"
          :y="w.y"
          width="4"
          height="6"
          :class="{ tw: w.tw }"
          :style="{ animationDelay: `${w.d}s` }"
          fill="#ffd9a0"
          opacity="0.5"
        />
      </g>
    </g>

    <!-- Wordmark behind the car (Taycan-style outline that fills) -->
    <text class="tagline" x="800" y="128" text-anchor="middle">CAR RENTAL · BANGKOK</text>
    <g class="title">
      <text class="title-outline" x="800" y="336" text-anchor="middle" textLength="1460" lengthAdjust="spacingAndGlyphs">COOL KIDS</text>
      <text class="title-fill" x="800" y="336" text-anchor="middle" textLength="1460" lengthAdjust="spacingAndGlyphs">COOL KIDS</text>
    </g>

    <!-- Floor -->
    <rect x="-400" y="500" width="2400" height="400" fill="#0b0c12" />
    <g class="floor-lines" stroke="#ffffff" stroke-opacity="0.05">
      <line v-for="x in floorLines" :key="x" x1="800" y1="500" :x2="x" y2="900" />
      <line x1="-400" y1="500" x2="2000" y2="500" stroke-opacity="0.12" />
    </g>
    <g class="lanes">
      <rect v-for="i in 12" :key="i" :x="(i - 1) * 170" y="650" width="90" height="4" rx="2" fill="#fff" opacity="0.12" />
    </g>
    <g class="streaks" stroke="#fff" stroke-linecap="round">
      <line x1="0" y1="470" x2="420" y2="470" stroke-opacity="0.2" />
      <line x1="140" y1="512" x2="380" y2="512" stroke-opacity="0.14" />
      <line x1="40" y1="540" x2="520" y2="540" stroke-opacity="0.18" />
      <line x1="60" y1="430" x2="260" y2="430" stroke-opacity="0.1" />
    </g>

    <!-- ===== The car ===== -->
    <use href="#ck-car" transform="translate(0 1120) scale(1 -1)" mask="url(#ck-reflect-mask)" class="reflection" />
    <g id="ck-car" transform="translate(392 260)">
      <g class="drive">
        <!-- light that belongs to the car -->
        <g class="beam">
          <polygon points="806,152 1500,10 1500,340 806,172" fill="url(#ck-beam)" />
          <ellipse cx="1040" cy="302" rx="300" ry="22" fill="url(#ck-pool)" />
        </g>
        <ellipse cx="420" cy="302" rx="420" ry="16" fill="#000" opacity="0.75" filter="url(#ck-soft)" />
        <g class="puddle" transform="translate(470 314) scale(1 0.26)">
          <circle r="130" fill="url(#ck-puddle)" />
          <text y="12" text-anchor="middle" class="puddle-text">COOLKIDS</text>
        </g>

        <g class="body">
          <!-- body shell -->
          <use href="#ck-body-shape" fill="url(#ck-paint)" />
          <g clip-path="url(#ck-body-clip)">
            <rect x="0" y="226" width="840" height="44" fill="#1b1d23" />
            <path d="M30 152 C250 142 520 146 812 170" fill="none" stroke="#fff" stroke-width="2.5" opacity="0.85" />
            <path d="M30 156 C250 146 520 150 812 174" fill="none" stroke="#7d8492" stroke-width="1.5" opacity="0.55" />
            <rect x="0" y="0" width="840" height="26" fill="#fff" opacity="0.2" />
          </g>
          <path d="M54 254 A86 86 0 0 1 226 254 M544 254 A86 86 0 0 1 716 254" fill="none" stroke="#1b1d23" stroke-width="12" />
          <!-- black roof, rails, spoiler -->
          <path d="M78 44 C90 26 106 18 134 16 L440 10 C472 10 494 20 512 34" fill="none" stroke="#15171d" stroke-width="12" stroke-linecap="round" />
          <path d="M150 2 L420 -2" stroke="#2c2f37" stroke-width="5" stroke-linecap="round" />
          <path d="M58 50 L100 36" stroke="#15171d" stroke-width="8" stroke-linecap="round" />
          <!-- glass -->
          <path d="M52 108 L78 50 C88 32 104 24 132 22 L436 16 C468 16 490 26 508 40 L588 122 Z" fill="url(#ck-glass)" />
          <polygon points="220,24 270,24 214,118 164,118" fill="#fff" opacity="0.06" />
          <polygon points="150,24 168,24 160,112 138,112" fill="#15171d" />
          <rect x="326" y="17" width="13" height="106" fill="#15171d" />
          <!-- rear door seam + handle + decal -->
          <path d="M160 112 C156 150 158 196 170 230" fill="none" stroke="#8b919c" stroke-width="1.5" />
          <rect x="282" y="146" width="34" height="7" rx="3.5" fill="#bfc4cc" />
          <text x="196" y="208" class="decal">coolkids</text>
          <!-- lights -->
          <path class="tail" d="M20 138 C30 130 44 124 60 120 L58 130 C44 134 32 140 22 148 Z" />
          <path d="M806 178 C814 190 816 214 812 240 L794 240 C798 216 796 196 790 182 Z" fill="#15171d" />
          <path class="head" d="M736 136 C762 140 786 148 806 160 L802 168 C782 160 760 154 734 148 Z" />
          <line class="drl" x1="776" y1="214" x2="808" y2="214" stroke-width="3.5" stroke-linecap="round" />
          <circle class="flare" cx="800" cy="161" r="10" fill="#fffaf0" filter="url(#ck-glow)" />
          <!-- cabin behind the front door -->
          <g class="cabin">
            <path d="M332 18 L436 16 C468 16 490 26 508 40 L600 124 C604 160 602 196 586 232 L332 232 Z" fill="#08090d" />
            <path d="M350 232 L350 140 C350 108 362 90 382 88 C400 88 408 100 408 120 L404 190 L472 196 L476 232 Z" fill="#22252e" />
            <ellipse cx="540" cy="132" rx="8" ry="30" fill="none" stroke="#3a3e4a" stroke-width="6" />
            <path class="cabin-glow" d="M332 18 L436 16 C468 16 490 26 508 40 L600 124 C604 160 602 196 586 232 L332 232 Z" fill="url(#ck-cabin)" />
          </g>
          <!-- front door (opens) -->
          <g class="door">
            <path d="M332 18 L436 16 C468 16 490 26 508 40 L600 124 C604 160 602 196 586 232 L332 232 Z" fill="url(#ck-paint)" />
            <path d="M340 22 L434 20 C464 20 486 30 502 44 L584 122 L340 122 Z" fill="url(#ck-glass)" />
            <path d="M332 150 L598 156" stroke="#fff" stroke-width="2.5" opacity="0.85" />
            <rect x="332" y="226" width="256" height="7" fill="#1b1d23" />
            <rect x="516" y="148" width="34" height="7" rx="3.5" fill="#bfc4cc" />
            <path class="door-shade" d="M332 18 L436 16 C468 16 490 26 508 40 L600 124 C604 160 602 196 586 232 L332 232 Z" fill="#0b0c12" />
          </g>
          <path d="M584 108 C596 98 616 98 624 108 L622 120 C608 122 594 122 584 118 Z" fill="#15171d" />
        </g>

        <g v-for="x in [140, 630]" :key="x" :transform="`translate(${x} 240)`">
          <g class="wheel"><use href="#ck-wheel" /></g>
        </g>
      </g>
    </g>
  </svg>
</template>

<style scoped>
/*
 * Timeline (seconds)
 * 0.3 ─ 2.9  drive in, wheels roll, speed streaks
 * 2.5 ─ 3.6  brake lights flare, nose dips
 * 3.1 ─ 3.8  headlights flicker on → beam
 * 4.2 ─ 5.2  front door opens, cabin glow, puddle-lamp logo
 * 0.6 ─ 6.0  wordmark draws (outline) then fills
 */
.stage {
  display: block;
  width: 100%;
  height: 100%;
  font-family: 'Unbounded', 'Inter', sans-serif;
}

/* ---- drive in ---- */
.drive {
  animation: drive 2.6s cubic-bezier(0.12, 0.72, 0.28, 1) 0.3s both;
}
.wheel {
  transform-box: fill-box;
  transform-origin: center;
  animation: roll 2.6s cubic-bezier(0.12, 0.72, 0.28, 1) 0.3s both;
}
.body {
  transform-box: fill-box;
  transform-origin: 80% 100%;
  animation: settle 0.9s ease-out 2.75s both;
}
.streaks line {
  animation: streak 0.5s linear 0.3s 5 both;
}
.streaks {
  animation: fade-out 0.6s ease-out 2.4s both;
}
.lanes {
  animation: lanes 2.6s cubic-bezier(0.12, 0.72, 0.28, 1) 0.3s both;
}

/* ---- lights ---- */
.tail {
  fill: #5a1714;
  animation: brake 1.3s ease-out 2.4s both;
}
.head {
  fill: #3a3d46;
  animation: head-on 0.8s steps(1, end) 3.1s both;
}
.drl {
  stroke: #4a4d56;
  animation: drl-on 0.8s steps(1, end) 3.1s both;
}
.flare {
  opacity: 0;
  animation: flare-on 0.8s steps(1, end) 3.1s both;
}
.beam {
  opacity: 0;
  animation:
    fade-in 0.9s ease-out 3.6s both,
    shimmer 4s ease-in-out 4.6s infinite;
}

/* ---- door ---- */
.door {
  transform-box: fill-box;
  transform-origin: 100% 45%;
  animation: door-open 1.1s cubic-bezier(0.6, 0, 0.25, 1) 4.2s both;
}
.door-shade {
  opacity: 0;
  animation: shade 1.1s ease-in-out 4.2s both;
}
.cabin-glow {
  opacity: 0;
  animation: fade-in 0.8s ease-out 4.8s both;
}
.puddle {
  opacity: 0;
  animation:
    fade-in 0.8s ease-out 5s both,
    pulse 3s ease-in-out 6s infinite;
}
.puddle-text {
  font-family: 'Unbounded', sans-serif;
  font-weight: 800;
  font-size: 34px;
  fill: #ff7a70;
}
.decal {
  font-family: 'Unbounded', sans-serif;
  font-weight: 700;
  font-size: 15px;
  fill: #e2362c;
  letter-spacing: 0.04em;
}

/* ---- wordmark ---- */
.title text {
  font-family: 'Unbounded', sans-serif;
  font-weight: 800;
  font-size: 220px;
}
.title-outline {
  fill: none;
  stroke: rgb(255 255 255 / 0.42);
  stroke-width: 1.6;
  stroke-dasharray: 1400;
  stroke-dashoffset: 1400;
  animation: draw 3s ease-in-out 0.6s both;
}
.title-fill {
  fill: url(#ck-title);
  opacity: 0;
  animation: title-fill 1.2s ease-out 4.8s both;
}
.tagline {
  font-family: 'Unbounded', sans-serif;
  font-weight: 500;
  font-size: 22px;
  letter-spacing: 0.55em;
  fill: #fff;
  opacity: 0;
  animation: fade-in 1s ease-out 5.4s both;
}

/* ---- ambience ---- */
.reflection {
  opacity: 0.9;
}
.tw {
  animation: twinkle 3.2s ease-in-out infinite;
}

@keyframes drive {
  from {
    transform: translateX(-1500px);
  }
}
@keyframes roll {
  from {
    transform: rotate(-1432deg);
  }
}
@keyframes lanes {
  from {
    transform: translateX(1020px);
  }
}
@keyframes streak {
  from {
    transform: translateX(600px);
  }
  to {
    transform: translateX(-500px);
  }
}
@keyframes settle {
  0% {
    transform: rotate(0);
  }
  35% {
    transform: rotate(0.7deg);
  }
  70% {
    transform: rotate(-0.2deg);
  }
  100% {
    transform: rotate(0);
  }
}
@keyframes brake {
  0% {
    fill: #5a1714;
  }
  25% {
    fill: #ff3b30;
    filter: url(#ck-glow);
  }
  100% {
    fill: #c3271f;
  }
}
@keyframes head-on {
  0%,
  30% {
    fill: #fffaf0;
  }
  15%,
  45% {
    fill: #3a3d46;
  }
  60%,
  100% {
    fill: #fffaf0;
    filter: url(#ck-glow);
  }
}
@keyframes drl-on {
  0%,
  30% {
    stroke: #fff;
  }
  15%,
  45% {
    stroke: #4a4d56;
  }
  60%,
  100% {
    stroke: #fff;
    filter: url(#ck-glow);
  }
}
@keyframes flare-on {
  0%,
  30% {
    opacity: 0.8;
  }
  15%,
  45% {
    opacity: 0;
  }
  60%,
  100% {
    opacity: 1;
  }
}
@keyframes door-open {
  to {
    transform: scale(0.3, 1.05);
  }
}
@keyframes shade {
  to {
    opacity: 0.35;
  }
}
@keyframes draw {
  to {
    stroke-dashoffset: 0;
  }
}
@keyframes title-fill {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
  }
}
@keyframes fade-in {
  to {
    opacity: 1;
  }
}
@keyframes fade-out {
  to {
    opacity: 0;
  }
}
@keyframes shimmer {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.82;
  }
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}
@keyframes twinkle {
  0%,
  100% {
    opacity: 0.5;
  }
  50% {
    opacity: 0.08;
  }
}

/* Reduced motion / static: jump straight to the final frame. */
.still *,
.still {
  animation-delay: 0s !important;
  animation-duration: 1ms !important;
  animation-iteration-count: 1 !important;
}
.still .streaks {
  opacity: 0;
}
</style>
