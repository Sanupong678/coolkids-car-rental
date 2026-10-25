<script setup>
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import Icon from '@/components/ui/Icon.vue'
import { money } from '@/utils/format'
import { useI18n } from '@/i18n'
import { useInView } from '@/composables/useInView'

// "Choose your style" (reference: travel-destination card slider). The four car
// classes are tall photo cards on the right; the left column describes the class
// under the pointer and the section's backdrop crossfades to its photo.
// Motion: on scroll-in the copy rises line by line and the cards deal in one by
// one. Pointing at a card pops it forward, slides its neighbours aside and swaps
// the left column to that class's details. Touch: the first tap selects, the
// second follows the link.
const props = defineProps({
  section: { type: Object, required: true },
  vehicles: { type: Array, required: true },
})
const { t, tc } = useI18n()

const CLASSES = [
  { key: 'eco', name: 'Eco Car', img: '/media/categories/eco.webp' },
  { key: 'premium', name: 'Premium Car', img: '/media/categories/premium.webp' },
  { key: 'suv-5', name: 'SUV 5 ที่นั่ง', img: '/media/categories/suv.webp' },
  { key: 'suv-7', name: 'SUV 7 ที่นั่ง', img: '/media/categories/sedan.webp' },
]

const cards = computed(() =>
  CLASSES.map((c) => {
    const cars = props.vehicles.filter((v) => v.category?.slug === c.key)
    const prices = cars.map((v) => v.price.discountedDailyMinor ?? v.price.dailyMinor)
    return {
      ...c,
      name: t(`cats.${c.key}`),
      models: [...new Set(cars.map((v) => `${v.brand} ${v.model}`))],
      from: prices.length ? money(Math.min(...prices), cars[0].price.currency) : null,
    }
  }),
)

const active = ref(null) // key of the class being shown, null = intro
const current = computed(() => cards.value.find((c) => c.key === active.value) ?? null)
const activeIndex = computed(() => cards.value.findIndex((c) => c.key === active.value))
const nameLines = (name) => name.split(/ (?=&)/)

// neighbours slide away from the popped card
function offset(i) {
  const a = activeIndex.value
  if (a < 0 || i === a) return 0
  return i < a ? -1 : 1
}

const touch = typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches
function onCardClick(e, key) {
  if (touch && active.value !== key) {
    e.preventDefault()
    active.value = key
  }
}

// reveal once the section is a quarter in view
const root = ref(null)
const shown = useInView(root, 0.25)
</script>

<template>
  <section ref="root" class="cs" :class="{ in: shown, picked: current }" @mouseleave="active = null">
    <div class="backdrop" aria-hidden="true">
      <div v-for="c in cards" :key="c.key" class="bgimg" :class="{ on: (current ?? cards[0]).key === c.key }" :style="{ backgroundImage: `url(${c.img})` }" />
      <span class="tint" />
    </div>

    <div class="container grid">
      <div class="copy">
        <Transition name="swap" mode="out-in">
          <div v-if="!current" key="intro" class="panel">
            <span class="kicker"><i /> {{ tc(section.title, 'cat.kicker') }}</span>
            <h2>
              <span v-for="(l, i) in t('cat.title').split('\n')" :key="l" class="ln"><span :style="{ transitionDelay: `${150 + i * 110}ms` }">{{ l }}</span></span>
            </h2>
            <p class="body">{{ t('cat.body') }}</p>
            <p class="hint"><Icon name="arrow-right" :size="14" /> {{ t('cat.hover') }}</p>
          </div>
          <div v-else :key="current.key" class="panel detail">
            <span class="dash" />
            <span class="tag">{{ t(`cat.items.${current.key}.tag`) }}</span>
            <h2 class="name">
              <span v-for="l in nameLines(current.name)" :key="l">{{ l }}</span>
            </h2>
            <p class="body">{{ t(`cat.items.${current.key}.body`) }}</p>
            <ul class="meta">
              <li v-if="current.models.length"><Icon name="car" :size="15" /> {{ t('cat.models', { n: current.models.length }) }}</li>
              <li v-if="current.from"><Icon name="receipt" :size="15" /> {{ t('cat.from', { price: current.from }) }}</li>
            </ul>
            <ul v-if="current.models.length" class="chips">
              <li v-for="m in current.models" :key="m">{{ m }}</li>
            </ul>
            <div class="ctas">
              <RouterLink :to="{ name: 'vehicles', query: { category: current.key } }" class="go">
                <span class="dot"><Icon name="arrow-right" :size="14" /></span> {{ t('cat.browse') }}
              </RouterLink>
              <RouterLink :to="{ name: 'vehicles' }" class="ghost">{{ t('cat.all') }}</RouterLink>
            </div>
          </div>
        </Transition>
      </div>

      <ul class="track" :class="{ focus: current }">
        <li
          v-for="(c, i) in cards"
          :key="c.key"
          class="slot"
          :style="{ '--i': i, '--off': offset(i) }"
          @mouseenter="active = c.key"
        >
          <RouterLink
            :to="{ name: 'vehicles', query: { category: c.key } }"
            class="card"
            :class="{ on: active === c.key }"
            @focus="active = c.key"
            @click="onCardClick($event, c.key)"
          >
            <img :src="c.img" :alt="c.name" loading="lazy" />
            <span class="fade" />
            <span class="txt">
              <span class="dash" />
              <small>{{ t(`cat.items.${c.key}.tag`) }}</small>
              <strong>
                <span v-for="l in nameLines(c.name)" :key="l">{{ l }}</span>
              </strong>
              <span class="more">
                <span v-if="c.from">{{ t('cat.from', { price: c.from }) }}</span>
                <span class="arr"><Icon name="arrow-right" :size="14" /></span>
              </span>
            </span>
          </RouterLink>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.cs {
  --ease-pop: cubic-bezier(0.2, 0.9, 0.25, 1.15);
  position: relative;
  isolation: isolate;
  overflow: hidden;
  color: #fff;
  padding-block: clamp(6rem, 14vh, 9rem);
  min-height: max(680px, 100svh);
  display: grid;
  align-items: center;
}

/* backdrop: the active class's photo. Its top starts from the hero's sampled
   ambient colour (--amb) and its bottom dissolves into the light page. */
.backdrop {
  position: absolute;
  inset: 0;
  z-index: -1;
  background: var(--amb, #17181c);
  -webkit-mask-image: linear-gradient(180deg, #000 0, #000 80%, transparent 100%);
  mask-image: linear-gradient(180deg, #000 0, #000 80%, transparent 100%);
}
.bgimg {
  position: absolute;
  inset: -4%;
  background-size: cover;
  background-position: center;
  filter: blur(6px) brightness(0.55) saturate(1.1);
  opacity: 0;
  transform: scale(1.08);
  transition:
    opacity 0.9s var(--ease-out),
    transform 6s var(--ease-out),
    filter 0.9s var(--ease-out);
}
.bgimg.on {
  opacity: 1;
  transform: scale(1);
}
.picked .bgimg.on {
  filter: blur(0) brightness(0.62) saturate(1.1);
}
.tint {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(180deg, var(--amb, #17181c) 0%, transparent 28%),
    linear-gradient(90deg, rgb(12 12 16 / 0.82) 0%, rgb(12 12 16 / 0.35) 45%, rgb(12 12 16 / 0.15) 100%),
    linear-gradient(0deg, rgb(12 12 16 / 0.55), transparent 40%);
}

.grid {
  /* wider than the page container: the cards get most of the row */
  max-width: 1680px;
  display: grid;
  grid-template-columns: minmax(260px, 340px) 1fr;
  gap: clamp(1.5rem, 3vw, 3.5rem);
  align-items: center;
}

/* ---- left column ---- */
.copy {
  min-height: 420px;
  display: grid;
  align-items: center;
}
.panel {
  display: grid;
  gap: var(--s-4);
  justify-items: start;
  max-width: 460px;
}
.kicker {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: var(--fs-sm);
  letter-spacing: 0.04em;
  color: rgb(255 255 255 / 0.75);
}
.kicker i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 12px var(--accent);
}
h2 {
  display: grid;
  font-size: clamp(2.1rem, 1.2rem + 2.8vw, 3.6rem);
  font-weight: 700;
  line-height: 1.08;
}
.ln {
  display: block;
  overflow: hidden;
  padding-bottom: 0.08em;
}
.ln > span {
  display: block;
  transform: translateY(105%);
  transition: transform 0.9s var(--ease-out);
}
.in .ln > span {
  transform: none;
}
.body {
  color: rgb(255 255 255 / 0.72);
  font-size: var(--fs-sm);
  line-height: 1.7;
  max-width: 42ch;
}
.hint {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-xs);
  color: rgb(255 255 255 / 0.55);
  letter-spacing: 0.04em;
}
.kicker,
.panel:not(.detail) .body,
.hint {
  opacity: 0;
  transform: translateY(14px);
  transition:
    opacity 0.8s var(--ease-out),
    transform 0.8s var(--ease-out);
}
.panel:not(.detail) .body {
  transition-delay: 0.4s;
}
.hint {
  transition-delay: 0.55s;
}
.in .kicker,
.in .panel .body,
.in .hint {
  opacity: 1;
  transform: none;
}

.dash {
  display: block;
  width: 22px;
  height: 2px;
  background: #fff;
}
.tag {
  font-size: var(--fs-sm);
  color: rgb(255 255 255 / 0.8);
}
.name {
  font-family: 'Oswald', var(--font-display);
  font-size: clamp(2.8rem, 1.4rem + 4vw, 5.2rem);
  font-weight: 600;
  line-height: 0.95;
  letter-spacing: 0;
  text-transform: uppercase;
}
.meta,
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.meta li {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: var(--fs-sm);
  color: rgb(255 255 255 / 0.85);
}
.chips {
  gap: 6px;
}
.chips li {
  padding: 4px 12px;
  border: 1px solid rgb(255 255 255 / 0.2);
  border-radius: var(--r-pill);
  background: rgb(255 255 255 / 0.06);
  font-size: var(--fs-xs);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}
.ctas {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: var(--s-2);
}
.go,
.ghost {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  height: 46px;
  border-radius: var(--r-pill);
  font-size: var(--fs-xs);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.go {
  padding: 0 22px 0 6px;
  border: 1px solid rgb(255 255 255 / 0.4);
}
.go .dot {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--accent);
}
.go:hover {
  background: rgb(255 255 255 / 0.08);
}
.ghost {
  padding: 0 18px;
  color: rgb(255 255 255 / 0.7);
}
.ghost:hover {
  color: #fff;
}
/* detail panel: children rise in sequence */
.detail > * {
  animation: rise 0.6s var(--ease-out) both;
}
.detail > :nth-child(2) {
  animation-delay: 0.05s;
}
.detail > :nth-child(3) {
  animation-delay: 0.1s;
}
.detail > :nth-child(4) {
  animation-delay: 0.16s;
}
.detail > :nth-child(5) {
  animation-delay: 0.22s;
}
.detail > :nth-child(6) {
  animation-delay: 0.28s;
}
.detail > :nth-child(7) {
  animation-delay: 0.34s;
}
.swap-enter-active,
.swap-leave-active {
  transition:
    opacity 0.25s var(--ease-out),
    transform 0.25s var(--ease-out);
}
.swap-enter-from {
  opacity: 0;
  transform: translateX(-16px);
}
.swap-leave-to {
  opacity: 0;
  transform: translateX(16px);
}

/* ---- cards ---- */
.track {
  display: flex;
  gap: clamp(12px, 1.2vw, 18px);
  margin: 0;
  padding: 0;
  list-style: none;
  transition: transform 0.7s var(--ease-out);
}
/* when a card is picked the whole row slides aside, making room for the pop */
.track.focus {
  transform: translateX(clamp(12px, 2vw, 32px));
}
.slot {
  flex: 1 1 0;
  min-width: 0;
  opacity: 0;
  transform: translateY(70px) rotate(2deg);
  transition:
    opacity 0.9s var(--ease-out),
    transform 0.9s var(--ease-out);
  transition-delay: calc(0.25s + var(--i) * 0.12s);
}
.in .slot {
  opacity: 1;
  transform: translateX(calc(var(--off) * clamp(10px, 1.6vw, 26px)));
}
/* once dealt in, the slide-aside responds without the entrance stagger */
.in .track.focus .slot,
.in .track:hover .slot {
  transition-duration: 0.6s;
  transition-delay: 0s;
}
.card {
  position: relative;
  display: block;
  aspect-ratio: 3 / 4.6;
  border-radius: 18px;
  overflow: hidden;
  background: #222;
  box-shadow: 0 30px 50px -30px rgb(0 0 0 / 0.7);
  transform-origin: 50% 80%;
  transition:
    transform 0.6s var(--ease-pop),
    box-shadow 0.6s var(--ease-out),
    filter 0.6s var(--ease-out);
}
.card img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 1.2s var(--ease-out);
}
.fade {
  position: absolute;
  inset: 0;
  background: linear-gradient(0deg, rgb(8 8 10 / 0.85) 0%, rgb(8 8 10 / 0.2) 45%, transparent 70%);
}
.txt {
  position: absolute;
  inset: auto 0 0;
  display: grid;
  gap: 6px;
  padding: clamp(14px, 1.4vw, 20px);
}
.txt small {
  font-size: 0.7rem;
  color: rgb(255 255 255 / 0.75);
}
.txt strong {
  display: grid;
  font-family: 'Oswald', var(--font-display);
  font-size: clamp(1.1rem, 0.6rem + 1vw, 1.8rem);
  font-weight: 600;
  line-height: 1.02;
  text-transform: uppercase;
  white-space: nowrap;
}
.more {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  max-height: 0;
  opacity: 0;
  overflow: hidden;
  font-size: var(--fs-xs);
  color: rgb(255 255 255 / 0.85);
  transition:
    max-height 0.5s var(--ease-out),
    opacity 0.4s var(--ease-out),
    margin 0.5s var(--ease-out);
}
.arr {
  display: grid;
  place-items: center;
  flex: none;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: #fff;
  color: #111;
}
/* the picked card pops forward; the others step back */
.track.focus .card:not(.on) {
  filter: brightness(0.6) saturate(0.8);
  transform: scale(0.94);
}
.card.on {
  transform: translateY(-22px) scale(1.08);
  box-shadow:
    0 0 0 1px rgb(255 255 255 / 0.35),
    0 50px 70px -30px rgb(0 0 0 / 0.85);
  z-index: 1;
}
.card.on img {
  transform: scale(1.06);
}
.card.on .more {
  max-height: 40px;
  opacity: 1;
  margin-top: 6px;
}
.card:focus-visible {
  box-shadow: var(--focus-ring);
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
}

@media (max-width: 1000px) {
  .grid {
    grid-template-columns: 1fr;
  }
  .copy {
    min-height: 360px;
    align-items: end;
  }
  .track {
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    padding: 30px 4px 10px;
    margin-inline: calc(var(--gutter) * -1);
    padding-inline: var(--gutter);
    scrollbar-width: none;
  }
  .track::-webkit-scrollbar {
    display: none;
  }
  .track.focus {
    transform: none;
  }
  .slot {
    flex: 0 0 clamp(210px, 58vw, 300px);
    scroll-snap-align: start;
  }
}
@media (prefers-reduced-motion: reduce) {
  .slot,
  .card,
  .track,
  .bgimg,
  .ln > span,
  .kicker,
  .body,
  .hint {
    transition: none !important;
  }
  .detail > * {
    animation: none;
  }
}
</style>
