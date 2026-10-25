<script setup>
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import Icon from '@/components/ui/Icon.vue'
import { useSiteStore } from '@/stores/site'
import { useI18n } from '@/i18n'

// Dark footer (Resend reference): a huge glass "COOLKIDS" wordmark cut off at
// a glowing horizon line, then address/status/social on the left and the CMS
// link columns ("site.footer") on the right.
const site = useSiteStore()
const { t, tx } = useI18n()
const footer = computed(() => site.content?.footer ?? {})
const company = computed(() => site.content?.company ?? {})
const isInternal = (href) => href?.startsWith('/')

// "Open now" status from the branch hours (08:00–20:00, Asia/Bangkok).
const openNow = computed(() => {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Bangkok' }).format(new Date()))
  return h >= 8 && h < 20
})
</script>

<template>
  <footer class="footer">
    <div class="mark" aria-hidden="true">
      <svg viewBox="0 0 1200 230" preserveAspectRatio="xMidYMax meet">
        <defs>
          <linearGradient id="ft-body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#3a3a40" />
            <stop offset="0.45" stop-color="#0d0d10" />
            <stop offset="1" stop-color="#000" />
          </linearGradient>
          <linearGradient id="ft-edge" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#ffffff" />
            <stop offset="0.35" stop-color="#8d8d96" />
            <stop offset="0.7" stop-color="#2a2a30" />
            <stop offset="1" stop-color="#bdbdc4" />
          </linearGradient>
          <linearGradient id="ft-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0.55" stop-color="#fff" />
            <stop offset="1" stop-color="#fff" stop-opacity="0.25" />
          </linearGradient>
          <mask id="ft-mask"><rect width="1200" height="230" fill="url(#ft-fade)" /></mask>
        </defs>
        <g mask="url(#ft-mask)" font-family="Unbounded, sans-serif" font-weight="800" font-size="230" text-anchor="middle">
          <!-- stroke painted under the (opaque) fill: only the outer bevel shows,
               the font's internal overlapping contours stay hidden -->
          <text x="600" y="262" textLength="1180" lengthAdjust="spacingAndGlyphs" fill="url(#ft-body)" stroke="url(#ft-edge)" stroke-width="4.4" paint-order="stroke">COOLKIDS</text>
        </g>
      </svg>
    </div>
    <div class="horizon" aria-hidden="true" />

    <div class="main">
      <div class="brand">
        <p>{{ tx(company.address) }}</p>
        <p class="muted">{{ tx(company.hours) }}</p>
        <span class="status" :class="{ closed: !openNow }"><i /> {{ openNow ? t('footer.open') : t('footer.closed') }}</span>
        <div class="social">
          <a v-for="s in footer.social ?? []" :key="s.network" :href="s.href" target="_blank" rel="noopener" :aria-label="s.network">
            <Icon :name="s.network" :size="16" />
          </a>
          <a v-if="company.phone" :href="`tel:${company.phone.replaceAll('-', '')}`" :aria-label="t('header.call')">
            <Icon name="phone" :size="16" />
          </a>
        </div>
      </div>
      <nav v-for="col in footer.columns ?? []" :key="col.title" class="col" :aria-label="tx(col.title)">
        <h3>{{ tx(col.title) }}</h3>
        <template v-for="l in col.links" :key="l.href">
          <RouterLink v-if="isInternal(l.href)" :to="l.href">{{ tx(l.label) }}</RouterLink>
          <a v-else :href="l.href" target="_blank" rel="noopener">{{ tx(l.label) }}</a>
        </template>
      </nav>
    </div>
    <p class="legal">{{ tx(footer.legal_note) }}</p>
  </footer>
</template>

<style scoped>
.footer {
  background: #000;
  color: #e4e4e7;
  overflow: hidden;
}
/* homepage: the ambient light runs into the footer, which darkens to black */
:global(body.ambient-page .footer) {
  background: linear-gradient(180deg, transparent 0%, rgb(0 0 0 / 0.5) 35%, #000 80%);
}
.mark {
  max-width: 1180px;
  margin: 0 auto;
  padding: clamp(3rem, 8vw, 6rem) clamp(1rem, 4vw, 2rem) 0;
}
.mark svg {
  display: block;
  width: 100%;
  height: auto;
}
.horizon {
  position: relative;
  height: clamp(5rem, 10vw, 8rem);
  border-top: 1px solid rgb(255 255 255 / 0.12);
  background: radial-gradient(50% 100% at 50% 0%, rgb(255 255 255 / 0.09), transparent 70%);
}
.main {
  display: grid;
  grid-template-columns: 1.6fr repeat(3, 1fr);
  gap: var(--s-6);
  max-width: 1180px;
  margin: 0 auto;
  padding: 0 clamp(1rem, 4vw, 2rem) var(--s-8);
}
.brand {
  display: grid;
  gap: 10px;
  align-content: start;
  font-size: var(--fs-sm);
}
.muted {
  color: #a1a1aa;
}
.status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  margin-top: var(--s-3);
  padding: 4px 10px;
  border-radius: 6px;
  background: #18181b;
  font-size: var(--fs-xs);
}
.status i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 8px #22c55e;
}
.status.closed i {
  background: #a1a1aa;
  box-shadow: none;
}
.social {
  display: flex;
  gap: 10px;
  margin-top: var(--s-4);
}
.social a {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 1px solid rgb(255 255 255 / 0.14);
  color: #a1a1aa;
  transition:
    color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}
.social a:hover {
  color: #fff;
  border-color: rgb(255 255 255 / 0.4);
}
.col {
  display: grid;
  align-content: start;
  gap: 14px;
}
.col h3 {
  font-family: var(--font-body);
  font-size: var(--fs-sm);
  font-weight: 600;
  letter-spacing: 0;
  color: #fff;
  margin-bottom: 4px;
}
.col a {
  width: fit-content;
  font-size: var(--fs-sm);
  color: #a1a1aa;
  transition: color var(--dur-fast) var(--ease-out);
}
.col a:hover {
  color: #fff;
}
.legal {
  max-width: 1180px;
  margin: 0 auto;
  padding: var(--s-4) clamp(1rem, 4vw, 2rem) var(--s-6);
  border-top: 1px solid rgb(255 255 255 / 0.08);
  font-size: var(--fs-xs);
  color: #71717a;
}
@media (max-width: 860px) {
  .main {
    grid-template-columns: 1fr 1fr;
  }
  .brand {
    grid-column: 1 / -1;
  }
}
</style>
