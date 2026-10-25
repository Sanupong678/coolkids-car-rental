<script setup>
import { t, tx } from '@/i18n'
import { RouterLink } from 'vue-router'
import Icon from '@/components/ui/Icon.vue'

// Hero headline + CTAs, shared by the hero stages:
//   scene — SVG drive-in (stacks under the scene on phones)
//   video — clip card (copy flanks the centred card)
//   film  — scroll film (appears only once the film has played: `show`)
defineProps({
  banner: { type: Object, required: true },
  variant: { type: String, default: 'scene' },
  show: { type: Boolean, default: true },
})
const isInternal = (href) => href?.startsWith('/')
</script>

<template>
  <div class="copy" :class="[variant, { show }]">
    <div class="lead">
      <span class="kicker"><i /> {{ t('home.kicker') }}</span>
      <h1>{{ tx(banner.headline ?? 'รถเช่าขับเอง สำหรับทุกครอบครัว') }}</h1>
    </div>
    <div class="side">
      <p>{{ tx(banner.description) }}</p>
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
  </div>
</template>

<style scoped>
.copy {
  position: absolute;
  inset: auto 0 0;
  z-index: 3;
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: var(--s-6);
  padding: 0 clamp(1.25rem, 4vw, 3.5rem) clamp(5.5rem, 9vw, 7.5rem);
  color: #fff;
}
.lead {
  display: grid;
  gap: var(--s-3);
  max-width: 620px;
}
.kicker {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: var(--fs-xs);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(255 255 255 / 0.7);
}
.kicker i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 4px rgb(226 54 44 / 0.25);
}
h1 {
  font-size: clamp(2.1rem, 1.2rem + 3.2vw, 4.1rem);
  font-weight: 700;
  line-height: 1.12;
  letter-spacing: -0.01em;
}
.side {
  display: grid;
  gap: var(--s-4);
  max-width: 380px;
}
.side p {
  font-size: var(--fs-sm);
  color: rgb(255 255 255 / 0.75);
}
.ctas {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-2);
}
.line {
  background: #06c755;
  color: #fff;
}
.line:hover {
  background: #05b04b;
}

/* entrance on load (scene / video) */
.scene .lead,
.video .lead {
  animation: rise 1s var(--ease-out) 0.9s both;
}
.scene .side,
.video .side {
  animation: rise 1s var(--ease-out) 1.2s both;
}
/* video: flank the centred clip card */
.video .lead {
  max-width: min(620px, calc(50% - 230px));
}
.video .side {
  max-width: min(380px, calc(50% - 230px));
}
/* film: revealed at the end of the scroll */
.film .lead,
.film .side {
  opacity: 0;
  transform: translateY(24px);
  transition:
    opacity 0.6s var(--ease-out),
    transform 0.6s var(--ease-out);
}
.film .side {
  transition-delay: 0.12s;
}
.film:not(.show) {
  pointer-events: none;
}
.film.show .lead,
.film.show .side {
  opacity: 1;
  transform: none;
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(18px);
  }
}
@media (max-width: 720px) {
  .copy {
    flex-direction: column;
    align-items: stretch;
    gap: var(--s-4);
    padding: var(--s-4) 1.1rem 5rem;
  }
  .scene {
    position: static;
  }
  .lead,
  .side,
  .video .lead,
  .video .side {
    max-width: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .lead,
  .side {
    animation: none !important;
    transition: none !important;
  }
}
</style>
