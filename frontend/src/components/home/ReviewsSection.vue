<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { useI18n } from '@/i18n'

// Customer reviews from the Facebook page (CMS "site.reviews"): centred tag +
// two-tone headline, one row of topic tabs (each with how many reviews praise
// it), then a slider of review cards that advances by itself every few seconds
// and loops. Arrows, dots and swiping move it by hand; it pauses while the
// pointer, a finger or keyboard focus is on it. The last card links to the
// page for the rest of the reviews. Review text is quoted verbatim.
const props = defineProps({
  section: { type: Object, required: true },
  reviews: { type: Object, default: null },
})
const { t, tc, locale } = useI18n()

const dateLocale = { th: 'th-TH', en: 'en-GB', zh: 'zh-CN' }
const fmt = (iso) => new Date(iso).toLocaleDateString(dateLocale[locale.value], { day: 'numeric', month: 'long', year: 'numeric' })

// What a review praises: its own "tags" when the CMS has them, otherwise words in the text.
const TOPICS = {
  newcar: /รถใหม่|new car|新车/i,
  clean: /สะอาด|clean|干净/i,
  service: /บริการ|ดูแล|ใจดี|เป็นกันเอง|service|friendly|服务/i,
  delivery: /ส่งรถ|รับรถ|คืนรถ|ตรงเวลา|deliver|on time|pick.?up|送车|取车/i,
  price: /ราคา|คุ้ม|price|value|价格|实惠/i,
}
const items = computed(() =>
  (props.reviews?.items ?? []).map((r) => ({
    ...r,
    topics: r.tags?.length ? r.tags : Object.keys(TOPICS).filter((k) => TOPICS[k].test(r.text)),
  })),
)
const tabs = computed(() => [
  { key: 'all', n: props.reviews?.count ?? items.value.length },
  ...Object.keys(TOPICS)
    .map((key) => ({ key, n: items.value.filter((r) => r.topics.includes(key)).length }))
    .filter((x) => x.n > 0),
])
const topic = ref('all')
const shown = computed(() => (topic.value === 'all' ? items.value : items.value.filter((r) => r.topics.includes(topic.value))))
const more = computed(() => Math.max(0, (props.reviews?.count ?? 0) - shown.value.length))
const slides = computed(() => shown.value.length + 1) // + the "read all / write one" card

// slider
const track = ref(null)
const index = ref(0)
function step() {
  const el = track.value
  const first = el?.children[0]
  return first ? first.offsetWidth + parseFloat(getComputedStyle(el).columnGap || 0) : 1
}
// how many cards fit side by side, so the last "page" isn't half empty
const visible = () => Math.max(1, Math.round((track.value?.clientWidth ?? 0) / step()))
const last = () => Math.max(0, slides.value - visible())
function onScroll() {
  if (track.value) index.value = Math.round(track.value.scrollLeft / step())
}
function go(i) {
  const el = track.value
  if (!el) return
  const to = i > last() ? 0 : i < 0 ? last() : i // loops at both ends
  index.value = to
  el.scrollTo({ left: to * step(), behavior: 'smooth' })
}

const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
// paused while the pointer is over it, a finger is on it or it holds keyboard focus
const slider = ref(null)
let touching = false
let timer = 0
function tick() {
  const el = slider.value
  const held = touching || el?.matches(':hover') || el?.contains(document.activeElement)
  if (el && !held && !document.hidden && last() > 0) go(index.value + 1)
}
onMounted(() => {
  if (!reduced) timer = window.setInterval(tick, 5000)
})
onBeforeUnmount(() => window.clearInterval(timer))
watch(topic, () => {
  index.value = 0
  track.value?.scrollTo({ left: 0 })
})
</script>

<template>
  <section v-if="reviews" id="reviews" class="rv">
    <div class="frame">
      <header v-reveal class="head">
        <span class="tag">{{ t('reviews.tag') }}</span>
        <h2>
          <span>{{ tc(section.title, 'reviews.title') }}</span>
          <span class="muted">{{ t('reviews.titleMuted', { p: reviews.recommendPercent }) }}</span>
        </h2>
        <div class="tabs" role="tablist" :aria-label="tc(section.title, 'reviews.title')">
          <button
            v-for="x in tabs"
            :key="x.key"
            type="button"
            role="tab"
            :aria-selected="topic === x.key"
            :class="{ on: topic === x.key }"
            @click="topic = x.key"
          >
            {{ t(`reviews.topics.${x.key}`) }} <span class="n">{{ x.n }}</span>
          </button>
        </div>
      </header>

      <div ref="slider" class="slider" @touchstart.passive="touching = true" @touchend.passive="touching = false">
        <ul ref="track" class="track" aria-live="polite" @scroll.passive="onScroll">
          <li v-for="(r, i) in shown" :key="r.name + r.date" class="cell">
            <article class="card" :class="{ on: i === index }">
              <span class="bg" aria-hidden="true" />
              <span class="chip">{{ reviews.source }}</span>
              <h3>{{ r.name }}</h3>
              <p class="body">“{{ r.text }}”</p>
              <p class="foot">
                <Icon name="check" :size="13" /> {{ t('reviews.recommend') }} · {{ fmt(r.date) }}
                <span v-for="k in r.topics" :key="k" class="pill">{{ t(`reviews.topics.${k}`) }}</span>
              </p>
            </article>
          </li>
          <li class="cell">
            <a :href="reviews.url" target="_blank" rel="noopener" class="card cta" :class="{ on: index === shown.length }">
              <span class="bg" aria-hidden="true" />
              <span class="chip">{{ reviews.source }}</span>
              <h3>{{ more ? t('reviews.moreTitle', { n: more, source: reviews.source }) : t('reviews.writeTitle') }}</h3>
              <p class="body">{{ t('reviews.scoreBody', { source: reviews.source }) }}</p>
              <p class="foot"><Icon name="facebook" :size="13" /> {{ t('reviews.readAll') }} · {{ t('reviews.writeCta') }}</p>
            </a>
          </li>
        </ul>

        <div class="nav">
          <button type="button" class="arrow" :aria-label="t('reviews.prev')" @click="go(index - 1)">
            <Icon name="chevron-left" :size="18" />
          </button>
          <span class="dots" aria-hidden="true"><i v-for="i in slides" :key="i" :class="{ on: i - 1 === index }" /></span>
          <button type="button" class="arrow" :aria-label="t('reviews.next')" @click="go(index + 1)">
            <Icon name="chevron-right" :size="18" />
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.rv {
  --line: rgb(255 255 255 / 0.09);
  /* transparent: the page's ambient light shows through */
  border-block: 1px solid var(--line);
}
/* hairline frame: side rails plus a rule under the header */
.frame {
  max-width: 1240px;
  margin-inline: auto;
  border-inline: 1px solid var(--line);
}
.head {
  display: grid;
  justify-items: center;
  gap: clamp(1.25rem, 2.6vw, 2rem);
  padding: clamp(3.5rem, 7vw, 5.5rem) var(--gutter) clamp(2rem, 4vw, 3rem);
  border-bottom: 1px solid var(--line);
  text-align: center;
}
.tag {
  padding: 4px 12px;
  border-radius: 6px;
  background: rgb(255 255 255 / 0.08);
  font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
  font-size: 0.68rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgb(255 255 255 / 0.62);
}
h2 {
  display: grid;
  font-family: var(--font-body);
  font-size: clamp(2.1rem, 1.2rem + 3vw, 3.6rem);
  font-weight: 400;
  line-height: 1.18;
  letter-spacing: -0.025em;
  color: #f4f5f6;
}
h2 .muted {
  color: #8fa2a8;
}
/* one row of topic tabs; on a narrow screen the row scrolls sideways instead of wrapping */
.tabs {
  display: flex;
  gap: 2px;
  max-width: 100%;
  padding: 5px;
  overflow-x: auto;
  scrollbar-width: none;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: rgb(255 255 255 / 0.05);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
}
.tabs::-webkit-scrollbar {
  display: none;
}
.tabs button {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px;
  border: 0;
  border-radius: 8px;
  background: none;
  color: rgb(255 255 255 / 0.6);
  font-size: var(--fs-sm);
  white-space: nowrap;
  cursor: pointer;
  transition:
    background var(--dur-base) var(--ease-out),
    color var(--dur-base) var(--ease-out);
}
.tabs button:hover {
  color: #fff;
}
.tabs .n {
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  display: inline-grid;
  place-items: center;
  border-radius: 10px;
  background: rgb(255 255 255 / 0.12);
  font-size: 0.7rem;
  font-weight: 600;
}
.tabs button.on {
  background: #fff;
  color: #1c2226;
}
.tabs button.on .n {
  background: var(--accent);
  color: #fff;
}

.slider {
  padding: 14px 14px 22px;
}
.track {
  display: flex;
  gap: 14px;
  margin: 0;
  padding: 6px 0 0;
  list-style: none;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  overscroll-behavior-x: contain;
  scrollbar-width: none;
}
.track::-webkit-scrollbar {
  display: none;
}
.cell {
  flex: 0 0 calc((100% - 28px) / 3);
  scroll-snap-align: start;
  display: grid;
}
.card {
  position: relative;
  isolation: isolate;
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  gap: 14px;
  min-height: 260px;
  padding: 18px 16px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: linear-gradient(160deg, rgb(255 255 255 / 0.07), rgb(255 255 255 / 0.02));
  -webkit-backdrop-filter: blur(16px);
  backdrop-filter: blur(16px);
  color: #f4f5f6;
  overflow: hidden;
  transition:
    color 0.45s var(--ease-out),
    border-color 0.45s var(--ease-out),
    box-shadow 0.45s var(--ease-out);
}
/* the frosted slate card marks the current slide */
.bg {
  position: absolute;
  inset: 0;
  z-index: -1;
  background:
    linear-gradient(180deg, rgb(120 138 146 / 0.92) 0%, rgb(96 108 114 / 0.75) 55%, rgb(120 132 136 / 0.9) 100%),
    url(/media/categories/sedan.webp) center 70% / cover;
  opacity: 0;
  transition: opacity 0.45s var(--ease-out);
}
.bg::after {
  content: '';
  position: absolute;
  inset: 0;
  -webkit-backdrop-filter: blur(22px);
  backdrop-filter: blur(22px);
}
.card.on {
  color: #fff;
  border-color: transparent;
  box-shadow: 0 34px 40px -26px rgb(0 0 0 / 0.7);
}
.card.on .bg {
  opacity: 1;
}
.chip {
  justify-self: start;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgb(79 191 139 / 0.16);
  color: #7fd8a8;
  font-size: 0.7rem;
  transition:
    background 0.45s var(--ease-out),
    color 0.45s var(--ease-out);
}
.card.on .chip {
  background: rgb(255 255 255 / 0.22);
  color: #fff;
}
h3 {
  font-family: var(--font-body);
  font-size: clamp(1.3rem, 1rem + 0.8vw, 1.6rem);
  font-weight: 400;
  letter-spacing: -0.02em;
  line-height: 1.2;
}
.body {
  font-size: var(--fs-sm);
  line-height: 1.55;
  color: rgb(255 255 255 / 0.66);
  transition: color 0.45s var(--ease-out);
}
.card.on .body {
  color: rgb(255 255 255 / 0.88);
}
.foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-xs);
  color: rgb(255 255 255 / 0.5);
  transition: color 0.45s var(--ease-out);
}
.card.on .foot {
  color: rgb(255 255 255 / 0.8);
}
.pill {
  padding: 1px 8px;
  border: 1px solid rgb(255 255 255 / 0.2);
  border-radius: 999px;
}
.cta .foot {
  font-weight: 600;
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
}
.arrow:hover {
  background: rgb(255 255 255 / 0.16);
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

@media (max-width: 1000px) {
  .cell {
    flex-basis: calc((100% - 14px) / 2);
  }
}
@media (max-width: 560px) {
  .head {
    padding-inline: 12px;
  }
  .cell {
    flex-basis: 86%;
  }
  .card {
    min-height: 220px;
  }
}
</style>
