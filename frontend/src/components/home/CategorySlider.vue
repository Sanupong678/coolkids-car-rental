<script setup>
import { t, catName } from '@/i18n'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/ui/Icon.vue'
import { money } from '@/utils/format'

// "Choose your style" (poster reference): one tall colour capsule per category,
// each showing a zoomed detail of that category's car, with the active
// category's car standing in front across all of them.
// Hover/focus a name or capsule → its capsule bounces up, the others turn grey,
// and the front car drives in. Click → the fleet filtered by that category.
const props = defineProps({
  section: { type: Object, required: true },
  categories: { type: Array, required: true },
})
const router = useRouter()

// Capsule colours and which part of the car the zoomed detail shows (x% y%).
const LOOK = {
  suv: { color: '#3c4a5d', focus: '68% 42%' },
  sedan: { color: '#d63a2f', focus: '96% 46%' },
  eco: { color: '#5d8a6c', focus: '22% 52%' },
  premium: { color: '#1f1f24', focus: '24% 50%' },
}
const FALLBACK = ['#3c4a5d', '#d63a2f', '#5d8a6c', '#1f1f24']
const look = (c, i) => LOOK[c.slug] ?? { color: FALLBACK[i % FALLBACK.length], focus: '50% 45%' }

const active = ref(0)
const current = computed(() => props.categories[active.value])
const img = (c, w = 'w1200') => c?.image_variants?.[w] ?? c?.image_url
const open = (c) => router.push({ name: 'vehicles', query: { category: c.slug } })
</script>

<template>
  <section id="explore" class="section cats">
    <div class="container">
      <div v-reveal class="head">
        <h2>{{ section.title }}</h2>
        <p v-if="section.subtitle">{{ section.subtitle }}</p>
      </div>

      <div class="stage">
        <div class="capsules">
          <button
            v-for="(c, i) in categories"
            :key="c.id"
            type="button"
            class="capsule"
            :class="{ on: active === i }"
            :style="{ '--c': look(c, i).color, '--focus': look(c, i).focus, '--img': `url(${img(c, 'w1200')})`, '--i': i }"
            :aria-label="t('home.catAria', { name: catName(c), n: c.available_count })"
            @mouseenter="active = i"
            @focus="active = i"
            @click="open(c)"
          >
            <span class="detail" aria-hidden="true" />
            <span class="cap-name">{{ catName(c) }}</span>
            <span class="cap-go" aria-hidden="true"><Icon name="arrow-right" :size="14" /></span>
          </button>
        </div>

        <!-- the active category's car, in front of all capsules -->
        <div class="front" aria-hidden="true">
          <Transition name="drive" mode="out-in">
            <img v-if="current" :key="current.slug" :src="img(current, 'w2000')" alt="" />
          </Transition>
          <span class="floor" />
        </div>
      </div>

      <ul class="names">
        <li v-for="(c, i) in categories" :key="c.id">
          <button
            type="button"
            :class="{ on: active === i }"
            :style="{ '--c': look(c, i).color }"
            @mouseenter="active = i"
            @focus="active = i"
            @click="open(c)"
          >
            <strong>{{ catName(c) }}</strong>
            <small>{{ t('home.catMeta', { n: c.available_count, price: money(c.from_daily_minor, c.currency) }) }}</small>
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.cats {
  padding-top: clamp(4rem, 7vw, 6rem);
}
.head {
  display: grid;
  justify-items: center;
  gap: var(--s-2);
  text-align: center;
  margin-bottom: clamp(2rem, 4vw, 3rem);
}
h2 {
  font-size: clamp(2rem, 1.3rem + 2.6vw, 3.25rem);
  font-weight: 700;
}
.head p {
  color: var(--text-muted);
}

.stage {
  position: relative;
  max-width: 1080px;
  height: clamp(380px, 44vw, 580px);
  margin: 0 auto;
}
.capsules {
  position: absolute;
  inset: 0 0 10% 0;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: clamp(10px, 2vw, 22px);
}
.capsule {
  --lift: 0px;
  position: relative;
  display: block;
  padding: 0;
  border: 0;
  border-radius: 999px;
  overflow: hidden;
  isolation: isolate;
  cursor: pointer;
  background:
    radial-gradient(90% 50% at 50% 0%, color-mix(in srgb, #fff 28%, var(--c)), transparent 70%),
    var(--c);
  transform: translateY(var(--lift));
  filter: grayscale(1) brightness(1.08) contrast(0.85);
  opacity: 0.62;
  transition:
    transform 0.6s cubic-bezier(0.34, 1.7, 0.5, 1),
    filter 0.45s var(--ease-out),
    opacity 0.45s var(--ease-out),
    box-shadow 0.45s var(--ease-out);
  animation: float 6s ease-in-out calc(var(--i) * -1.4s) infinite;
}
.capsule.on {
  --lift: -26px;
  filter: none;
  opacity: 1;
  box-shadow: 0 30px 50px -28px var(--c);
}
/* zoomed detail of the category's car, multiplied into the capsule colour (duotone) */
.detail {
  position: absolute;
  inset: 0;
  z-index: -1;
  background-image: var(--img);
  background-size: 300% auto;
  background-position: var(--focus);
  background-repeat: no-repeat;
  mix-blend-mode: multiply;
  opacity: 0.9;
  transition: background-size 1.2s var(--ease-out);
}
.detail::after {
  /* deepen the lower end so the front car stands out against it */
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 45%, color-mix(in srgb, #000 30%, var(--c)) 100%);
}
.capsule.on .detail {
  background-size: 330% auto;
}
.cap-name {
  position: absolute;
  top: 12%;
  left: 0;
  right: 0;
  padding: 0 10%;
  color: #fff;
  font-family: 'Unbounded', var(--font-display);
  font-weight: 600;
  font-size: clamp(0.7rem, 0.5rem + 0.6vw, 1rem);
  line-height: 1.2;
  text-align: center;
  text-shadow: 0 2px 10px rgb(0 0 0 / 0.35);
}
.cap-go {
  position: absolute;
  left: 50%;
  bottom: 9%;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: #fff;
  color: #111;
  transform: translateX(-50%) rotate(-45deg) scale(0.6);
  opacity: 0;
  transition:
    opacity 0.3s var(--ease-out),
    transform 0.45s cubic-bezier(0.34, 1.7, 0.5, 1);
}
.capsule.on .cap-go {
  opacity: 1;
  transform: translateX(-50%) rotate(-45deg) scale(1);
}

/* front car */
.front {
  position: absolute;
  left: 8%;
  right: 8%;
  bottom: 0;
  height: 42%;
  display: grid;
  place-items: end center;
  pointer-events: none;
}
.front img {
  position: relative;
  z-index: 1;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  filter: drop-shadow(0 24px 18px rgb(0 0 0 / 0.3));
}
.floor {
  position: absolute;
  left: 12%;
  right: 12%;
  bottom: -4%;
  height: 16%;
  border-radius: 50%;
  background: radial-gradient(closest-side, rgb(0 0 0 / 0.28), transparent);
}
.drive-enter-active {
  transition:
    transform 0.6s cubic-bezier(0.16, 0.84, 0.3, 1),
    opacity 0.6s var(--ease-out),
    filter 0.6s var(--ease-out);
}
.drive-leave-active {
  transition:
    transform 0.25s ease-in,
    opacity 0.25s ease-in;
}
.drive-enter-from {
  opacity: 0;
  transform: translateX(-28%);
  filter: blur(8px) drop-shadow(0 24px 18px rgb(0 0 0 / 0.3));
}
.drive-leave-to {
  opacity: 0;
  transform: translateX(22%);
}

/* names under the capsules */
.names {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: clamp(10px, 2vw, 22px);
  max-width: 1080px;
  margin: clamp(1.5rem, 3vw, 2.5rem) auto 0;
  padding: 0;
  list-style: none;
}
.names button {
  display: grid;
  justify-items: center;
  gap: 4px;
  width: 100%;
  padding: 10px 6px;
  border: 0;
  border-radius: 14px;
  background: none;
  cursor: pointer;
  color: var(--text-muted);
  transition:
    color 0.3s var(--ease-out),
    background 0.3s var(--ease-out);
}
.names strong {
  font-family: 'Unbounded', var(--font-display);
  font-weight: 600;
  font-size: clamp(0.78rem, 0.6rem + 0.5vw, 1.05rem);
}
.names small {
  font-size: var(--fs-xs);
}
.names button.on {
  color: var(--text);
  background: color-mix(in srgb, var(--c) 10%, transparent);
}
.names button.on strong {
  color: var(--c);
}

@keyframes float {
  0%,
  100% {
    translate: 0 0;
  }
  50% {
    translate: 0 -6px;
  }
}
@media (max-width: 720px) {
  .stage {
    height: 340px;
  }
  .capsules {
    gap: 8px;
  }
  .cap-name {
    font-size: 0.62rem;
    padding: 0 6%;
  }
  .front {
    left: 0;
    right: 0;
    height: 42%;
  }
  .names {
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .capsule {
    animation: none;
    transition: filter 0.2s, opacity 0.2s;
  }
}
</style>
