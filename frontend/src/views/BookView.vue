<script setup>
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { getVehicle, listVehicles } from '@/api/catalogue'
import { useAuthStore } from '@/stores/auth'
import { money, rentalDays } from '@/utils/format'
import { t, intlLocale, errorText } from '@/i18n'
import Icon from '@/components/ui/Icon.vue'
import AvailabilityCalendar from '@/components/booking/AvailabilityCalendar.vue'
import BookingModal from '@/components/booking/BookingModal.vue'

// Phone-first booking page opened from LINE (rich menu "เลือกรถ" and the car
// cards the chat bot sends): 1 pick a car → 2 pick dates on its live calendar
// → "ดำเนินการต่อ" opens the details / documents form. /book lists the fleet,
// /book/:slug starts at the calendar.
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const cars = ref(null)
const car = ref(null)
const selection = ref(null)
const booking = ref(false)
const error = ref('')

const slug = computed(() => route.params.slug || null)
const days = computed(() => (selection.value ? Math.max(1, rentalDays(selection.value.from, selection.value.to)) : 0))
const daily = (v) => v.price.discountedDailyMinor ?? v.price.dailyMinor
const fmtDay = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(intlLocale(), { weekday: 'short', day: 'numeric', month: 'short' })

async function load() {
  error.value = ''
  selection.value = null
  try {
    if (slug.value) {
      car.value = null
      car.value = await getVehicle(slug.value)
    } else if (!cars.value) {
      cars.value = (await listVehicles({ pageSize: 48 })).data
    }
  } catch (err) {
    error.value = err.status === 404 ? t('bv.notFound') : errorText(err)
  }
}
watch(slug, load, { immediate: true })

function proceed() {
  if (!selection.value) return
  if (!auth.isSignedIn) {
    auth.promptLogin({ returnTo: route.fullPath })
    return
  }
  booking.value = true
}
function closeBooking(b) {
  booking.value = false
  if (b) router.push({ name: 'booking', params: { number: b.number } })
}
</script>

<template>
  <main class="book">
    <div class="wrap">
      <ol class="steps" :aria-label="t('bv.steps')">
        <li :class="{ on: !slug, done: slug }"><span>{{ slug ? '✓' : 1 }}</span>{{ t('bv.pickCar') }}</li>
        <li :class="{ on: slug && !selection, done: selection }"><span>{{ selection ? '✓' : 2 }}</span>{{ t('bv.pickDay') }}</li>
        <li :class="{ on: selection }"><span>3</span>{{ t('bv.fill') }}</li>
      </ol>

      <p v-if="error" class="err" role="alert">{{ error }} · <RouterLink :to="{ name: 'book' }">{{ t('bv.allCars') }}</RouterLink></p>

      <!-- 1. cars -->
      <template v-else-if="!slug">
        <h1>{{ t('bv.titleCar') }}</h1>
        <div v-if="!cars" class="skeleton" style="height: 320px" />
        <ul v-else class="cars">
          <li v-for="v in cars" :key="v.slug">
            <RouterLink :to="{ name: 'book-car', params: { slug: v.slug } }" class="car">
              <img v-if="v.image" :src="v.image.variants?.w640 ?? v.image.url" :alt="`${v.brand} ${v.model}`" loading="lazy" />
              <span v-else class="noimg"><Icon name="car" :size="40" /></span>
              <span class="info">
                <strong>{{ v.brand }} {{ v.model }}</strong>
                <small>{{ [v.trim, v.year].filter(Boolean).join(' · ') }}</small>
                <small class="spec"><Icon name="users" :size="12" /> {{ v.specs.seats }} · <Icon name="gear" :size="12" /> {{ t(v.specs.transmission === 'AUTOMATIC' ? 'bv.auto' : 'bv.manual') }}</small>
              </span>
              <span class="price">
                <b>{{ money(daily(v), v.price.currency) }}</b><small>{{ t('bv.perDay') }}</small>
                <s v-if="v.price.discountedDailyMinor">{{ money(v.price.dailyMinor, v.price.currency) }}</s>
              </span>
            </RouterLink>
          </li>
        </ul>
      </template>

      <!-- 2. dates -->
      <template v-else>
        <div v-if="!car" class="skeleton" style="height: 420px" />
        <template v-else>
          <section class="chosen">
            <img v-if="car.image" :src="car.image.variants?.w640 ?? car.image.url" :alt="`${car.brand} ${car.model}`" />
            <div>
              <strong>{{ car.brand }} {{ car.model }}</strong>
              <small>{{ t('bv.perDayDeposit', { price: money(daily(car), car.price.currency), deposit: money(car.price.depositMinor, car.price.currency) }) }}</small>
              <RouterLink :to="{ name: 'book' }" class="change">{{ t('bv.changeCar') }}</RouterLink>
            </div>
          </section>
          <h1>{{ t('bv.titleDates') }}</h1>
          <p class="lead">{{ t('bv.lead') }}</p>
          <AvailabilityCalendar :key="car.slug" :slug="car.slug" @select="selection = $event" />
        </template>
      </template>
    </div>

    <footer v-if="slug && car" class="bar">
      <div class="sum">
        <template v-if="selection">
          <strong>{{ fmtDay(selection.from) }} → {{ fmtDay(selection.to) }}</strong>
          <small>{{ t('bv.estimate', { n: days, price: money(daily(car) * days, car.price.currency) }) }}</small>
        </template>
        <small v-else>{{ t('bv.noDates') }}</small>
      </div>
      <button type="button" class="btn btn-primary btn-pill" :disabled="!selection" @click="proceed">{{ t('bv.continue') }}</button>
    </footer>

    <BookingModal v-if="booking && car" :vehicle="car" :dates="selection" @close="closeBooking" />
  </main>
</template>

<style scoped>
.book {
  min-height: 100dvh;
  padding: 84px var(--gutter) 140px;
  background: var(--bg);
}
.wrap {
  display: grid;
  gap: var(--s-4);
  max-width: 760px;
  margin-inline: auto;
}
h1 {
  font-family: var(--font-body);
  font-size: var(--fs-xl);
  font-weight: 700;
  letter-spacing: -0.01em;
}
.lead {
  margin-top: calc(var(--s-3) * -1);
  color: var(--text-muted);
  font-size: var(--fs-sm);
}
.steps {
  display: flex;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--text-muted);
  font-size: var(--fs-sm);
}
.steps li {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
}
.steps li:not(:last-child)::after {
  content: '';
  flex: 1;
  height: 2px;
  border-radius: 2px;
  background: var(--border, #e3e3e0);
}
.steps span {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--surface);
  font-size: 0.72rem;
  font-weight: 700;
}
.steps .on {
  color: var(--text);
  font-weight: 600;
}
.steps .on span,
.steps .done span {
  background: #e2362c;
  color: #fff;
}
.cars {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.car {
  display: grid;
  grid-template-columns: 120px 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 10px 14px 10px 10px;
  border-radius: var(--r-lg);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  color: inherit;
  text-decoration: none;
}
.car:focus-visible {
  outline: 3px solid #f5a19b;
}
.car img,
.noimg {
  width: 120px;
  height: 78px;
  object-fit: contain;
  border-radius: 10px;
  background: #fff;
}
.noimg {
  display: grid;
  place-items: center;
  color: var(--text-muted);
}
.info {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.info small {
  color: var(--text-muted);
}
.spec {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.price {
  display: grid;
  justify-items: end;
}
.price b {
  color: #e2362c;
  font-size: var(--fs-lg);
}
.price small,
.price s {
  color: var(--text-muted);
  font-size: var(--fs-xs);
}
.chosen {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border-radius: var(--r-lg);
  background: var(--surface);
}
.chosen img {
  width: 110px;
  height: 72px;
  object-fit: contain;
  border-radius: 10px;
  background: #fff;
}
.chosen div {
  display: grid;
  gap: 2px;
}
.chosen small {
  color: var(--text-muted);
}
.change {
  color: #e2362c;
  font-size: var(--fs-sm);
  font-weight: 600;
}
.bar {
  position: fixed;
  inset: auto 0 0;
  z-index: 50;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px var(--gutter) calc(12px + env(safe-area-inset-bottom));
  background: var(--surface);
  box-shadow: 0 -8px 24px -12px rgb(0 0 0 / 0.25);
}
.bar .sum {
  display: grid;
  min-width: 0;
}
.bar small {
  color: var(--text-muted);
}
.bar .btn {
  flex: none;
  min-height: 48px;
}
.err {
  color: #c0392b;
}
@media (max-width: 420px) {
  .car {
    grid-template-columns: 96px 1fr;
  }
  .car img,
  .noimg {
    width: 96px;
    height: 64px;
  }
  .price {
    grid-column: 2;
    justify-items: start;
    grid-auto-flow: column;
    align-items: baseline;
    gap: 4px;
  }
}
</style>
