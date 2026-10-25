<script setup>
import { t, tc, catName } from '@/i18n'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { RouterLink } from 'vue-router'
import Icon from '@/components/ui/Icon.vue'
import { label, money } from '@/utils/format'
import { wheelRig } from '@/utils/wheels'

// Showroom carousel (Arcar reference): one car centred on a pale studio floor,
// its model name huge behind it, glass arrows on both sides, dots and CTAs below.
// Changing car is a physical drive, never a fade: the current car rolls out of
// frame while the next one rolls in from the opposite side, both on one eased
// timeline. The wheels turn with the distance travelled (angle = offset / radius),
// so they roll the right way, stop when the car parks, and never spin on their own.
//   ← arrow: cars travel → (previous car enters from the left)
//   → arrow: cars travel ← (next car enters from the right)
const props = defineProps({
  section: { type: Object, required: true },
  vehicles: { type: Array, required: true },
})

const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const DURATION = 950 // ms

const list = computed(() => props.vehicles.filter((v) => v.image))
const index = ref(0)
const current = computed(() => list.value[index.value])
const dir = ref(1) // +1: cars travel left (→ pressed), -1: cars travel right (← pressed)

// Cars on stage: normally one; two while driving. Each has its own DOM node,
// moved directly (no reactive writes per frame).
let uid = 0
const slots = shallowRef([])
const carEls = new Map()
const setCarEl = (key) => (el) => (el ? carEls.set(key, el) : carEls.delete(key))
const stage = ref(null)

const img = (v) => v.image?.variants?.w1200 ?? v.image?.url
const rigOf = (v) => wheelRig(img(v))
const aspectOf = (v) => rigOf(v)?.aspect ?? 2
const daily = (v) => v.price.discountedDailyMinor ?? v.price.dailyMinor
const pad = (n) => String(n).padStart(2, '0')

// rotate the rim only: the tyre is plain rubber, and the fender often overlaps the tyre top
const wheelClip = (w) => `ellipse(${w[2] * 0.66}% ${w[3] * 0.66}% at ${w[0]}% ${w[1]}%)`

// Ease: gentle start, firmer through the middle, long settle — no overshoot.
function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
  const sx = (t) => ((ax * t + bx) * t + cx) * t
  const sy = (t) => ((ay * t + by) * t + cy) * t
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx
  return (x) => {
    let t = x
    for (let i = 0; i < 6; i++) {
      const d = dx(t)
      if (Math.abs(d) < 1e-6) break
      t -= (sx(t) - x) / d
    }
    return sy(Math.min(1, Math.max(0, t)))
  }
}
const ease = bezier(0.62, 0, 0.22, 1)

// Place one car at horizontal offset x (px from centre) and roll its wheels to match.
function place(slot, x) {
  const el = carEls.get(slot.key)
  if (!el) return
  el.style.transform = `translate3d(${x}px, 0, 0)`
  const rig = rigOf(slot.v)
  if (!rig) return
  const h = el.offsetHeight
  el.querySelectorAll('.wheel img').forEach((wi, i) => {
    const [, , rx, ry] = rig.wheels[i]
    const r = (ry / 100) * h * 0.97 // rolling radius ≈ visible tyre height
    const k = (rx * rig.aspect) / ry // ellipse → circle and back
    wi.style.transform = `scaleX(${k}) rotate(${x / r}rad) scaleX(${1 / k})`
  })
}

let busy = false
let raf = 0
async function show(to, d) {
  if (busy || to === index.value || !list.value[to]) return
  busy = true
  dir.value = d
  const out = slots.value[0]
  const inc = { key: ++uid, v: list.value[to] }
  slots.value = [out, inc]
  index.value = to
  await nextTick()

  const stageW = stage.value?.offsetWidth ?? window.innerWidth
  const carW = carEls.get(out.key)?.offsetWidth ?? 600
  const travel = stageW / 2 + carW / 2 + 60 // fully out of frame
  place(inc, d * travel)

  const finish = () => {
    slots.value = [inc]
    busy = false
    nextTick(() => place(inc, 0))
  }
  if (reduced) return finish()

  const t0 = performance.now()
  const step = (now) => {
    const t = Math.min(1, (now - t0) / DURATION)
    const e = ease(t)
    place(out, -d * travel * e)
    place(inc, d * travel * (1 - e))
    if (t < 1) raf = requestAnimationFrame(step)
    else finish()
  }
  raf = requestAnimationFrame(step)
}

const n = computed(() => list.value.length)
const next = () => show((index.value + 1) % n.value, 1)
const prev = () => show((index.value - 1 + n.value) % n.value, -1)
const goTo = (i) => show(i, i > index.value ? 1 : -1)

// swipe
let sx = null
const down = (e) => (sx = e.clientX)
function up(e) {
  if (sx == null) return
  const dx = e.clientX - sx
  sx = null
  if (Math.abs(dx) > 40) (dx < 0 ? next : prev)()
}
function key(e) {
  if (e.key === 'ArrowRight') next()
  else if (e.key === 'ArrowLeft') prev()
  else return
  e.preventDefault()
}

const init = () => {
  if (!slots.value.length && list.value.length) slots.value = [{ key: ++uid, v: list.value[0] }]
}
init()
onMounted(init)
// vehicles may arrive after mount
watch(list, init)
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <section v-if="list.length" id="explore" class="fc" aria-roledescription="carousel" :aria-label="tc(section.title, 'nav.vehicles')">
    <div class="container head">
      <div v-reveal>
        <p class="kicker"><i /> {{ tc(section.title, 'cat.kicker') }}</p>
        <p v-if="section.subtitle" class="sub">{{ section.subtitle }}</p>
      </div>
      <p class="count" aria-live="polite">
        <strong>{{ pad(index + 1) }}</strong> / {{ pad(n) }}
      </p>
    </div>

    <div
      ref="stage"
      class="stage"
      tabindex="0"
      @keydown="key"
      @pointerdown="down"
      @pointerup="up"
      @pointercancel="sx = null"
    >
      <!-- model name, huge, behind the car -->
      <div class="word" aria-hidden="true">
        <Transition :name="dir > 0 ? 'word-l' : 'word-r'">
          <div :key="current.id" class="word-in">
            <span class="brand">{{ current.brand }}</span>
            <span class="model">{{ current.model }}</span>
          </div>
        </Transition>
      </div>

      <span class="floor" aria-hidden="true" />

      <div class="track">
        <div
          v-for="s in slots"
          :key="s.key"
          :ref="setCarEl(s.key)"
          class="car"
          :style="{ '--ar': aspectOf(s.v) }"
        >
          <img class="body" :src="img(s.v)" :alt="s.v.image.alt ?? `${s.v.brand} ${s.v.model}`" draggable="false" />
          <template v-if="rigOf(s.v)">
            <div v-for="(w, i) in rigOf(s.v).wheels" :key="i" class="wheel" :style="{ clipPath: wheelClip(w) }" aria-hidden="true">
              <img :src="img(s.v)" alt="" draggable="false" :style="{ transformOrigin: `${w[0]}% ${w[1]}%` }" />
            </div>
          </template>
        </div>
      </div>

      <button type="button" class="nav glass prev" :aria-label="t('home.prevCar')" @click="prev">
        <Icon name="arrow-left" :size="18" />
      </button>
      <button type="button" class="nav glass next" :aria-label="t('home.nextCar')" @click="next">
        <Icon name="arrow-right" :size="18" />
      </button>
    </div>

    <div class="container below">
      <div class="info glass">
        <Transition name="fade" mode="out-in">
          <div :key="current.id" class="info-in">
            <div class="name">
              <span class="cat">{{ catName(current.category) }} · {{ current.year }}</span>
              <h3>{{ current.brand }} {{ current.model }} <small>{{ current.trim }}</small></h3>
              <ul class="spec">
                <li><Icon name="users" :size="13" /> {{ t('home.seats', { n: current.specs.seats }) }}</li>
                <li><Icon name="gear" :size="13" /> {{ label(current.specs.transmission) }}</li>
                <li><Icon :name="current.specs.fuel === 'ELECTRIC' ? 'bolt' : 'fuel'" :size="13" /> {{ label(current.specs.fuel) }}</li>
              </ul>
            </div>
            <p class="price"><strong>{{ money(daily(current), current.price.currency) }}</strong>{{ t('home.perDay') }}</p>
          </div>
        </Transition>
        <div class="ctas">
          <RouterLink :to="{ name: 'vehicle', params: { slug: current.slug }, hash: '#availability' }" class="btn btn-dark btn-pill">
            {{ t('home.rentNow') }}
          </RouterLink>
          <RouterLink :to="{ name: 'vehicle', params: { slug: current.slug } }" class="btn btn-pill ghost">
            {{ t('home.details') }} <Icon name="arrow-right" :size="14" class="arrow" />
          </RouterLink>
        </div>
      </div>

      <div class="dots" role="tablist" :aria-label="t('home.pickCar')" :style="{ '--i': index }">
        <span class="pill" aria-hidden="true" />
        <button
          v-for="(v, i) in list"
          :key="v.id"
          type="button"
          role="tab"
          :aria-selected="i === index"
          :aria-label="`${v.brand} ${v.model}`"
          @click="goTo(i)"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.fc {
  position: relative;
  overflow: hidden;
  padding: clamp(4rem, 7vw, 6rem) 0 clamp(3rem, 6vw, 5rem);
  background:
    radial-gradient(60% 55% at 50% 58%, #ffffff 0%, transparent 70%),
    radial-gradient(40% 30% at 18% 20%, rgb(226 54 44 / 0.08), transparent 70%),
    linear-gradient(180deg, var(--bg) 0%, #e9e9e6 100%);
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: var(--s-4);
}
.kicker {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: var(--fs-sm);
  font-weight: 600;
  letter-spacing: 0.04em;
}
.kicker i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
}
.sub {
  margin-top: 4px;
  font-size: var(--fs-sm);
  color: var(--text-muted);
}
.count {
  font-size: var(--fs-sm);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.count strong {
  color: var(--text);
  font-size: var(--fs-lg);
}

/* ---------- stage ---------- */
.stage {
  --car-w: min(56vw, 640px, (clamp(300px, 40vw, 470px) - 40px) * 2.1);
  position: relative;
  height: clamp(300px, 40vw, 470px);
  margin-top: var(--s-4);
  outline: none;
  touch-action: pan-y;
  user-select: none;
}
.stage:focus-visible {
  box-shadow: inset 0 0 0 2px var(--accent);
}

.word {
  position: absolute;
  inset: 4% 0 auto;
  display: grid;
  pointer-events: none;
}
.word-in {
  grid-area: 1 / 1;
  display: grid;
  justify-items: center;
  text-align: center;
  line-height: 0.9;
}
.brand {
  font-family: var(--font-display);
  font-size: clamp(0.8rem, 0.6rem + 0.6vw, 1.15rem);
  font-weight: 600;
  letter-spacing: 0.4em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 0.4em;
}
.model {
  font-family: var(--font-display);
  font-weight: 800;
  font-size: clamp(3rem, 1rem + 10vw, 10.5rem);
  letter-spacing: -0.03em;
  white-space: nowrap;
  background: linear-gradient(180deg, rgb(18 19 25 / 0.2), rgb(18 19 25 / 0.04) 85%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.word-l-enter-active,
.word-l-leave-active,
.word-r-enter-active,
.word-r-leave-active {
  transition:
    transform 950ms cubic-bezier(0.62, 0, 0.22, 1),
    opacity 700ms var(--ease-out);
}
.word-l-enter-from,
.word-r-leave-to {
  transform: translateX(14%);
  opacity: 0;
}
.word-l-leave-to,
.word-r-enter-from {
  transform: translateX(-14%);
  opacity: 0;
}

.floor {
  position: absolute;
  left: 50%;
  bottom: 4%;
  width: calc(var(--car-w) * 1.05);
  height: 16%;
  transform: translateX(-50%);
  border-radius: 50%;
  background: radial-gradient(closest-side, rgb(0 0 0 / 0.22), rgb(0 0 0 / 0.06) 60%, transparent);
  filter: blur(6px);
}

.track {
  position: absolute;
  inset: 0;
}
.car {
  position: absolute;
  left: calc(50% - var(--car-w) / 2);
  bottom: 9%;
  width: var(--car-w);
  aspect-ratio: var(--ar);
  max-height: 84%;
  will-change: transform;
}
.car img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill; /* the box already has the image's aspect ratio */
  -webkit-user-drag: none;
}
.body {
  filter: drop-shadow(0 18px 14px rgb(0 0 0 / 0.18));
}
.wheel {
  position: absolute;
  inset: 0;
}
.wheel img {
  will-change: transform;
}

.nav {
  position: absolute;
  top: 50%;
  z-index: 2;
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  border-radius: 50%;
  color: var(--text);
  cursor: pointer;
  transform: translateY(-50%);
  transition:
    background var(--dur-base) var(--ease-out),
    color var(--dur-base) var(--ease-out);
}
.nav:hover {
  background: var(--text);
  color: #fff;
}
.prev {
  left: max(var(--gutter), calc((100% - var(--content-max)) / 2 + var(--gutter)));
}
.next {
  right: max(var(--gutter), calc((100% - var(--content-max)) / 2 + var(--gutter)));
}

/* ---------- info + CTAs ---------- */
.below {
  display: grid;
  justify-items: center;
  gap: var(--s-5);
  margin-top: var(--s-3);
}
.info {
  display: flex;
  align-items: center;
  gap: var(--s-6);
  width: min(100%, 860px);
  padding: 14px 14px 14px 26px;
  border-radius: var(--r-pill);
}
.info-in {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-5);
  min-width: 0;
}
.cat {
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
.name h3 {
  font-family: var(--font-body);
  font-size: var(--fs-lg);
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.name h3 small {
  font-size: var(--fs-xs);
  font-weight: 500;
  color: var(--text-muted);
}
.spec {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
.spec li {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.price {
  font-size: var(--fs-xs);
  color: var(--text-muted);
  white-space: nowrap;
}
.price strong {
  font-size: var(--fs-xl);
  color: var(--text);
}
.ctas {
  display: flex;
  gap: var(--s-2);
  flex-shrink: 0;
}
.ghost {
  border: 1px solid var(--border-strong);
  background: rgb(255 255 255 / 0.5);
  color: var(--text);
}
.ghost:hover {
  background: #fff;
}
.fade-enter-active,
.fade-leave-active {
  transition:
    opacity 0.32s var(--ease-out),
    transform 0.32s var(--ease-out);
}
.fade-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.dots {
  --dot: 8px;
  --gap: 10px;
  position: relative;
  display: flex;
  gap: var(--gap);
}
.dots button {
  width: var(--dot);
  height: var(--dot);
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgb(18 19 25 / 0.18);
  cursor: pointer;
}
.dots button:hover {
  background: rgb(18 19 25 / 0.4);
}
.pill {
  position: absolute;
  top: -3px;
  left: -5px;
  width: calc(var(--dot) + 10px);
  height: calc(var(--dot) + 6px);
  border-radius: var(--r-pill);
  border: 2px solid var(--accent);
  transform: translateX(calc(var(--i) * (var(--dot) + var(--gap))));
  transition: transform 950ms cubic-bezier(0.62, 0, 0.22, 1);
  pointer-events: none;
}

@media (max-width: 760px) {
  .stage {
    --car-w: 86vw;
    height: 300px;
  }
  .nav {
    top: auto;
    bottom: -8px;
    width: 44px;
    height: 44px;
    transform: none;
  }
  .info {
    flex-direction: column;
    align-items: stretch;
    gap: var(--s-3);
    padding: 16px;
    border-radius: var(--r-lg);
  }
  .info-in {
    flex-wrap: wrap;
  }
  .ctas > * {
    flex: 1;
    justify-content: center;
  }
}
@media (prefers-reduced-motion: reduce) {
  .pill,
  .word-l-enter-active,
  .word-l-leave-active,
  .word-r-enter-active,
  .word-r-leave-active {
    transition: none;
  }
}
</style>
