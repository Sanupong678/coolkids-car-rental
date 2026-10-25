<script setup>
import { t } from '@/i18n'
import { RouterLink } from 'vue-router'
import Icon from '@/components/ui/Icon.vue'
import { endsIn, money } from '@/utils/format'

// Promotion cards (spec 1.16): discount, validity window, eligibility, countdown.
defineProps({
  section: { type: Object, required: true },
  promotions: { type: Array, required: true },
})

const discount = (p) =>
  p.discount_type === 'PERCENT'
    ? `${p.discount_value / 100}%`
    : p.discount_type === 'FIXED_PER_DAY'
      ? `${money(p.discount_value, p.currency)}/day`
      : money(p.discount_value, p.currency)
const fmt = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const target = (p) =>
  p.categories.length ? { name: 'vehicles', query: { category: p.categories.map((c) => c.slug).join(',') } } : { name: 'vehicles' }
</script>

<template>
  <section v-if="promotions.length" class="section">
    <div class="container">
      <div v-reveal class="section-head">
        <span class="connector">{{ t('home.offers') }}</span>
        <h2>{{ section.title }}</h2>
      </div>
      <div class="grid">
        <RouterLink v-for="(p, i) in promotions" :key="p.id" v-reveal="{ delay: i * 100 }" :to="target(p)" class="promo">
          <div class="off">
            <strong>{{ discount(p) }}</strong>
            <span>{{ t('home.off') }}</span>
          </div>
          <div class="body">
            <h3>{{ p.name }}</h3>
            <p>{{ p.description }}</p>
            <ul class="meta">
              <li><Icon name="calendar" :size="14" /> {{ fmt(p.starts_at) }} – {{ fmt(p.ends_at) }}</li>
              <li v-if="p.min_rental_days"><Icon name="clock" :size="14" /> {{ p.min_rental_days }}+ days</li>
              <li v-for="c in p.categories" :key="c.slug"><Icon name="car" :size="14" /> {{ c.name }}</li>
            </ul>
          </div>
          <span class="ends"><i />{{ endsIn(p.ends_at) }}</span>
        </RouterLink>
      </div>
    </div>
  </section>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
  gap: var(--s-5);
}
.promo {
  position: relative;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--s-5);
  padding: var(--s-6);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background:
    linear-gradient(120deg, rgb(200 169 106 / 0.12), transparent 45%),
    var(--surface);
  transition:
    border-color var(--dur-base) var(--ease-out),
    transform var(--dur-base) var(--ease-out);
}
.promo:hover {
  border-color: rgb(200 169 106 / 0.5);
  transform: translateY(-3px);
}
.off {
  display: grid;
  align-content: center;
  justify-items: center;
  min-width: 110px;
  padding-right: var(--s-5);
  border-right: 1px dashed var(--border-strong);
}
.off strong {
  font-family: var(--font-display);
  font-size: 2.25rem;
  font-weight: 500;
  color: var(--accent);
  line-height: 1;
}
.off span {
  text-transform: uppercase;
  letter-spacing: var(--tracking-caps);
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
.body {
  display: grid;
  gap: var(--s-2);
}
h3 {
  font-family: var(--font-body);
  font-weight: 600;
  font-size: var(--fs-lg);
  letter-spacing: 0;
}
.body p {
  color: var(--text-muted);
  font-size: var(--fs-sm);
}
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-3);
  margin: var(--s-2) 0 0;
  padding: 0;
  list-style: none;
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
.meta li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.ends {
  position: absolute;
  top: var(--s-4);
  right: var(--s-4);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-xs);
  color: var(--accent);
}
.ends i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  animation: blink 1.6s infinite;
}
@keyframes blink {
  50% {
    opacity: 0.2;
  }
}
@media (max-width: 520px) {
  .promo {
    grid-template-columns: 1fr;
  }
  .off {
    border-right: 0;
    border-bottom: 1px dashed var(--border-strong);
    padding: 0 0 var(--s-4);
    justify-items: start;
  }
  .ends {
    position: static;
  }
}
</style>
