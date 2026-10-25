<script setup>
import { t, tx } from '@/i18n'
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import Icon from '@/components/ui/Icon.vue'

// Full-bleed video hero: the studio car commercial plays edge to edge behind
// frosted-glass panels (headline card, play/pause pill); the hero's glass
// search card overlaps the bottom edge (see HeroSection).
// Reduced motion: no autoplay, poster frame only.
const props = defineProps({
  src: { type: String, required: true },
  poster: { type: String, default: null },
  banner: { type: Object, required: true },
})

const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const video = ref(null)
const playing = ref(!reduced)
function toggle() {
  const v = video.value
  if (!v) return
  if (playing.value) v.pause()
  else v.play().catch(() => {})
  playing.value = !playing.value
}
const isInternal = (href) => href?.startsWith('/')
</script>

<template>
  <div class="hb">
    <video
      ref="video"
      class="bg"
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
    <span class="shade" aria-hidden="true" />

    <div class="container inner">
      <div class="card glass-dark">
        <span class="kicker"><i /> {{ t('home.kicker') }}</span>
        <h1>{{ tx(banner.headline ?? 'รถเช่าขับเอง สำหรับทุกครอบครัว') }}</h1>
        <p v-if="banner.description">{{ tx(banner.description) }}</p>
        <div class="ctas">
          <component
            :is="isInternal(banner.ctaPrimary?.href) ? RouterLink : 'a'"
            v-if="banner.ctaPrimary?.text"
            :to="banner.ctaPrimary.href"
            :href="banner.ctaPrimary.href"
            class="btn btn-primary btn-pill"
          >
            {{ tx(banner.ctaPrimary.text) }} <Icon name="arrow-right" :size="16" class="arrow" />
          </component>
          <component
            :is="isInternal(banner.ctaSecondary?.href) ? RouterLink : 'a'"
            v-if="banner.ctaSecondary?.text"
            :to="banner.ctaSecondary.href"
            :href="banner.ctaSecondary.href"
            target="_blank"
            rel="noopener"
            class="btn btn-pill line"
          >
            {{ tx(banner.ctaSecondary.text) }}
          </component>
        </div>
      </div>

      <ul class="facts">
        <li class="glass-dark"><Icon name="shield" :size="16" /> {{ t('home.insured') }}</li>
        <li class="glass-dark"><Icon name="road" :size="16" /> {{ t('home.unlimited') }}</li>
        <li class="glass-dark"><Icon name="pin" :size="16" /> {{ t('home.delivery') }}</li>
      </ul>
    </div>

    <button type="button" class="ctrl glass-dark" :aria-label="t(playing ? 'home.pauseVideo' : 'home.playVideo')" @click="toggle">
      <Icon v-if="!playing" name="play" :size="12" />
      <span v-else class="pause" aria-hidden="true"><i /><i /></span>
      {{ t(playing ? 'home.pause' : 'home.play') }}
    </button>
  </div>
</template>

<style scoped>
.hb {
  position: relative;
  height: max(620px, min(100svh, 980px));
  overflow: hidden;
  isolation: isolate;
  background: #1a1b1f;
  color: #fff;
}
.bg {
  position: absolute;
  inset: 0;
  z-index: -2;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 60% 50%;
}
.shade {
  position: absolute;
  inset: 0;
  z-index: -1;
  background:
    linear-gradient(90deg, rgb(10 11 15 / 0.55) 0%, rgb(10 11 15 / 0.1) 55%, transparent 75%),
    linear-gradient(0deg, rgb(10 11 15 / 0.6) 0%, transparent 35%),
    linear-gradient(180deg, rgb(10 11 15 / 0.45) 0%, transparent 18%);
  pointer-events: none;
}
.inner {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: var(--s-4);
  padding-bottom: clamp(6.5rem, 11vw, 8.5rem);
}
.card {
  display: grid;
  gap: var(--s-3);
  max-width: 560px;
  padding: clamp(1.4rem, 2.6vw, 2.2rem);
  border-radius: var(--r-lg);
  animation: rise 1.1s var(--ease-out) 0.2s both;
}
.kicker {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: var(--fs-xs);
  letter-spacing: 0.14em;
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
  font-size: clamp(2rem, 1.2rem + 2.8vw, 3.4rem);
  font-weight: 700;
  line-height: 1.12;
  letter-spacing: -0.01em;
}
.card p {
  color: rgb(255 255 255 / 0.78);
  max-width: 46ch;
}
.ctas {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-2);
  margin-top: var(--s-2);
}
.line {
  border: 1px solid rgb(255 255 255 / 0.4);
  background: rgb(255 255 255 / 0.08);
  color: #fff;
}
.line:hover {
  background: rgb(255 255 255 / 0.18);
}
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-2);
  margin: 0;
  padding: 0;
  list-style: none;
  animation: rise 1.1s var(--ease-out) 0.45s both;
}
.facts li {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 16px;
  border-radius: var(--r-pill);
  font-size: var(--fs-sm);
}
.ctrl {
  position: absolute;
  top: 96px;
  right: clamp(1.25rem, 4vw, 3.5rem);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border-radius: var(--r-pill);
  font-size: var(--fs-xs);
  cursor: pointer;
}
.pause {
  display: inline-flex;
  gap: 3px;
}
.pause i {
  width: 3px;
  height: 10px;
  border-radius: 1px;
  background: currentColor;
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
}
@media (max-width: 720px) {
  .hb {
    height: max(600px, 100svh);
  }
  .bg {
    object-position: 68% 50%;
  }
  .shade {
    background:
      linear-gradient(0deg, rgb(10 11 15 / 0.75) 10%, transparent 60%),
      linear-gradient(180deg, rgb(10 11 15 / 0.5) 0%, transparent 20%);
  }
  .ctrl {
    top: 80px;
    right: 14px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .card,
  .facts {
    animation: none;
  }
}
</style>
