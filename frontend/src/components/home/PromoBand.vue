<script setup>
import { computed, ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { useI18n } from '@/i18n'
import { useInView } from '@/composables/useInView'

// Monthly-rental band, BMW 320d (reference: "COSMOS BLACK" — a framed landscape with the
// car parked over its lower edge and a letter-spaced wordmark underneath).
// The BMW faces right, so it parks on the left with the copy on the right. It is
// colour-graded to the mountain light (warm bounce in the shadows, hazy
// highlights); its contact shadow is tinted from the road.
// Motion on scroll-in: the landscape opens first, then the car drives in from
// the left and settles, then the wordmark tracks in.
const props = defineProps({
  section: { type: Object, required: true },
  promotion: { type: Object, default: null },
})
const { t, tc } = useI18n()
const cfg = computed(() => props.section.config ?? {})

const root = ref(null)
const inView = useInView(root, 0.3)
</script>

<template>
  <section ref="root" class="mb" :class="{ in: inView }">
    <div class="container">
      <div class="stage">
        <div class="frame">
          <img class="view" src="/media/view-mountain.jpg" alt="" loading="lazy" />
          <span class="grade" aria-hidden="true" />
          <div class="copy">
            <h2>{{ tc(section.title, 'monthly.title') }}</h2>
            <p>{{ tc(section.subtitle, 'monthly.body') }}</p>
            <a v-if="cfg.cta" :href="cfg.cta.href" target="_blank" rel="noopener" class="cta">
              {{ tc(cfg.cta.label, 'monthly.cta') }} <span class="dot"><Icon name="arrow-right" :size="14" /></span>
            </a>
          </div>
          <div v-if="cfg.badge" class="badge">
            <small>{{ tc(cfg.badge.label, 'monthly.badge') }}</small>
            <strong>{{ cfg.badge.value }}</strong>
            <span>{{ tc(cfg.badge.unit, 'monthly.unit') }}</span>
          </div>
        </div>

        <div class="car">
          <span class="contact" aria-hidden="true" />
          <img src="/media/monthly-car.webp" alt="BMW 320d" loading="lazy" />
        </div>
      </div>

      <p class="word" aria-hidden="true">{{ t('monthly.word') }}</p>
    </div>
  </section>
</template>

<style scoped>
.mb {
  padding-block: clamp(4rem, 9vw, 7rem) clamp(3rem, 7vw, 5rem);
  overflow: hidden;
}
.stage {
  position: relative;
  /* room under the frame for the car's wheels */
  padding-bottom: clamp(3rem, 8vw, 7rem);
}
.frame {
  position: relative;
  aspect-ratio: 3 / 1;
  min-height: 320px;
  border-radius: 22px;
  overflow: hidden;
  isolation: isolate;
  background: #6d6a63;
  box-shadow:
    0 0 0 6px rgb(255 255 255 / 0.06),
    0 0 0 7px rgb(255 255 255 / 0.12),
    0 40px 80px -40px rgb(40 32 22 / 0.45);
  clip-path: inset(0 50% 0 50% round 22px);
  transition: clip-path 1.2s cubic-bezier(0.7, 0, 0.2, 1);
}
.in .frame {
  clip-path: inset(0 0 0 0 round 22px);
}
.view {
  position: absolute;
  inset: 0;
  z-index: -2;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 50% 62%;
  transform: scale(1.18);
  filter: saturate(0.85) contrast(1.02);
  transition: transform 2.4s var(--ease-out);
}
.in .view {
  transform: scale(1);
}
/* mist at the top, warm road light at the bottom, dark left edge for the copy */
.grade {
  position: absolute;
  inset: 0;
  z-index: -1;
  background:
    linear-gradient(270deg, rgb(22 18 14 / 0.72) 0%, rgb(22 18 14 / 0.25) 38%, transparent 60%),
    linear-gradient(180deg, rgb(235 235 232 / 0.28) 0%, transparent 30%),
    linear-gradient(0deg, rgb(70 48 22 / 0.35) 0%, transparent 35%);
}
.copy {
  position: absolute;
  right: clamp(1.25rem, 4vw, 3.25rem);
  top: 50%;
  display: grid;
  gap: var(--s-3);
  justify-items: start;
  max-width: min(440px, 46%);
  color: #fff;
  opacity: 0;
  transform: translateY(calc(-50% + 18px));
  transition:
    opacity 0.8s var(--ease-out) 1.6s,
    transform 0.8s var(--ease-out) 1.6s;
}
.in .copy {
  opacity: 1;
  transform: translateY(-50%);
}
h2 {
  font-size: clamp(1.7rem, 1rem + 2.4vw, 3rem);
  font-weight: 700;
  text-shadow: 0 2px 24px rgb(0 0 0 / 0.3);
}
.copy p {
  font-size: var(--fs-sm);
  color: rgb(255 255 255 / 0.82);
}
.cta {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  height: 46px;
  margin-top: var(--s-2);
  padding: 0 6px 0 20px;
  border: 1px solid rgb(255 255 255 / 0.35);
  border-radius: var(--r-pill);
  background: rgb(20 18 16 / 0.35);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  font-size: var(--fs-sm);
  font-weight: 600;
  transition: background var(--dur-fast) var(--ease-out);
}
.cta:hover {
  background: rgb(20 18 16 / 0.55);
}
.cta .dot {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: #06c755;
}
.badge {
  position: absolute;
  top: clamp(1rem, 2.4vw, 1.75rem);
  left: clamp(1rem, 2.4vw, 1.75rem);
  display: grid;
  gap: 2px;
  padding: 0.9rem 1.2rem;
  border: 1px solid rgb(255 255 255 / 0.25);
  border-radius: 14px;
  background: linear-gradient(140deg, rgb(30 26 22 / 0.5), rgb(30 26 22 / 0.28));
  -webkit-backdrop-filter: blur(14px) saturate(130%);
  backdrop-filter: blur(14px) saturate(130%);
  color: #fff;
  opacity: 0;
  transform: translateY(-12px);
  transition:
    opacity 0.7s var(--ease-out) 1.8s,
    transform 0.7s var(--ease-out) 1.8s;
}
.in .badge {
  opacity: 1;
  transform: none;
}
.badge small {
  font-size: var(--fs-xs);
  opacity: 0.85;
}
.badge strong {
  font-family: 'Unbounded', var(--font-display);
  font-size: clamp(1.5rem, 1rem + 1.6vw, 2.3rem);
  font-weight: 700;
  line-height: 1.05;
}
.badge span {
  font-size: var(--fs-xs);
  opacity: 0.85;
}

/* the car overlaps the frame's lower edge, outside its clip */
.car {
  position: absolute;
  left: clamp(0.5rem, 3vw, 3rem);
  bottom: 0;
  width: min(46%, 640px);
  opacity: 0;
  transform: translateX(-38%); /* the BMW faces right: it drives in from the left */
  filter: blur(4px);
  transition:
    opacity 0.6s var(--ease-out) 0.9s,
    transform 1.4s cubic-bezier(0.16, 0.84, 0.3, 1) 0.9s,
    filter 0.9s var(--ease-out) 0.9s;
}
.in .car {
  opacity: 1;
  transform: none;
  filter: none;
}
.car img {
  position: relative;
  width: 100%;
  /* graded to the overcast mountain light; shadow tinted by the warm road */
  filter: brightness(0.94) contrast(1.06) saturate(0.9) drop-shadow(0 18px 14px rgb(52 36 18 / 0.38))
    drop-shadow(0 4px 3px rgb(30 22 12 / 0.45));
}
/* light on the paint, clipped to the car's silhouette: cool sky from above,
   golden bounce from the grass along the sills and lower bumper */
.car::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgb(170 182 194 / 0.28) 0%, transparent 38%, rgb(150 104 46 / 0.32) 78%, rgb(60 40 18 / 0.5) 100%);
  mix-blend-mode: multiply;
  -webkit-mask: url(/media/monthly-car.webp) center / 100% 100% no-repeat;
  mask: url(/media/monthly-car.webp) center / 100% 100% no-repeat;
  pointer-events: none;
}
.contact {
  position: absolute;
  left: 6%;
  right: 4%;
  bottom: 2%;
  height: 16%;
  border-radius: 50%;
  background: radial-gradient(closest-side, rgb(34 24 12 / 0.7), rgb(60 42 20 / 0.25) 60%, transparent);
  filter: blur(8px);
}

.word {
  margin-top: clamp(0.5rem, 1.5vw, 1rem);
  font-family: 'Unbounded', var(--font-display);
  font-size: clamp(0.9rem, 0.5rem + 1.3vw, 1.6rem);
  font-weight: 400;
  letter-spacing: 0.9em;
  color: rgb(255 255 255 / 0.5);
  white-space: nowrap;
  opacity: 0;
  transition:
    opacity 1s var(--ease-out) 1.4s,
    letter-spacing 1.6s var(--ease-out) 1.4s;
}
.in .word {
  opacity: 1;
  letter-spacing: 0.62em;
}

@media (max-width: 760px) {
  .frame {
    aspect-ratio: 4 / 5;
    min-height: 0;
  }
  .view {
    object-position: 40% 50%;
  }
  .copy {
    top: clamp(1.25rem, 6vw, 2rem);
    max-width: none;
    left: 1.25rem;
    right: 1.25rem;
    transform: translateY(18px);
  }
  .in .copy {
    transform: none;
  }
  .badge {
    top: auto;
    bottom: 38%;
    left: 1.25rem;
    right: auto;
  }
  .car {
    width: 86%;
    left: -4%;
    right: auto;
  }
  .word {
    letter-spacing: 0.4em;
  }
  .in .word {
    letter-spacing: 0.3em;
  }
  .grade {
    background:
      linear-gradient(180deg, rgb(22 18 14 / 0.65) 0%, transparent 50%),
      linear-gradient(0deg, rgb(70 48 22 / 0.35) 0%, transparent 35%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .frame,
  .view,
  .copy,
  .badge,
  .car,
  .word {
    transition: none !important;
  }
}
</style>
