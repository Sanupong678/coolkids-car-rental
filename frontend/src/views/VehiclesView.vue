<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getFacets, listVehicles } from '@/api/catalogue'
import { useSiteStore } from '@/stores/site'
import { rentalDays } from '@/utils/format'
import { t, catName } from '@/i18n'
import Icon from '@/components/ui/Icon.vue'
import RentalSearch from '@/components/booking/RentalSearch.vue'
import FilterSidebar from '@/components/vehicles/FilterSidebar.vue'
import VehicleCard from '@/components/vehicles/VehicleCard.vue'

// Fleet listing. All state lives in the URL so results are shareable and the
// back button works; the API is the source of truth for availability & price.
const route = useRoute()
const router = useRouter()

// Dark showroom page: the Civic showroom photo sits fixed behind frosted-glass
// cards, and (like the homepage) the footer fades in from it.
onMounted(() => document.body.classList.add('ambient-page'))
onBeforeUnmount(() => document.body.classList.remove('ambient-page'))
const site = useSiteStore()

const ARRAY_KEYS = ['price', 'category', 'brand', 'transmission', 'fuel', 'drive']
const NUM_KEYS = ['seats', 'priceMin', 'priceMax', 'page']
const SORTS = [
  'recommended',
  'price_asc',
  'price_desc',
  'newest',
  'power_desc',
]

function fromQuery(q) {
  const f = { sort: q.sort || 'recommended', page: Number(q.page) || 1 }
  for (const k of ARRAY_KEYS) if (q[k]) f[k] = String(q[k]).split(',').filter(Boolean)
  for (const k of NUM_KEYS) if (q[k] != null && q[k] !== '') f[k] = Number(q[k])
  return f
}
function toQuery(f, rental) {
  const q = {}
  for (const [k, v] of Object.entries({ ...f, ...rental })) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue
    if (k === 'sort' && v === 'recommended') continue
    if (k === 'page' && v === 1) continue
    q[k] = Array.isArray(v) ? v.join(',') : String(v)
  }
  return q
}

const filters = computed(() => fromQuery(route.query))
const rental = computed(() => ({
  pickup: route.query.pickup ?? '',
  dropoff: route.query.dropoff ?? '',
  from: route.query.from ?? '',
  to: route.query.to ?? '',
}))
const days = computed(() => rentalDays(rental.value.from, rental.value.to))

const vehicles = ref([])
const page = ref({ total: 0, pages: 0 })
const facets = ref(null)
const loading = ref(true)
const error = ref('')
const drawer = ref(false)
let controller

async function load() {
  controller?.abort()
  controller = new AbortController()
  loading.value = true
  error.value = ''
  const { from, to } = rental.value
  const valid = from && to && new Date(to) > new Date(from)
  try {
    const res = await listVehicles(
      { ...filters.value, pageSize: 12, ...(valid ? { from: new Date(from).toISOString(), to: new Date(to).toISOString() } : {}) },
      { signal: controller.signal },
    )
    vehicles.value = res.data
    page.value = res.page
  } catch (err) {
    if (err.name === 'AbortError') return
    error.value = err.message
  } finally {
    loading.value = false
  }
}

function setFilters(f) {
  router.replace({ query: toQuery(f, rental.value) })
}
function setRental(r) {
  router.replace({ query: toQuery({ ...filters.value, page: 1 }, r) })
}
function goPage(n) {
  router.push({ query: toQuery({ ...filters.value, page: n }, rental.value) })
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

watch(() => route.query, load, { deep: true })
onMounted(async () => {
  load()
  site.load()
  facets.value = await getFacets().catch(() => null)
})

const heading = computed(() => {
  const cats = filters.value.category
  const cat = cats?.length === 1 && facets.value?.categories?.find((c) => c.slug === cats[0])
  return cat ? catName(cat) : t('list.heading')
})
const cardQuery = computed(() => toQuery({}, rental.value))
</script>

<template>
  <main class="fleet">
    <div class="backdrop" aria-hidden="true" />
    <div class="bar">
      <RentalSearch :model-value="rental" variant="steps" @search="setRental" />
    </div>

    <div class="layout">
      <div class="side" :class="{ open: drawer }">
        <FilterSidebar :model-value="filters" :facets="facets" @update:model-value="setFilters" @close="drawer = false" />
      </div>
      <div v-if="drawer" class="scrim" @click="drawer = false" />

      <section class="results" aria-live="polite">
        <header class="head">
          <div>
            <h1>{{ heading }} <small>{{ t('list.count', { n: page.total }) }}</small></h1>
            <p v-if="days" class="sub"><Icon name="calendar" :size="14" /> {{ t('list.forDays', { n: days }) }}</p>
          </div>
          <div class="tools">
            <button type="button" class="btn btn-ghost btn-sm filters-btn" @click="drawer = true">
              <Icon name="sliders" :size="14" /> {{ t('list.filters') }}
            </button>
            <label class="sort">
              <span>{{ t('list.sortBy') }}</span>
              <select :value="filters.sort" @change="setFilters({ ...filters, sort: $event.target.value, page: 1 })">
                <option v-for="v in SORTS" :key="v" :value="v">{{ t(`list.sort.${v}`) }}</option>
              </select>
            </label>
          </div>
        </header>

        <div v-if="loading && !vehicles.length" class="grid">
          <div v-for="n in 6" :key="n" class="skeleton sk" />
        </div>
        <div v-else-if="error" class="empty">
          <Icon name="x" :size="28" />
          <p>{{ error }}</p>
          <button class="btn btn-ghost btn-sm" type="button" @click="load">{{ t('list.retry') }}</button>
        </div>
        <div v-else-if="!vehicles.length" class="empty">
          <Icon name="search" :size="28" />
          <h2>{{ t('list.empty') }}</h2>
          <p>{{ t('list.emptyHint') }}</p>
          <button class="btn btn-ghost btn-sm" type="button" @click="setFilters({ sort: filters.sort })">{{ t('list.clear') }}</button>
        </div>
        <TransitionGroup v-else name="list" tag="div" class="grid" :class="{ dim: loading }">
          <VehicleCard v-for="v in vehicles" :key="v.id" :vehicle="v" :days="days" :query="cardQuery" />
        </TransitionGroup>

        <nav v-if="page.pages > 1" class="pager" :aria-label="t('list.pages')">
          <button
            v-for="n in page.pages"
            :key="n"
            type="button"
            :class="{ on: n === filters.page }"
            :aria-current="n === filters.page ? 'page' : undefined"
            @click="goPage(n)"
          >
            {{ n }}
          </button>
        </nav>
      </section>
    </div>
  </main>
</template>

<style scoped>
.fleet {
  --bg: transparent;
  --text: #f1f2f4;
  --text-muted: rgb(255 255 255 / 0.62);
  --surface: rgb(255 255 255 / 0.06);
  --surface-raised: rgb(255 255 255 / 0.1);
  --border: rgb(255 255 255 / 0.1);
  --border-strong: rgb(255 255 255 / 0.2);
  --accent-soft: rgb(226 54 44 / 0.25);
  --glass-bg: linear-gradient(140deg, rgb(20 21 24 / 0.62), rgb(20 21 24 / 0.42));
  --glass-border: rgb(255 255 255 / 0.1);
  --glass-shadow: 0 18px 44px -22px rgb(0 0 0 / 0.6), inset 0 1px 0 rgb(255 255 255 / 0.08);
  --focus-ring: 0 0 0 2px #111, 0 0 0 4px var(--accent);
  /* no stacking context here: the fixed backdrop must sit behind the footer too */
  padding-top: 64px;
  min-height: 100dvh;
  color: var(--text);
}
/* fixed showroom photo behind everything, dimmed and fading to the edges */
.backdrop {
  position: fixed;
  inset: 0;
  z-index: -1;
  background:
    radial-gradient(90% 70% at 50% 35%, transparent 30%, rgb(12 12 14 / 0.85) 100%),
    linear-gradient(180deg, rgb(12 12 14 / 0.55), rgb(12 12 14 / 0.35) 40%, rgb(12 12 14 / 0.8)),
    url(/media/showroom-civic.webp) 50% 30% / cover no-repeat,
    #0e0f11;
  pointer-events: none;
}
.fleet :deep(input),
.fleet :deep(select) {
  color-scheme: dark;
}
.fleet :deep(option) {
  background: #1c1c20;
  color: #fff;
}
.fleet :deep(.rail) {
  -webkit-backdrop-filter: blur(18px) saturate(130%);
  backdrop-filter: blur(18px) saturate(130%);
}
.fleet :deep(.btn-dark) {
  background: #fff;
  color: #111;
}
.bar {
  position: sticky;
  top: 64px;
  z-index: 10;
}
.layout {
  display: grid;
  grid-template-columns: 290px 1fr;
  min-height: calc(100dvh - 148px);
}
.side {
  position: relative;
}
.side > :deep(.rail) {
  position: sticky;
  top: 140px;
  max-height: calc(100dvh - 140px);
  overflow-y: auto;
  scrollbar-width: thin;
}
.results {
  padding: var(--s-6) clamp(1rem, 3vw, 2.5rem) var(--s-8);
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: var(--s-4);
  margin-bottom: var(--s-5);
}
h1 {
  font-family: var(--font-body);
  font-weight: 600;
  font-size: var(--fs-2xl);
  letter-spacing: -0.01em;
}
h1 small {
  margin-left: var(--s-2);
  font-size: var(--fs-xs);
  font-weight: 500;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--text-muted);
  vertical-align: middle;
}
.sub {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  color: var(--accent);
  font-size: var(--fs-sm);
}
.tools {
  display: flex;
  align-items: center;
  gap: var(--s-3);
}
.sort {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  font-size: var(--fs-xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.sort select {
  height: 36px;
  padding: 0 var(--s-3);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-sm);
  background: var(--surface);
  color: var(--text);
  font-size: var(--fs-sm);
  text-transform: none;
  letter-spacing: 0;
  color-scheme: dark;
}
.filters-btn {
  display: none;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
  gap: var(--s-5);
  transition: opacity var(--dur-base) var(--ease-out);
}
.grid.dim {
  opacity: 0.5;
}
.sk {
  height: 440px;
}
.empty {
  display: grid;
  justify-items: center;
  gap: var(--s-3);
  padding: var(--s-9) var(--s-5);
  border: 1px dashed var(--border-strong);
  border-radius: var(--r-md);
  text-align: center;
  color: var(--text-muted);
}
.empty h2 {
  font-family: var(--font-body);
  font-size: var(--fs-xl);
  color: var(--text);
}
.pager {
  display: flex;
  justify-content: center;
  gap: var(--s-2);
  margin-top: var(--s-7);
}
.pager button {
  width: 40px;
  height: 40px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-sm);
  background: none;
  cursor: pointer;
}
.pager button.on {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--text-inverse);
}
.list-enter-active {
  transition:
    opacity var(--dur-slow) var(--ease-out),
    transform var(--dur-slow) var(--ease-out);
}
.list-enter-from {
  opacity: 0;
  transform: translateY(16px);
}
.list-leave-active {
  display: none;
}
.scrim {
  display: none;
}
@media (max-width: 1100px) {
  .bar {
    position: static;
  }
  .side > :deep(.rail) {
    top: 64px;
    max-height: calc(100dvh - 64px);
  }
}
@media (max-width: 960px) {
  .layout {
    grid-template-columns: 1fr;
  }
  .filters-btn {
    display: inline-flex;
  }
  .side {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: var(--z-modal);
    width: min(340px, 88vw);
    transform: translateX(-100%);
    transition: transform var(--dur-slow) var(--ease-out);
  }
  .side.open {
    transform: none;
  }
  .side > :deep(.rail) {
    position: static;
    height: 100dvh;
    max-height: none;
  }
  .scrim {
    display: block;
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-modal) - 1);
    background: rgb(0 0 0 / 0.6);
  }
}
</style>
