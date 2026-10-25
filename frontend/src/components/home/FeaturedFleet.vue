<script setup>
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import Icon from '@/components/ui/Icon.vue'
import { label, money, srcset } from '@/utils/format'
import { useI18n } from '@/i18n'

// "Trend vehicles": four frosted-glass cards over a dark showroom photo (a white
// Civic under linear lights, its edges dissolving into the page's ambient light).
// Name top-left, photo, price/day bottom-left and a "book" pill; the first card is red-tinted.
// On phones the cards become a sideways slider (swipe or the arrows) instead of a tall stack.
const props = defineProps({
  section: { type: Object, required: true },
  vehicles: { type: Array, required: true },
})
const list = computed(() => props.vehicles.slice(0, props.section.config?.limit ?? 4))
const { t, tc } = useI18n()
const daily = (v) => v.price.discountedDailyMinor ?? v.price.dailyMinor

const track = ref(null)
const index = ref(0)
function onScroll() {
  const el = track.value
  const first = el?.children[0]
  if (!first) return
  const step = first.offsetWidth + parseFloat(getComputedStyle(el).columnGap || 0)
  index.value = Math.round(el.scrollLeft / step)
}
function go(i) {
  const el = track.value
  const to = Math.max(0, Math.min(list.value.length - 1, i))
  const card = el?.children[to]
  index.value = to
  if (card) el.scrollTo({ left: card.offsetLeft - el.firstElementChild.offsetLeft, behavior: 'smooth' })
}
</script>

<template>
  <section class="section trend">
    <div class="showroom" aria-hidden="true" />
    <div class="container">
      <div v-reveal class="head">
        <h2>{{ tc(section.title, 'fleet.title') }}</h2>
        <RouterLink :to="{ name: 'vehicles' }" class="all">{{ t('fleet.all') }} <Icon name="arrow-right" :size="14" /></RouterLink>
      </div>
      <div ref="track" v-reveal class="row" @scroll.passive="onScroll">
        <RouterLink
          v-for="(v, i) in list"
          :key="v.id"
          v-reveal="{ delay: i * 80 }"
          :to="{ name: 'vehicle', params: { slug: v.slug } }"
          class="card"
          :class="{ hi: i === 0 }"
        >
          <div class="name">
            <h3>{{ v.brand }} {{ v.model }}</h3>
            <span>{{ v.trim }} · {{ v.year }}</span>
          </div>
          <div class="pic">
            <img
              v-if="v.image"
              :src="v.image.variants?.w960 ?? v.image.url"
              :srcset="srcset(v.image.variants)"
              sizes="(min-width: 1100px) 320px, (min-width: 640px) 45vw, 90vw"
              :alt="v.image.alt ?? `${v.brand} ${v.model}`"
              loading="lazy"
            />
          </div>
          <ul class="spec">
            <li><Icon name="users" :size="13" /> {{ v.specs.seats }}</li>
            <li><Icon :name="v.specs.fuel === 'ELECTRIC' ? 'bolt' : 'fuel'" :size="13" /> {{ label(v.specs.fuel) }}</li>
          </ul>
          <div class="foot">
            <p><strong>{{ money(daily(v), v.price.currency) }}</strong>{{ t('fleet.perDay') }}</p>
            <span class="book">{{ t('fleet.book') }}</span>
          </div>
        </RouterLink>
      </div>
      <div v-if="list.length > 1" class="nav">
        <button type="button" class="arrow" :aria-label="t('fleet.prev')" :disabled="index <= 0" @click="go(index - 1)">
          <Icon name="chevron-left" :size="18" />
        </button>
        <span class="dots" aria-hidden="true"><i v-for="(v, i) in list" :key="v.id" :class="{ on: i === index }" /></span>
        <button type="button" class="arrow" :aria-label="t('fleet.next')" :disabled="index >= list.length - 1" @click="go(index + 1)">
          <Icon name="chevron-right" :size="18" />
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.trend {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  padding-block: clamp(6rem, 12vw, 9rem);
}
/* showroom photo, centred behind the cards and feathered into the ambient light */
.showroom {
  position: absolute;
  inset: 0;
  z-index: -1;
  background:
    linear-gradient(180deg, rgb(10 10 12 / 0.15), rgb(10 10 12 / 0.55)),
    url(/media/showroom-civic.webp) 50% 38% / max(100%, 900px) auto no-repeat;
  -webkit-mask-image: radial-gradient(72% 50% at 50% 50%, #000 35%, transparent 100%);
  mask-image: radial-gradient(72% 50% at 50% 50%, #000 35%, transparent 100%);
  opacity: 0.85;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--s-4);
  margin-bottom: clamp(1.5rem, 3vw, 2.5rem);
}
h2 {
  font-size: clamp(2rem, 1.3rem + 2.6vw, 3.25rem);
  font-weight: 700;
  color: #fff;
  text-shadow: 0 4px 30px rgb(0 0 0 / 0.4);
}
.all {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 38px;
  padding: 0 16px;
  border-radius: var(--r-pill);
  background: var(--accent);
  color: #fff;
  font-size: var(--fs-sm);
  white-space: nowrap;
}
.all:hover {
  background: var(--accent-press);
}
.row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
.card {
  display: grid;
  grid-template-rows: auto 1fr auto auto;
  gap: var(--s-3);
  padding: 1.25rem;
  border: 1px solid rgb(255 255 255 / 0.14);
  border-radius: var(--r-md);
  background: linear-gradient(150deg, rgb(255 255 255 / 0.12), rgb(255 255 255 / 0.03));
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.12),
    0 30px 50px -30px rgb(0 0 0 / 0.6);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
  backdrop-filter: blur(18px) saturate(140%);
  color: #fff;
  transition:
    background var(--dur-base) var(--ease-out),
    border-color var(--dur-base) var(--ease-out),
    transform var(--dur-base) var(--ease-out);
}
.card.hi {
  background: linear-gradient(150deg, rgb(226 54 44 / 0.32), rgb(226 54 44 / 0.08));
  border-color: rgb(255 120 110 / 0.3);
}
.card:hover {
  background: linear-gradient(150deg, rgb(255 255 255 / 0.18), rgb(255 255 255 / 0.06));
  border-color: rgb(255 255 255 / 0.28);
  transform: translateY(-4px);
}
.card.hi:hover {
  background: linear-gradient(150deg, rgb(226 54 44 / 0.42), rgb(226 54 44 / 0.12));
}
.name h3 {
  font-family: var(--font-body);
  font-size: var(--fs-lg);
  font-weight: 700;
  letter-spacing: -0.01em;
}
.name span {
  font-size: var(--fs-xs);
  color: rgb(255 255 255 / 0.6);
}
.pic {
  aspect-ratio: 16 / 10;
  display: grid;
  place-items: end center;
  padding-bottom: 8%;
  align-self: center;
  background: radial-gradient(60% 14% at 50% 88%, rgb(0 0 0 / 0.45), transparent 70%);
}
.pic img {
  width: 100%;
  max-height: 100%;
  object-fit: contain;
  filter: drop-shadow(0 12px 10px rgb(0 0 0 / 0.45));
  transition: transform 1s var(--ease-out);
}
.card:hover .pic img {
  transform: translateX(4%) scale(1.04);
}
.spec {
  display: flex;
  gap: var(--s-3);
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--fs-xs);
  color: rgb(255 255 255 / 0.62);
}
.spec li {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--s-2);
}
.foot p {
  font-size: var(--fs-xs);
  color: rgb(255 255 255 / 0.6);
}
.foot strong {
  font-size: var(--fs-lg);
  color: #fff;
  font-weight: 700;
}
.book {
  height: 34px;
  display: inline-flex;
  align-items: center;
  padding: 0 14px;
  border: 1px solid rgb(255 255 255 / 0.25);
  border-radius: var(--r-pill);
  background: rgb(255 255 255 / 0.06);
  font-size: var(--fs-xs);
  font-weight: 600;
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}
.card:hover .book {
  background: #fff;
  border-color: #fff;
  color: #111;
}
@media (max-width: 1000px) {
  .row {
    grid-template-columns: repeat(2, 1fr);
  }
}
/* phones: a swipeable row with the next card peeking in, plus arrows and dots */
.nav {
  display: none;
}
@media (max-width: 760px) {
  .row {
    display: flex;
    gap: 12px;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
  }
  .row::-webkit-scrollbar {
    display: none;
  }
  .card {
    flex: 0 0 86%;
    scroll-snap-align: start;
  }
  .card:hover {
    transform: none;
  }
  /* cards waiting off to the side would stay hidden: reveal the row as a whole instead */
  .row .card.reveal {
    opacity: 1;
    transform: none;
  }
  .nav {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: var(--s-4);
    margin-top: var(--s-4);
  }
  .arrow {
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border: 1px solid rgb(255 255 255 / 0.25);
    border-radius: 50%;
    background: rgb(255 255 255 / 0.08);
    color: #fff;
    cursor: pointer;
    transition: opacity var(--dur-fast) var(--ease-out);
  }
  .arrow:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .dots {
    display: flex;
    gap: 6px;
  }
  .dots i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgb(255 255 255 / 0.3);
    transition:
      width var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out);
  }
  .dots i.on {
    width: 18px;
    border-radius: 3px;
    background: #fff;
  }
}
</style>
