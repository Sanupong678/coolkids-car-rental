<script setup>
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

// "Top brands" wall from the GoCars reference, as an infinite marquee of
// wordmarks. Brands are derived from the live fleet (no hard-coded logos).
const props = defineProps({
  section: { type: Object, required: true },
  brands: { type: Array, required: true },
})
const loop = computed(() => [...props.brands, ...props.brands, ...props.brands])
</script>

<template>
  <section v-if="brands.length" class="strip" :aria-label="section.title">
    <p class="label">{{ section.title }}</p>
    <div class="marquee">
      <div class="row">
        <RouterLink
          v-for="(b, i) in loop"
          :key="i"
          :to="{ name: 'vehicles', query: { brand: b.name } }"
          class="brand"
          :tabindex="i >= brands.length ? -1 : 0"
          :aria-hidden="i >= brands.length"
        >
          {{ b.name }}<sup>{{ b.count }}</sup>
        </RouterLink>
      </div>
    </div>
  </section>
</template>

<style scoped>
.strip {
  padding-block: var(--s-7);
  border-bottom: 1px solid var(--border);
}
.label {
  text-align: center;
  font-size: var(--fs-xs);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: var(--s-5);
}
.marquee {
  overflow: hidden;
  mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
}
.row {
  display: flex;
  gap: clamp(2.5rem, 6vw, 5rem);
  width: max-content;
  animation: scroll 40s linear infinite;
}
.marquee:hover .row {
  animation-play-state: paused;
}
.brand {
  font-family: var(--font-display);
  font-size: clamp(1.4rem, 3vw, 2.2rem);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgb(255 255 255 / 0.22);
  transition: color var(--dur-base) var(--ease-out);
  white-space: nowrap;
}
.brand:hover {
  color: var(--text);
}
sup {
  font-family: var(--font-body);
  font-size: 0.4em;
  margin-left: 4px;
  color: var(--accent);
}
@keyframes scroll {
  to {
    transform: translateX(-33.333%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .row {
    animation: none;
    flex-wrap: wrap;
    justify-content: center;
    width: auto;
  }
}
</style>
