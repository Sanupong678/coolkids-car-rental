<script setup>
import { computed } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import Icon from '@/components/ui/Icon.vue'
import { endsIn, label, money, srcset } from '@/utils/format'
import { t, catName } from '@/i18n'

// Listing card modelled on the dark "Choose your vehicle" reference:
// title + badges, spotlit photo, big daily price with promo, total for the
// selected period, and spec chips.
const props = defineProps({
  vehicle: { type: Object, required: true },
  days: { type: Number, default: null }, // selected rental length → shows estimated total
  query: { type: Object, default: () => ({}) }, // carried to detail page (dates/locations)
})

const v = computed(() => props.vehicle)
const to = computed(() => ({
  name: 'vehicle',
  params: { slug: v.value.slug },
  query: props.query,
}))

// Guests must sign in before picking a car: show the sign-in popup and come
// back to this car's page afterwards.
const auth = useAuthStore()
const router = useRouter()
function choose(e, navigate) {
  if (auth.isSignedIn) return navigate(e)
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
  e.preventDefault()
  auth.promptLogin({ returnTo: router.resolve(to.value).fullPath })
}
const daily = computed(() => v.value.price.discountedDailyMinor ?? v.value.price.dailyMinor)
const promoApplies = computed(
  () => v.value.price.discountedDailyMinor != null && (!props.days || !v.value.promotion?.minRentalDays || props.days >= v.value.promotion.minRentalDays),
)
const shownDaily = computed(() => (promoApplies.value ? daily.value : v.value.price.dailyMinor))
const total = computed(() => (props.days ? shownDaily.value * props.days : null))
const powerOrRange = computed(() =>
  v.value.specs.fuel === 'ELECTRIC' && v.value.specs.rangeKm ? `${v.value.specs.rangeKm} km` : v.value.specs.powerHp ? `${v.value.specs.powerHp} hp` : null,
)
</script>

<template>
  <RouterLink v-slot="{ href, navigate }" :to="to" custom>
    <a :href="href" class="card" @click="choose($event, navigate)">
      <header class="top">
        <div>
          <h3>{{ v.brand }} {{ v.model }}</h3>
          <p class="trim">{{ v.trim }} · {{ v.year }}</p>
        </div>
        <span class="fav" aria-hidden="true"><Icon name="arrow-right" :size="16" /></span>
      </header>

      <div class="badges">
        <span class="chip">{{ catName(v.category) }}</span>
        <span v-if="v.promotion && v.price.discountedDailyMinor" class="chip chip-accent"> <Icon name="sparkles" :size="12" /> {{ v.promotion.name }} </span>
        <span v-else-if="v.isFeatured" class="chip">{{ t('vc.featured') }}</span>
      </div>

      <div class="stage">
        <img
          v-if="v.image"
          :src="v.image.variants?.w960 ?? v.image.url"
          :srcset="srcset(v.image.variants)"
          sizes="(min-width: 1200px) 380px, (min-width: 700px) 45vw, 92vw"
          :alt="v.image.alt ?? `${v.brand} ${v.model}`"
          loading="lazy"
          decoding="async"
        />
        <div v-else class="noimg">
          <Icon name="car" :size="56" :stroke="1" />
        </div>
        <span v-if="promoApplies && v.price.discountPercent" class="ribbon">−{{ v.price.discountPercent }}%</span>
      </div>

      <div class="price">
        <div class="daily">
          <span v-if="promoApplies" class="was">{{ money(v.price.dailyMinor, v.price.currency) }}</span>
          <strong>{{ money(shownDaily, v.price.currency) }}</strong
          ><small>{{ t('vc.perDay') }}</small>
        </div>
        <div class="meta">
          <template v-if="total">
            <span class="total">{{ money(total, v.price.currency) }}</span>
            <small>{{ t('vc.estTotal', { n: days }) }}</small>
          </template>
          <small v-else-if="v.promotion && v.price.discountedDailyMinor" class="ends">
            {{ endsIn(v.promotion.endsAt) }}<template v-if="v.promotion.minRentalDays"> · {{ t('vc.minDays', { n: v.promotion.minRentalDays }) }}</template>
          </small>
          <small v-else>{{ t('vc.deposit', { deposit: money(v.price.depositMinor, v.price.currency) }) }}</small>
        </div>
      </div>

      <ul class="specs" :aria-label="t('vc.specs')">
        <li><Icon name="users" :size="14" /> {{ v.specs.seats }}</li>
        <li v-if="v.specs.doors"><Icon name="door" :size="14" /> {{ v.specs.doors }}</li>
        <li><Icon name="gear" :size="14" /> {{ label(v.specs.transmission) }}</li>
        <li>
          <Icon :name="v.specs.fuel === 'ELECTRIC' ? 'bolt' : 'fuel'" :size="14" />
          {{ label(v.specs.fuel) }}
        </li>
        <li v-if="powerOrRange"><Icon name="gauge" :size="14" /> {{ powerOrRange }}</li>
      </ul>
    </a>
  </RouterLink>
</template>

<style scoped>
.card {
  position: relative;
  display: grid;
  gap: var(--s-3);
  padding: var(--s-5);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  /* frosted glass: the page's photo shows through */
  background: radial-gradient(120% 70% at 50% 58%, rgb(255 255 255 / 0.07), transparent 60%), linear-gradient(150deg, var(--surface-raised), var(--surface));
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.1);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
  backdrop-filter: blur(18px) saturate(140%);
  overflow: hidden;
  isolation: isolate;
  transition:
    border-color var(--dur-base) var(--ease-out),
    transform var(--dur-base) var(--ease-out),
    box-shadow var(--dur-base) var(--ease-out);
}
.card::after {
  /* accent hairline that draws in on hover */
  content: '';
  position: absolute;
  inset: auto 0 0 0;
  height: 2px;
  background: var(--accent);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform var(--dur-slow) var(--ease-out);
}
.card:hover {
  border-color: var(--border-strong);
  transform: translateY(-4px);
  box-shadow: var(--shadow-lg);
}
.card:hover::after {
  transform: scaleX(1);
}
.top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--s-3);
}
h3 {
  font-family: var(--font-body);
  font-size: var(--fs-lg);
  font-weight: 600;
  letter-spacing: 0;
}
.trim {
  color: var(--text-muted);
  font-size: var(--fs-sm);
}
.fav {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--border-strong);
  color: var(--text-muted);
  transition:
    background var(--dur-base) var(--ease-out),
    color var(--dur-base) var(--ease-out),
    transform var(--dur-base) var(--ease-out);
}
.card:hover .fav {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--text-inverse);
  transform: rotate(-45deg);
}
.badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-2);
}
.stage {
  position: relative;
  aspect-ratio: 16 / 10;
  margin-inline: calc(var(--s-5) * -1);
  overflow: hidden;
}
.stage {
  display: grid;
  place-items: end center;
  padding: 0 var(--s-5) 7%;
  background: radial-gradient(55% 14% at 50% 90%, rgb(0 0 0 / 0.4), transparent 70%);
}
.stage img {
  width: 100%;
  max-height: 100%;
  object-fit: contain;
  filter: drop-shadow(0 12px 10px rgb(0 0 0 / 0.45));
  transition: transform var(--dur-cinematic) var(--ease-out);
}
.card:hover .stage img {
  transform: translateX(4%) scale(1.04);
}
.noimg {
  height: 100%;
  display: grid;
  place-items: center;
  color: var(--c-ink-700);
}
.ribbon {
  position: absolute;
  top: var(--s-3);
  right: var(--s-5);
  z-index: 1;
  padding: 4px 10px;
  border-radius: var(--r-sm);
  background: var(--accent);
  color: var(--text-inverse);
  font-weight: 700;
  font-size: var(--fs-xs);
}
.price {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: var(--s-3);
}
.daily {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
}
.daily strong {
  font-family: var(--font-display);
  font-weight: 500;
  font-size: 1.75rem;
  line-height: 1;
}
.daily small,
.meta small {
  color: var(--text-muted);
  font-size: var(--fs-xs);
}
.was {
  width: 100%;
  color: var(--text-muted);
  text-decoration: line-through;
  font-size: var(--fs-sm);
}
.meta {
  display: grid;
  justify-items: end;
  text-align: right;
}
.total {
  font-weight: 600;
}
.ends {
  color: var(--accent) !important;
}
.specs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-2);
  margin: 0;
  padding: var(--s-3) 0 0;
  list-style: none;
  border-top: 1px solid var(--border);
}
.specs li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: var(--r-sm);
  background: rgb(255 255 255 / 0.04);
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
</style>
