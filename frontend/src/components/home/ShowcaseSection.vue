<script setup>
import { t } from '@/i18n'
import { computed, ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'

// Exterior / Interior explorer: angled (parallelogram) image panels from the
// Mercedes reference + pulsing hotspots with detail cards from the OVER
// reference. Hotspot positions/content come from the CMS section config.
const props = defineProps({ section: { type: Object, required: true } })

const mode = ref('exterior')
const active = ref(0)
const view = computed(() => props.section.config?.[mode.value] ?? { hotspots: [] })
const detail = computed(() => props.section.config?.detail?.image)
const spot = computed(() => view.value.hotspots?.[active.value])

function setMode(m) {
  mode.value = m
  active.value = 0
}
</script>

<template>
  <section class="section showcase texture">
    <div class="container grid">
      <div class="copy">
        <div v-reveal class="section-head">
          <span class="connector">{{ mode === 'exterior' ? 'Exteriors' : 'Interiors' }}</span>
          <h2>{{ section.title }}</h2>
          <p>{{ section.subtitle }}</p>
        </div>

        <div v-reveal class="toggle" role="tablist" :aria-label="t('home.view')">
          <button
            v-for="m in ['exterior', 'interior']"
            :key="m"
            type="button"
            role="tab"
            :aria-selected="mode === m"
            :class="{ on: mode === m }"
            @click="setMode(m)"
          >
            {{ m }}
          </button>
        </div>

        <ol v-reveal class="spots">
          <li v-for="(h, i) in view.hotspots" :key="h.title" :class="{ on: active === i }">
            <button type="button" @click="active = i">
              <span class="n">0{{ i + 1 }}</span>
              <span>
                <strong>{{ h.title }}</strong>
                <small>{{ h.body }}</small>
              </span>
            </button>
          </li>
        </ol>
      </div>

      <div v-reveal="{ from: 'right' }" class="stage">
        <Transition name="swap" mode="out-in">
          <div :key="mode" class="panel">
            <img :src="view.image" :alt="`${mode} view`" loading="lazy" />
            <button
              v-for="(h, i) in view.hotspots"
              :key="h.title"
              type="button"
              class="dot"
              :class="{ on: active === i }"
              :style="{ left: `${h.x}%`, top: `${h.y}%` }"
              :aria-label="h.title"
              @click="active = i"
            >
              <span />
            </button>
          </div>
        </Transition>

        <Transition name="pop" mode="out-in">
          <div v-if="spot" :key="mode + active" class="card">
            <span class="eyebrow">0{{ active + 1 }} / 0{{ view.hotspots.length }}</span>
            <strong>{{ spot.title }}</strong>
            <p>{{ spot.body }}</p>
          </div>
        </Transition>

        <div v-if="detail" class="detail" aria-hidden="true">
          <img :src="detail" alt="" loading="lazy" />
        </div>
        <span class="tag"><Icon name="eye" :size="14" /> {{ t('home.tapPoints') }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.showcase {
  background-color: var(--surface);
  border-block: 1px solid var(--border);
  overflow: hidden;
}
.grid {
  display: grid;
  grid-template-columns: minmax(280px, 0.8fr) 1.6fr;
  gap: clamp(2rem, 5vw, 5rem);
  align-items: center;
}
.toggle {
  display: inline-flex;
  padding: 4px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-pill);
  margin-bottom: var(--s-5);
}
.toggle button {
  padding: 0.5rem 1.25rem;
  border: 0;
  border-radius: var(--r-pill);
  background: transparent;
  color: var(--text-muted);
  text-transform: uppercase;
  font-size: var(--fs-xs);
  letter-spacing: var(--tracking-caps);
  cursor: pointer;
  transition:
    background var(--dur-base) var(--ease-out),
    color var(--dur-base) var(--ease-out);
}
.toggle button.on {
  background: var(--accent);
  color: var(--text-inverse);
}
.spots {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.spots button {
  display: flex;
  gap: var(--s-4);
  width: 100%;
  padding: var(--s-3) var(--s-4);
  border: 0;
  border-left: 2px solid var(--border);
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--dur-base) var(--ease-out),
    background var(--dur-base) var(--ease-out);
}
.spots li.on button {
  border-left-color: var(--accent);
  background: rgb(255 255 255 / 0.03);
}
.n {
  font-family: var(--font-display);
  color: var(--accent);
  font-size: var(--fs-sm);
}
.spots strong {
  display: block;
  font-weight: 500;
}
.spots small {
  color: var(--text-muted);
}
.stage {
  position: relative;
  aspect-ratio: 16 / 10;
}
.panel {
  position: absolute;
  inset: 0;
  clip-path: polygon(8% 0, 100% 0, 92% 100%, 0 100%);
}
.panel img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.panel::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 60%, rgb(11 12 14 / 0.5));
  pointer-events: none;
}
.dot {
  position: absolute;
  z-index: 1;
  width: 28px;
  height: 28px;
  margin: -14px 0 0 -14px;
  border: 0;
  border-radius: 50%;
  background: rgb(200 169 106 / 0.25);
  cursor: pointer;
  display: grid;
  place-items: center;
}
.dot span {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 2px rgb(11 12 14 / 0.6);
}
.dot::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1px solid var(--accent);
  animation: ping 2s var(--ease-out) infinite;
}
.dot.on {
  background: rgb(200 169 106 / 0.5);
}
.card {
  position: absolute;
  z-index: 2;
  right: 4%;
  bottom: -6%;
  width: min(300px, 70%);
  display: grid;
  gap: var(--s-2);
  padding: var(--s-5);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-md);
  background: var(--surface-glass);
  backdrop-filter: blur(var(--blur-glass)) saturate(140%);
  box-shadow: var(--shadow-lg);
}
.card p {
  color: var(--text-muted);
  font-size: var(--fs-sm);
}
.detail {
  position: absolute;
  z-index: 1;
  left: -6%;
  top: -10%;
  width: 34%;
  aspect-ratio: 16 / 9;
  clip-path: polygon(14% 0, 100% 0, 86% 100%, 0 100%);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-lg);
}
.detail img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.tag {
  position: absolute;
  left: 8%;
  bottom: -2.5rem;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
.swap-enter-active,
.swap-leave-active {
  transition:
    opacity var(--dur-slow) var(--ease-out),
    clip-path var(--dur-slow) var(--ease-out);
}
.swap-enter-from {
  opacity: 0;
  clip-path: polygon(8% 0, 8% 0, 0 100%, 0 100%);
}
.swap-leave-to {
  opacity: 0;
}
.pop-enter-active,
.pop-leave-active {
  transition:
    opacity var(--dur-base) var(--ease-out),
    transform var(--dur-base) var(--ease-out);
}
.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
@keyframes ping {
  from {
    transform: scale(0.6);
    opacity: 1;
  }
  to {
    transform: scale(1.9);
    opacity: 0;
  }
}
@media (max-width: 900px) {
  .grid {
    grid-template-columns: 1fr;
  }
  .detail {
    display: none;
  }
  .card {
    position: relative;
    right: auto;
    bottom: auto;
    width: 100%;
    margin-top: var(--s-4);
  }
  .stage {
    aspect-ratio: auto;
  }
  .panel {
    position: relative;
    aspect-ratio: 16 / 10;
  }
  .tag {
    position: static;
    margin-top: var(--s-3);
  }
}
</style>
