<script setup>
import { t } from '@/i18n'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'

// Hero built around a vertical (9:16) brand clip:
//  - desktop: the clip plays in a tall rounded card in front of a giant
//    "COOL KIDS" wordmark (outline draws, then fills red — Taycan reference),
//    over a blurred, darkened copy of the same clip for ambience
//  - phones: the clip fills the whole stage
// Reduced motion: no autoplay, poster frame + final wordmark state.
const props = defineProps({
  src: { type: String, required: true },
  poster: { type: String, default: null },
  alt: { type: String, default: '' },
})

const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const main = ref(null)
const ambient = ref(null)
const playing = ref(!reduced)

function toggle() {
  const vids = [main.value, ambient.value].filter(Boolean)
  if (playing.value) vids.forEach((v) => v.pause())
  else vids.forEach((v) => v.play().catch(() => {}))
  playing.value = !playing.value
}

// Keep the blurred backdrop roughly in step with the main clip.
let timer = 0
onMounted(() => {
  if (reduced) return
  timer = window.setInterval(() => {
    const m = main.value
    const a = ambient.value
    if (m && a && Math.abs(m.currentTime - a.currentTime) > 0.3) a.currentTime = m.currentTime
  }, 1000)
})
onBeforeUnmount(() => window.clearInterval(timer))
</script>

<template>
  <div class="hv" :class="{ still: reduced }">
    <video
      ref="ambient"
      class="ambient"
      :src="props.src"
      :poster="props.poster"
      :autoplay="!reduced"
      muted
      loop
      playsinline
      preload="auto"
      aria-hidden="true"
      tabindex="-1"
    />

    <svg class="word" viewBox="0 0 1600 300" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <linearGradient id="hv-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ff5a4f" />
          <stop offset="0.6" stop-color="#e2362c" />
          <stop offset="1" stop-color="#e2362c" stop-opacity="0.2" />
        </linearGradient>
      </defs>
      <text class="tag" x="800" y="34" text-anchor="middle">CAR RENTAL · BANGKOK</text>
      <text class="outline" x="800" y="270" text-anchor="middle" textLength="1540" lengthAdjust="spacingAndGlyphs">COOL KIDS</text>
      <text class="fill" x="800" y="270" text-anchor="middle" textLength="1540" lengthAdjust="spacingAndGlyphs">COOL KIDS</text>
    </svg>

    <figure class="card">
      <video
        ref="main"
        :src="props.src"
        :poster="props.poster"
        :autoplay="!reduced"
        muted
        loop
        playsinline
        preload="auto"
        :aria-label="props.alt"
      />
      <span class="glow" aria-hidden="true" />
    </figure>

    <button type="button" class="ctrl" :aria-label="t(playing ? 'home.pauseVideo' : 'home.playVideo')" @click="toggle">
      <Icon v-if="!playing" name="play" :size="12" />
      <span v-else class="pause" aria-hidden="true"><i /><i /></span>
      {{ t(playing ? 'home.pause' : 'home.play') }}
    </button>
  </div>
</template>

<style scoped>
.hv {
  position: absolute;
  inset: 0;
  z-index: -2;
  overflow: hidden;
}
.ambient {
  position: absolute;
  inset: -8%;
  width: 116%;
  height: 116%;
  object-fit: cover;
  filter: blur(36px) brightness(0.38) saturate(1.2);
}
.hv::after {
  /* vignette so the copy stays readable */
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(60% 70% at 50% 45%, transparent 30%, rgb(7 8 12 / 0.65) 100%),
    linear-gradient(0deg, rgb(7 8 12 / 0.85), transparent 45%);
  pointer-events: none;
}

/* giant wordmark behind the card */
.word {
  position: absolute;
  left: 2%;
  right: 2%;
  top: 15%;
  width: 96%;
  height: auto;
  z-index: 1;
  font-family: 'Unbounded', sans-serif;
}
.word .outline,
.word .fill {
  font-weight: 800;
  font-size: 250px;
}
.outline {
  fill: none;
  stroke: rgb(255 255 255 / 0.45);
  stroke-width: 1.6;
  stroke-dasharray: 1500;
  stroke-dashoffset: 1500;
  animation: draw 2.4s ease-in-out 0.3s both;
}
.fill {
  fill: url(#hv-fill);
  opacity: 0;
  animation: fill 1.1s ease-out 2.4s both;
}
.tag {
  display: none; /* would sit behind the card on wide screens; shown on phones */
  font-weight: 500;
  font-size: 24px;
  letter-spacing: 0.55em;
  fill: #fff;
  opacity: 0;
  animation: fade 1s ease-out 2.9s both;
}

/* the clip itself */
.card {
  position: absolute;
  z-index: 2;
  left: 50%;
  top: 13%;
  height: 74%;
  aspect-ratio: 9 / 16;
  margin: 0;
  border-radius: 26px;
  overflow: hidden;
  transform: translateX(-50%);
  box-shadow:
    0 0 0 1px rgb(255 255 255 / 0.08),
    0 60px 90px -30px rgb(0 0 0 / 0.8);
  animation: rise 1.2s cubic-bezier(0.16, 0.84, 0.3, 1) 0.1s both;
}
.card video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.glow {
  position: absolute;
  inset: auto 10% -30% 10%;
  height: 40%;
  background: radial-gradient(closest-side, rgb(226 54 44 / 0.45), transparent);
  filter: blur(20px);
  pointer-events: none;
}

.ctrl {
  position: absolute;
  z-index: 3;
  top: 96px;
  right: clamp(1.25rem, 4vw, 3.5rem);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid rgb(255 255 255 / 0.2);
  border-radius: 999px;
  background: rgb(255 255 255 / 0.06);
  color: rgb(255 255 255 / 0.8);
  font-size: 0.75rem;
  cursor: pointer;
  backdrop-filter: blur(8px);
}
.ctrl:hover {
  color: #fff;
  border-color: rgb(255 255 255 / 0.45);
}
.pause {
  display: inline-flex;
  gap: 3px;
}
.pause i {
  width: 3px;
  height: 10px;
  background: currentColor;
  border-radius: 1px;
}

@keyframes draw {
  to {
    stroke-dashoffset: 0;
  }
}
@keyframes fill {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
  to {
    opacity: 1;
  }
}
@keyframes fade {
  to {
    opacity: 1;
  }
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translate(-50%, 60px) scale(0.96);
  }
}

/* phones: the vertical clip fills the stage */
@media (max-width: 720px) {
  .ambient {
    display: none;
  }
  .card {
    inset: 0;
    height: 100%;
    width: 100%;
    aspect-ratio: auto;
    border-radius: 0;
    transform: none;
    box-shadow: none;
    animation: none;
  }
  .glow {
    display: none;
  }
  .word {
    top: 124px;
    z-index: 3;
  }
  .tag {
    display: inline;
  }
  .hv::after {
    z-index: 2;
    background:
      linear-gradient(180deg, rgb(7 8 12 / 0.55), transparent 30%),
      linear-gradient(0deg, rgb(7 8 12 / 0.92) 8%, transparent 55%);
  }
  .ctrl {
    top: 80px;
    right: 14px;
  }
}

.still *,
.still {
  animation-delay: 0s !important;
  animation-duration: 1ms !important;
}
</style>
