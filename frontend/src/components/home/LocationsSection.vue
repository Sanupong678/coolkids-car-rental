<script setup>
import { computed } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { useI18n } from '@/i18n'

// Pick-up point + delivery terms + contact. OpenStreetMap embed (no API key).
const props = defineProps({
  section: { type: Object, required: true },
  locations: { type: Array, required: true },
  contact: { type: Object, default: null },
})

const loc = computed(() => props.locations[0])
const mapSrc = computed(() => {
  if (!loc.value) return ''
  const { latitude: lat, longitude: lng } = loc.value
  const d = 0.03
  return `https://www.openstreetmap.org/export/embed.html?bbox=${lng - d}%2C${lat - d}%2C${lng + d}%2C${lat + d}&layer=mapnik&marker=${lat}%2C${lng}`
})
const { t, tc, tx } = useI18n()
const hours = (l) => {
  const all = l?.opening_hours?.all?.[0]
  return all ? t('loc.everyday', { h: all.join(' – ') }) : ''
}
</script>

<template>
  <section id="locations" class="section">
    <div class="container grid">
      <div v-reveal class="info">
        <h2>{{ tc(section.title, 'loc.title') }}</h2>
        <p class="sub">{{ tc(section.subtitle, 'loc.sub') }}</p>
        <ul v-if="loc" class="facts">
          <li><Icon name="pin" :size="18" /><div><strong>{{ tx(loc.name) }}</strong><span>{{ tx(loc.address_line1) }}, {{ tx(loc.city) }}</span></div></li>
          <li><Icon name="clock" :size="18" /><div><strong>{{ t('loc.hours') }}</strong><span>{{ hours(loc) }}</span></div></li>
          <li><Icon name="car" :size="18" /><div><strong>{{ t('loc.delivery') }}</strong><span>{{ t('loc.area') }}</span></div></li>
        </ul>
        <div v-if="contact" class="ctas">
          <a :href="`tel:${contact.phone.replaceAll('-', '')}`" class="btn btn-dark btn-pill"><Icon name="phone" :size="16" /> {{ contact.phone }}</a>
          <a :href="contact.line" target="_blank" rel="noopener" class="btn btn-pill line">LINE {{ contact.lineId }}</a>
        </div>
      </div>
      <div v-reveal="{ from: 'right' }" class="map">
        <iframe v-if="mapSrc" :src="mapSrc" :title="t('loc.map', { name: loc.name })" loading="lazy" referrerpolicy="no-referrer" />
        <a
          v-if="loc"
          class="btn btn-sm btn-pill directions"
          :href="`https://www.google.com/maps/dir/?api=1&destination=${loc.latitude},${loc.longitude}`"
          target="_blank"
          rel="noopener"
        >
          <Icon name="map" :size="14" /> {{ t('loc.directions') }}
        </a>
      </div>
    </div>
  </section>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: 1fr 1.25fr;
  gap: clamp(2rem, 5vw, 4rem);
  align-items: stretch;
}
.info {
  display: grid;
  gap: var(--s-5);
  align-content: start;
}
h2 {
  font-size: clamp(2rem, 1.3rem + 2.6vw, 3.25rem);
  font-weight: 700;
}
.sub {
  color: var(--text-muted);
}
.facts {
  display: grid;
  gap: var(--s-4);
  margin: 0;
  padding: 0;
  list-style: none;
}
.facts li {
  display: flex;
  gap: var(--s-3);
  padding-bottom: var(--s-4);
  border-bottom: 1px solid var(--border);
}
.facts :deep(svg) {
  flex: none;
  color: var(--accent);
  margin-top: 2px;
}
.facts strong {
  display: block;
}
.facts span {
  font-size: var(--fs-sm);
  color: var(--text-muted);
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
.map {
  position: relative;
  min-height: 440px;
  border-radius: var(--r-lg);
  overflow: hidden;
  background: var(--surface);
}
iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  filter: grayscale(0.6) contrast(1.05);
}
.directions {
  position: absolute;
  right: var(--s-4);
  bottom: var(--s-4);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}
@media (max-width: 860px) {
  .grid {
    grid-template-columns: 1fr;
  }
  .map {
    min-height: 320px;
  }
}
</style>
