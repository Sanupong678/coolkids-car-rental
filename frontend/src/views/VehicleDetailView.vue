<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { getVehicle, listVehicles } from '@/api/catalogue'
import { useSiteStore } from '@/stores/site'
import { useAuthStore } from '@/stores/auth'
import { label, money, srcset } from '@/utils/format'
import { useI18n } from '@/i18n'
import Icon from '@/components/ui/Icon.vue'
import AvailabilityCalendar from '@/components/booking/AvailabilityCalendar.vue'
import BookingModal from '@/components/booking/BookingModal.vue'

// Vehicle detail (Mercedes-Benz "Constructor" reference): a frosted glass card
// floating in a studio. Left: title, an icon rail and the selected panel
// (rental plan / specs / equipment / service). Right: the background-free car
// on a floor ring. Bottom: other cars as thumbnails, price and the book button.
// Phones get their own one-page layout instead (title, car, a strip of key specs,
// what's included, price + book bar pinned to the bottom); "book" there opens a
// sheet with the calendar first, then the booking wizard.
const route = useRoute()
const router = useRouter()
const site = useSiteStore()
const auth = useAuthStore()
const { t, catName, featName, carDesc, intlLocale } = useI18n()
const v = ref(null)
const others = ref([])
const notFound = ref(false)
const selection = ref(null)
const tab = ref('plan')
const plan = ref('day')
const credits = ref({})

onMounted(async () => {
  credits.value = await fetch('/cars/credits.json').then((r) => r.json()).catch(() => ({}))
})

async function load(slug) {
  v.value = null
  notFound.value = false
  selection.value = null
  try {
    v.value = await getVehicle(slug)
    document.title = `${v.value.brand} ${v.value.model} ${v.value.trim} — Coolkids Car Rental`
    const res = await listVehicles({ pageSize: 12 })
    others.value = res.data.filter((x) => x.id !== v.value.id)
  } catch (err) {
    if (err.status === 404) notFound.value = true
    else throw err
  }
}
watch(() => route.params.slug, (s) => s && load(s), { immediate: true })

const hero = computed(() => v.value?.images?.[0])

// Car photos differ: some are square cut-outs with lots of empty space, some fill the frame.
// On load, find where the car actually is (non-transparent pixels) and crop to it, so every
// car fills the stage the same way and none runs past the card. Photos without transparency
// (or not readable) are shown whole.
const fit = ref(null)
watch(hero, () => (fit.value = null))
function measureCar(e) {
  const img = e.target
  try {
    const W = 160
    const H = Math.max(1, Math.round((W * img.naturalHeight) / img.naturalWidth))
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    const ctx = c.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0, W, H)
    const d = ctx.getImageData(0, 0, W, H).data
    let x0 = W, y0 = H, x1 = -1, y1 = -1
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (d[(y * W + x) * 4 + 3] > 24) {
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
      }
    }
    if (x1 < 0) return
    // a little room for the shadow
    const pad = 0.02
    const l = Math.max(0, x0 / W - pad), r = Math.min(1, (x1 + 1) / W + pad)
    const t = Math.max(0, y0 / H - pad), b = Math.min(1, (y1 + 1) / H + pad)
    if (r - l > 0.97 && b - t > 0.97) return // fills the photo already: nothing to crop
    fit.value = { l, t, w: r - l, h: b - t, ratio: ((r - l) * img.naturalWidth) / ((b - t) * img.naturalHeight) }
  } catch {
    /* cross-origin or decode issue: keep the whole photo */
  }
}
const frameStyle = computed(() => (fit.value ? { aspectRatio: String(fit.value.ratio), '--r': fit.value.ratio } : null))
const cropStyle = computed(() =>
  fit.value
    ? {
        position: 'absolute',
        width: `${100 / fit.value.w}%`,
        height: `${100 / fit.value.h}%`,
        left: `${(-fit.value.l / fit.value.w) * 100}%`,
        top: `${(-fit.value.t / fit.value.h) * 100}%`,
        maxWidth: 'none',
        maxHeight: 'none',
      }
    : null,
)
const daily = computed(() => v.value?.price.discountedDailyMinor ?? v.value?.price.dailyMinor)
const line = computed(() => site.content?.contact?.line)
const thumbs = computed(() => others.value.slice(0, 3))
// credits.json is keyed by the image file name: /cars/<key>-1200.webp
const credit = computed(() => {
  const key = hero.value?.url?.match(/\/cars\/(.+)-\d+\.webp$/)?.[1]
  return key ? credits.value[key] : null
})

const tabs = computed(() => [
  { key: 'plan', icon: 'car', label: t('car.tabPlan') },
  { key: 'specs', icon: 'gauge', label: t('car.tabSpecs') },
  { key: 'features', icon: 'armchair', label: t('car.tabFeatures') },
  { key: 'service', icon: 'shield', label: t('car.tabService') },
])

const specs = computed(() => {
  if (!v.value) return []
  const s = v.value.specs
  return [
    [t('car.s.engine'), s.engineCc ? t('car.s.litre', { n: (s.engineCc / 1000).toFixed(1) }) : '—'],
    [t('car.s.power'), s.powerHp ? t('car.s.hp', { n: s.powerHp }) : '—'],
    [t('car.s.torque'), s.torqueNm ? `${s.torqueNm} Nm` : '—'],
    [t('car.s.economy'), s.fuelEconomy ? t('car.s.l100', { n: s.fuelEconomy }) : '—'],
    [t('car.s.gearbox'), label(s.transmission)],
    [t('car.s.fuel'), label(s.fuel)],
    [t('car.s.seatsDoors'), `${s.seats} / ${s.doors ?? '—'}`],
    [t('car.s.luggage'), s.luggageLiters ? t('car.s.litre', { n: s.luggageLiters }) : '—'],
    [t('car.s.size'), s.lengthMm ? t('car.s.mm', { n: `${s.lengthMm}×${s.widthMm}×${s.heightMm}` }) : '—'],
    [t('car.s.drive'), s.drive],
  ]
})

const service = computed(() => {
  if (!v.value) return []
  return [
    { icon: 'shield', t: t('car.sv.insurance'), d: t('car.sv.insuranceD') },
    { icon: 'road', t: t('car.sv.unlimited'), d: t('car.sv.unlimitedD') },
    { icon: 'pin', t: t('car.sv.delivery'), d: v.value.delivery ? t('car.sv.freeKm', { km: v.value.delivery.freeKm, price: v.value.delivery.perKmMinor / 100 }) : t('car.sv.byDistance') },
    { icon: 'calendar', t: t('car.sv.minDays', { n: v.value.rental.minDays }), d: t('car.sv.age', { n: v.value.rental.minDriverAge }) },
    { icon: 'receipt', t: t('car.sv.deposit'), d: money(v.value.price.depositMinor, v.value.price.currency) },
    { icon: 'clock', t: t('car.sv.hours'), d: t('car.sv.hoursD') },
  ]
})

const selDays = computed(() =>
  selection.value ? Math.max(1, Math.round((new Date(selection.value.to) - new Date(selection.value.from)) / 86_400_000)) : null,
)
const imgSrc = (img, w = 'w1200') => img?.variants?.[w] ?? img?.url

// "จองเลย" (book on the website). Guests sign in first and come back here with
// ?book=1, which re-opens the wizard; the dates picked on the calendar carry over.
const booking = ref(false)
const sheet = ref(false)
const quick = computed(() => {
  if (!v.value) return []
  const s = v.value.specs
  return [
    ['users', t('car.seats'), s.seats],
    ['gear', t('car.gear'), label(s.transmission)],
    [s.fuel === 'ELECTRIC' ? 'bolt' : 'fuel', t('car.s.fuel'), label(s.fuel)],
    s.fuelEconomy ? ['gauge', t('car.ecoUnit'), s.fuelEconomy] : ['gauge', t('car.s.power'), s.powerHp ? t('car.s.hp', { n: s.powerHp }) : '—'],
  ]
})

// photo slider (swipe; dots when the car has more than one photo)
const shot = ref(0)
function onGallery(e) {
  const el = e.target
  shot.value = Math.round(el.scrollLeft / el.clientWidth)
}

// favourites live on this device only
const FAV_KEY = 'ck:favourites'
const readFavs = () => {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY)) ?? []
  } catch {
    return []
  }
}
const favs = ref(readFavs())
const isFav = computed(() => !!v.value && favs.value.includes(v.value.slug))
function toggleFav() {
  const slug = v.value.slug
  favs.value = isFav.value ? favs.value.filter((x) => x !== slug) : [...favs.value, slug]
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(favs.value))
  } catch {
    // private mode: keeps working for this visit
  }
}

const copied = ref(false)
async function share() {
  const url = location.href.split('?')[0]
  if (navigator.share) {
    await navigator.share({ title: `${v.value.brand} ${v.value.model}`, url }).catch(() => {})
    return
  }
  await navigator.clipboard?.writeText(url).catch(() => {})
  copied.value = true
  setTimeout(() => (copied.value = false), 1800)
}
const shortDate = (iso) => new Date(`${iso}T00:00`).toLocaleDateString(intlLocale(), { day: 'numeric', month: 'short' })
function continueBooking() {
  sheet.value = false
  openBooking()
}
function openBooking() {
  if (!auth.isSignedIn) {
    auth.promptLogin({ returnTo: router.resolve({ query: { ...route.query, book: '1' } }).fullPath })
    return
  }
  booking.value = true
}
function closeBooking(b) {
  booking.value = false
  if (route.query.book) router.replace({ query: { ...route.query, book: undefined } })
  if (b) router.push({ name: 'booking', params: { number: b.number } })
}
watch(
  () => [route.query.book, v.value, auth.isSignedIn],
  ([book, loaded, signedIn]) => {
    if (book && loaded && signedIn) booking.value = true
  },
  { immediate: true },
)
</script>

<template>
  <main v-if="v" class="detail">
    <!-- phones: one simple page -->
    <section class="phone">
      <div class="p-top">
        <div class="p-head">
          <RouterLink :to="{ name: 'vehicles', query: { category: v.category.slug } }" class="p-back" :aria-label="t('car.back')">
            <Icon name="arrow-left" :size="16" />
          </RouterLink>
          <span class="p-cat">{{ catName(v.category) }}</span>
        </div>
        <h1 class="p-title">{{ v.brand }} {{ v.model }}<span>{{ v.trim }} · {{ v.year }}</span></h1>

        <div class="p-rail">
          <button type="button" :class="{ on: isFav }" :aria-pressed="isFav" :aria-label="t(isFav ? 'car.unfav' : 'car.fav')" @click="toggleFav">
            <Icon name="heart" :size="18" />
          </button>
          <button type="button" :aria-label="t('car.availability')" @click="sheet = true"><Icon name="calendar" :size="18" /></button>
          <button type="button" :aria-label="t('car.share')" @click="share"><Icon :name="copied ? 'check' : 'share'" :size="18" /></button>
        </div>

        <div class="p-gallery" @scroll.passive="onGallery">
          <figure v-for="(img, i) in v.images" :key="img.url" class="p-car">
            <img
              :src="imgSrc(img)"
              :srcset="srcset(img.variants)"
              sizes="100vw"
              :alt="img.alt ?? `${v.brand} ${v.model}`"
              :fetchpriority="i === 0 ? 'high' : undefined"
              :loading="i === 0 ? undefined : 'lazy'"
            />
          </figure>
        </div>
        <div v-if="v.images.length > 1" class="p-shots" aria-hidden="true">
          <i v-for="(img, i) in v.images" :key="img.url" :class="{ on: i === shot }" />
        </div>
        <p v-if="copied" class="p-toast" role="status">{{ t('car.copied') }}</p>
      </div>

      <div class="p-sheet">
        <h2 class="sr-only">{{ t('car.quick') }}</h2>
        <dl class="p-specs p-card">
          <div v-for="[icon, k, val] in quick" :key="k">
            <span class="p-ico"><Icon :name="icon" :size="18" /></span>
            <dd>{{ val }}</dd>
            <dt>{{ k }}</dt>
          </div>
        </dl>

        <h3>{{ t('car.included') }}</h3>
        <ul class="p-inc">
          <li v-for="x in service.slice(0, 4)" :key="x.t">
            <Icon :name="x.icon" :size="16" />
            <div><strong>{{ x.t }}</strong><small>{{ x.d }}</small></div>
          </li>
        </ul>

        <p class="p-desc p-card">{{ carDesc(v) }}</p>

        <template v-if="others.length">
          <h3>{{ t('car.others') }}</h3>
          <div class="p-others">
            <RouterLink v-for="o in others" :key="o.id" :to="{ name: 'vehicle', params: { slug: o.slug } }">
              <img :src="o.image?.variants?.w640 ?? o.image?.url" alt="" loading="lazy" />
              <span>{{ o.brand }} {{ o.model }}</span>
            </RouterLink>
          </div>
        </template>
      </div>

      <div class="p-bar">
        <p>
          <strong>{{ money(daily, v.price.currency) }}</strong><span>{{ t('car.perDay') }}</span>
          <small>{{ t('car.sv.deposit') }} {{ money(v.price.depositMinor, v.price.currency) }}</small>
        </p>
        <a v-if="line" :href="line" target="_blank" rel="noopener" class="p-line" :aria-label="t('car.bookLine')">LINE</a>
        <button type="button" class="p-book" @click="sheet = true">{{ t('car.book') }}</button>
      </div>
    </section>

    <!-- phones: pick dates first, then the booking wizard -->
    <Transition name="sheet">
      <div v-if="sheet" class="p-overlay" @click.self="sheet = false">
        <div class="p-dates" role="dialog" aria-modal="true" :aria-label="t('car.pickDates')">
          <header>
            <h2>{{ t('car.pickDates') }}</h2>
            <button type="button" class="p-x" :aria-label="t('car.close')" @click="sheet = false"><Icon name="x" :size="18" /></button>
          </header>
          <AvailabilityCalendar :slug="v.slug" @select="selection = $event" />
          <p v-if="selection" class="p-sum">
            {{ shortDate(selection.from) }} → {{ shortDate(selection.to) }} · {{ t('car.nights', { n: selDays }) }}
            <b>≈ {{ money(daily * selDays, v.price.currency) }}</b>
          </p>
          <p v-else class="p-sum muted">{{ t('car.pickHint') }}</p>
          <button type="button" class="p-book wide" @click="continueBooking">{{ t('car.continue') }}</button>
        </div>
      </div>
    </Transition>

    <section class="studio">
      <div class="card">
        <!-- card header -->
        <header class="top">
          <RouterLink to="/" class="logo"><b>COOL</b>KIDS</RouterLink>
          <nav class="links" :aria-label="t('car.sections')">
            <button v-for="x in tabs.slice(1)" :key="x.key" type="button" :class="{ on: tab === x.key }" @click="tab = x.key">
              {{ x.label }}
            </button>
            <a href="#availability" class="pill">{{ t('car.availability') }}</a>
          </nav>
          <RouterLink :to="{ name: 'vehicles' }" class="square" :aria-label="t('car.allCars')"><Icon name="sliders" :size="16" /></RouterLink>
        </header>

        <div class="body">
          <!-- left -->
          <div class="left">
            <div class="title">
              <RouterLink :to="{ name: 'vehicles', query: { category: v.category.slug } }" class="back" :aria-label="t('car.back')">
                <Icon name="arrow-left" :size="16" />
              </RouterLink>
              <div>
                <h1>{{ v.brand }} {{ v.model }}</h1>
                <p>{{ v.trim }} · {{ v.year }} · {{ catName(v.category) }}</p>
              </div>
            </div>

            <div class="config">
              <div class="rail" role="tablist" :aria-label="t('car.infoTabs')">
                <button
                  v-for="x in tabs"
                  :key="x.key"
                  type="button"
                  role="tab"
                  :aria-selected="tab === x.key"
                  :aria-label="x.label"
                  :title="x.label"
                  :class="{ on: tab === x.key }"
                  @click="tab = x.key"
                >
                  <Icon :name="x.icon" :size="18" />
                </button>
              </div>

              <Transition name="panel" mode="out-in">
                <!-- rental plan -->
                <div v-if="tab === 'plan'" key="plan" class="panel">
                  <h2>{{ t('car.tabPlan') }}</h2>
                  <div class="pair">
                    <div class="field"><span>{{ t('car.seats') }}</span><strong>{{ v.specs.seats }}</strong></div>
                    <div class="field"><span>{{ t('car.gear') }}</span><strong>{{ label(v.specs.transmission) }}</strong></div>
                  </div>
                  <div class="pair">
                    <button type="button" class="option" :class="{ on: plan === 'day' }" @click="plan = 'day'">
                      <span class="check" aria-hidden="true"><Icon name="check" :size="12" /></span>
                      <strong>{{ t('car.daily') }}</strong>
                      <small>{{ t('car.minDays', { n: v.rental.minDays }) }}</small>
                      <img :src="imgSrc(hero, 'w640')" alt="" />
                      <b>{{ money(daily, v.price.currency) }}<i>{{ t('car.perDay') }}</i></b>
                    </button>
                    <button type="button" class="option" :class="{ on: plan === 'month' }" @click="plan = 'month'">
                      <span class="check" aria-hidden="true"><Icon name="check" :size="12" /></span>
                      <strong>{{ t('car.monthly') }}</strong>
                      <small>{{ t('car.special') }}</small>
                      <img :src="imgSrc(hero, 'w640')" alt="" />
                      <b>{{ t('car.ask') }}<i> LINE</i></b>
                    </button>
                  </div>
                </div>

                <!-- specs -->
                <div v-else-if="tab === 'specs'" key="specs" class="panel">
                  <h2>{{ t('car.tabSpecs') }}</h2>
                  <dl class="grid">
                    <div v-for="[k, val] in specs" :key="k" class="field">
                      <dt>{{ k }}</dt>
                      <dd>{{ val }}</dd>
                    </div>
                  </dl>
                </div>

                <!-- equipment -->
                <div v-else-if="tab === 'features'" key="features" class="panel">
                  <h2>{{ t('car.tabFeatures') }}</h2>
                  <ul class="grid">
                    <li v-for="f in v.features" :key="f.code" class="feat">
                      <span><Icon :name="f.icon" :size="18" /></span>{{ featName(f) }}
                    </li>
                  </ul>
                </div>

                <!-- service -->
                <div v-else key="service" class="panel">
                  <h2>{{ t('car.included') }}</h2>
                  <ul class="grid">
                    <li v-for="x in service" :key="x.t" class="feat">
                      <span><Icon :name="x.icon" :size="18" /></span>
                      <div><strong>{{ x.t }}</strong><small>{{ x.d }}</small></div>
                    </li>
                  </ul>
                </div>
              </Transition>
            </div>
          </div>

          <!-- right: the car on its floor ring -->
          <div class="stage">
            <div class="promo">
              <Icon name="pin" :size="14" />
              <span>{{ t('car.deliverTo') }}<br /><b>{{ v.delivery?.freeKm ? t('car.freeKm', { km: v.delivery.freeKm }) : t('car.allBangkok') }}</b></span>
            </div>
            <figure :key="hero?.url" class="car">
              <div class="frame" :class="{ fitted: fit }" :style="frameStyle">
                <img
                  v-if="hero"
                  :src="imgSrc(hero)"
                  :srcset="srcset(hero.variants)"
                  sizes="(min-width: 1100px) 1100px, 120vw"
                  :alt="hero.alt ?? `${v.brand} ${v.model}`"
                  :style="cropStyle"
                  fetchpriority="high"
                  @load="measureCar"
                />
                <span class="ring" aria-hidden="true" />
              </div>
            </figure>
            <span class="chip"><Icon :name="v.specs.fuel === 'ELECTRIC' ? 'bolt' : 'fuel'" :size="13" /> {{ label(v.specs.fuel) }} · {{ t('car.s.l100', { n: v.specs.fuelEconomy ?? '—' }) }}</span>
            <p v-if="credit" class="credit">
              {{ t('car.photo') }} <a :href="credit.source" target="_blank" rel="noopener">{{ credit.author || credit.title }}</a>,
              <a v-if="credit.licenseUrl" :href="credit.licenseUrl" target="_blank" rel="noopener">{{ credit.license }}</a><template v-else>{{ credit.license }}</template>
              {{ t('car.cutout') }}
            </p>
          </div>
        </div>

        <!-- bottom bar -->
        <footer class="bottom">
          <div class="dots" aria-hidden="true"><i v-for="x in tabs" :key="x.key" :class="{ on: tab === x.key }" /></div>
          <div class="thumbs">
            <RouterLink v-for="o in thumbs" :key="o.id" :to="{ name: 'vehicle', params: { slug: o.slug } }" :title="`${o.brand} ${o.model}`">
              <img :src="o.image?.variants?.w640 ?? o.image?.url" :alt="`${o.brand} ${o.model}`" loading="lazy" />
            </RouterLink>
          </div>
          <div class="price">
            <strong>{{ money(daily, v.price.currency) }}</strong>
            <small>{{ t('car.perDayDeposit', { deposit: money(v.price.depositMinor, v.price.currency) }) }}</small>
          </div>
          <a v-if="line" :href="line" target="_blank" rel="noopener" class="line">LINE</a>
          <button type="button" class="book" @click="openBooking">{{ t('car.book') }}</button>
        </footer>
      </div>
      <p class="desc">{{ carDesc(v) }}</p>
    </section>

    <!-- Availability -->
    <section id="availability" class="section avail">
      <div class="container">
        <div v-reveal class="section-head">
          <h2>{{ t('car.pickDates') }}</h2>
          <p>{{ t('car.pickDatesBody') }}</p>
        </div>
        <div class="avail-grid">
          <AvailabilityCalendar :slug="v.slug" @select="selection = $event" />
          <aside class="summary">
            <h3>{{ t('car.summary') }}</h3>
            <template v-if="selection">
              <p><Icon name="calendar" :size="14" /> {{ selection.from }} → {{ selection.to }}</p>
              <p class="days">{{ t('common.days', { n: selDays }) }} × {{ money(daily, v.price.currency) }}</p>
              <p class="est">{{ money(daily * selDays, v.price.currency) }} <small>{{ t('car.approx') }}</small></p>
              <p class="note">{{ t('car.priceNote') }}</p>
            </template>
            <p v-else class="note">{{ t('car.pickHint') }}</p>
            <button type="button" class="btn btn-primary btn-pill" @click="openBooking">{{ t('car.book') }}</button>
            <a v-if="line" :href="line" target="_blank" rel="noopener" class="btn btn-ghost btn-pill">{{ t('car.bookLine') }}</a>
          </aside>
        </div>
      </div>
    </section>
    <BookingModal v-if="booking" :vehicle="v" :dates="selection" @close="closeBooking" />
  </main>

  <main v-else-if="notFound" class="container missing">
    <h1>{{ t('car.notFound') }}</h1>
    <p>{{ t('car.notFoundBody') }}</p>
    <RouterLink :to="{ name: 'vehicles' }" class="btn btn-primary btn-pill">{{ t('car.allCars') }}</RouterLink>
  </main>
  <main v-else class="loading"><div class="skeleton" /></main>
</template>

<style scoped>
/* ---------- studio backdrop (dark room, overhead light panel, pale floor) ---------- */
.studio {
  position: relative;
  min-height: 100svh;
  padding: 104px clamp(10px, 4vw, 56px) clamp(2.5rem, 5vw, 4rem);
  background:
    radial-gradient(60% 9% at 50% 7%, rgb(240 244 255 / 0.95), rgb(240 244 255 / 0.35) 60%, transparent 100%),
    radial-gradient(70% 40% at 50% 100%, rgb(255 255 255 / 0.55), transparent 70%),
    linear-gradient(180deg, #0c0d10 0%, #1d1e23 40%, #3c3d42 62%, #8d8f94 63%, #c6c7cb 85%, #d9dadd 100%);
  overflow: hidden;
}
.studio::before {
  /* light cone from the panel */
  content: '';
  position: absolute;
  left: 18%;
  right: 18%;
  top: 9%;
  height: 54%;
  background: linear-gradient(180deg, rgb(225 230 245 / 0.12), transparent);
  clip-path: polygon(8% 0, 92% 0, 100% 100%, 0 100%);
  pointer-events: none;
}

/* ---------- glass card ---------- */
.card {
  position: relative;
  max-width: 1240px;
  margin: 0 auto;
  padding: clamp(1rem, 2.2vw, 1.75rem) clamp(1rem, 2.6vw, 2.25rem);
  border-radius: 34px;
  background: linear-gradient(160deg, rgb(250 250 252 / 0.86), rgb(228 229 233 / 0.78));
  border: 1px solid rgb(255 255 255 / 0.65);
  backdrop-filter: blur(22px) saturate(140%);
  box-shadow:
    0 50px 100px -40px rgb(0 0 0 / 0.55),
    inset 0 1px 0 rgb(255 255 255 / 0.8);
  color: #111;
  animation: rise 0.8s var(--ease-out) both;
}
.top {
  display: flex;
  align-items: center;
  gap: var(--s-5);
}
.logo {
  font-family: 'Unbounded', var(--font-display);
  font-weight: 700;
  font-size: 1rem;
  letter-spacing: -0.01em;
}
.logo b {
  color: var(--accent);
}
.links {
  display: flex;
  align-items: center;
  gap: clamp(0.75rem, 2.4vw, 2.2rem);
  margin-left: auto;
  font-size: var(--fs-sm);
}
.links button {
  padding: 0;
  border: 0;
  background: none;
  color: #6b6d75;
  cursor: pointer;
}
.links button.on,
.links button:hover {
  color: #111;
}
.pill {
  height: 36px;
  display: inline-flex;
  align-items: center;
  padding: 0 18px;
  border-radius: var(--r-pill);
  background: #fff;
  box-shadow: 0 6px 16px -10px rgb(0 0 0 / 0.4);
  font-weight: 600;
}
.square {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  margin-left: clamp(0.5rem, 3vw, 3rem);
  border-radius: 12px;
  border: 1px solid rgb(0 0 0 / 0.1);
  background: rgb(255 255 255 / 0.6);
}

.body {
  display: grid;
  grid-template-columns: minmax(300px, 0.85fr) 1.4fr;
  gap: var(--s-6);
  margin-top: var(--s-5);
}
.title {
  display: flex;
  align-items: flex-start;
  gap: var(--s-4);
}
.back {
  flex: none;
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 6px 18px -10px rgb(0 0 0 / 0.5);
}
h1 {
  font-family: var(--font-body);
  font-size: clamp(1.8rem, 1.2rem + 1.8vw, 2.6rem);
  font-weight: 500;
  letter-spacing: -0.02em;
  line-height: 1.1;
}
.title p {
  margin-top: 4px;
  font-size: var(--fs-xs);
  color: #6b6d75;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.config {
  position: relative;
  display: grid;
  grid-template-columns: 52px 1fr;
  gap: var(--s-4);
  margin-top: var(--s-6);
}
.rail {
  display: grid;
  align-content: start;
  gap: 10px;
  padding: 7px;
  border-radius: 999px;
  background: rgb(255 255 255 / 0.55);
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.7);
  height: fit-content;
}
.rail button {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border: 0;
  border-radius: 50%;
  background: #fff;
  color: #111;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}
.rail button.on {
  background: #111;
  color: #fff;
}
.panel h2 {
  font-family: var(--font-body);
  font-size: var(--fs-md);
  font-weight: 600;
  letter-spacing: 0;
  margin-bottom: var(--s-3);
}
.pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 10px;
}
.field {
  display: grid;
  gap: 2px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgb(255 255 255 / 0.75);
}
.field span,
.field dt {
  font-size: 0.7rem;
  color: #6b6d75;
}
.field strong,
.field dd {
  margin: 0;
  font-size: var(--fs-md);
  font-weight: 600;
}
.option {
  position: relative;
  display: grid;
  gap: 2px;
  justify-items: start;
  padding: 12px;
  border: 1.5px solid transparent;
  border-radius: 14px;
  background: linear-gradient(180deg, #fff, #eeeff2);
  text-align: left;
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out);
}
.option.on {
  border-color: #111;
}
.option strong {
  font-size: var(--fs-sm);
}
.option small {
  font-size: 0.7rem;
  color: #6b6d75;
}
.option img {
  width: 100%;
  aspect-ratio: 16 / 8;
  object-fit: contain;
  margin: 6px 0;
  filter: drop-shadow(0 8px 6px rgb(0 0 0 / 0.18));
}
.option b {
  justify-self: end;
  font-size: var(--fs-lg);
}
.option b i {
  font-style: normal;
  font-size: var(--fs-xs);
  font-weight: 400;
  color: #6b6d75;
}
.check {
  position: absolute;
  top: 10px;
  right: 10px;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #111;
  color: #fff;
  opacity: 0;
  transition: opacity var(--dur-fast);
}
.option.on .check {
  opacity: 1;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.feat {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border-radius: 12px;
  background: rgb(255 255 255 / 0.75);
  font-size: var(--fs-sm);
  font-weight: 500;
}
.feat > span {
  flex: none;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: #111;
  color: #fff;
}
.feat strong {
  display: block;
  font-size: var(--fs-sm);
}
.feat small {
  font-size: 0.72rem;
  color: #6b6d75;
}

/* ---------- the car ---------- */
.stage {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 420px;
}
.promo {
  position: absolute;
  top: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 16px;
  background: linear-gradient(135deg, #2b2c31, #0d0e11);
  color: #fff;
  font-size: var(--fs-xs);
  box-shadow: 0 16px 30px -18px rgb(0 0 0 / 0.7);
}
.promo b {
  font-size: var(--fs-md);
}
.promo :deep(svg) {
  color: var(--accent);
}
.car {
  position: relative;
  z-index: 1;
  width: 100%;
  margin: 0;
  animation: drive 1.1s cubic-bezier(0.16, 0.84, 0.3, 1) 0.1s both;
}
/* .frame is the car's own box: cropped to the car (see measureCar), as wide as the stage
   allows but never taller than 300px, so no photo runs past the card. */
.frame {
  position: relative;
  width: min(100%, 300px * 3);
  max-height: 340px;
  margin: 0 auto;
}
.frame.fitted {
  width: 100%;
  max-width: calc(300px * var(--r, 3));
  max-height: 300px;
}
.car img {
  position: relative;
  z-index: 1;
  display: block;
  width: 100%;
  max-height: 340px;
  object-fit: contain;
  filter: drop-shadow(0 26px 18px rgb(0 0 0 / 0.28));
}
/* floor ring, anchored to the car so it always sits under the wheels */
.ring {
  position: absolute;
  left: 2%;
  right: 2%;
  bottom: -9%;
  height: 26%;
  border-radius: 50%;
  border: 1.5px solid rgb(255 255 255 / 0.9);
  background: radial-gradient(closest-side, rgb(0 0 0 / 0.12), transparent);
  box-shadow: 0 0 30px rgb(255 255 255 / 0.6);
}
.chip {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: -10px;
  padding: 7px 14px;
  border-radius: 999px;
  background: rgb(255 255 255 / 0.85);
  font-size: var(--fs-xs);
  font-weight: 600;
  box-shadow: 0 8px 18px -12px rgb(0 0 0 / 0.5);
}
.credit {
  position: absolute;
  left: 0;
  bottom: 0;
  font-size: 0.66rem;
  color: #8a8c93;
}
.credit a {
  text-decoration: underline;
}

/* ---------- bottom bar ---------- */
.bottom {
  display: flex;
  align-items: center;
  gap: var(--s-5);
  margin-top: var(--s-4);
}
.dots {
  display: flex;
  gap: 5px;
}
.dots i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #b6b8be;
}
.dots i.on {
  width: 18px;
  border-radius: 3px;
  background: #111;
}
.thumbs {
  display: flex;
  gap: 10px;
  margin-left: auto;
}
.thumbs a {
  display: grid;
  place-items: center;
  width: 108px;
  height: 64px;
  padding: 6px;
  border-radius: 10px;
  background: linear-gradient(180deg, #fafafa, #dcdde1);
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.8);
  transition: transform var(--dur-fast) var(--ease-out);
}
.thumbs a:hover {
  transform: translateY(-3px);
}
.thumbs img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.price {
  display: grid;
  text-align: right;
}
.price strong {
  font-size: var(--fs-lg);
  font-weight: 700;
}
.price small {
  font-size: 0.7rem;
  color: #6b6d75;
}
.book {
  display: inline-flex;
  align-items: center;
  height: 42px;
  padding: 0 26px;
  border-radius: var(--r-pill);
  background: #111;
  color: #fff;
  font-size: var(--fs-sm);
  font-weight: 600;
  transition: background var(--dur-fast) var(--ease-out);
}
.book {
  border: 0;
  cursor: pointer;
  background: var(--accent);
}
.book:hover {
  background: #111;
}
.line {
  display: inline-flex;
  align-items: center;
  height: 42px;
  padding: 0 18px;
  border: 1px solid #111;
  border-radius: var(--r-pill);
  color: #111;
  font-size: var(--fs-sm);
  font-weight: 600;
}
.line:hover {
  background: #06c755;
  border-color: #06c755;
  color: #fff;
}
.desc {
  position: relative;
  max-width: 720px;
  margin: var(--s-6) auto 0;
  text-align: center;
  color: #2b2c31;
}

/* ---------- below the fold ---------- */
.avail {
  background: var(--surface);
}
.avail-grid {
  display: grid;
  grid-template-columns: 1fr 300px;
  gap: var(--s-6);
  align-items: start;
}
.summary {
  position: sticky;
  top: 88px;
  display: grid;
  gap: var(--s-3);
  padding: var(--s-5);
  border-radius: var(--r-lg);
  background: var(--bg);
}
.summary h3 {
  font-family: var(--font-body);
  font-size: var(--fs-lg);
  font-weight: 700;
}
.summary p {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-sm);
}
.days {
  color: var(--text-muted);
}
.est {
  font-size: 1.8rem !important;
  font-weight: 800;
}
.est small {
  font-size: var(--fs-xs);
  font-weight: 400;
  color: var(--text-muted);
}
.note {
  color: var(--text-muted);
  font-size: var(--fs-xs) !important;
}
.missing {
  min-height: 80dvh;
  display: grid;
  align-content: center;
  justify-items: start;
  gap: var(--s-4);
  padding-top: 64px;
}
.loading .skeleton {
  height: 100dvh;
  border-radius: 0;
}

.panel-enter-active,
.panel-leave-active {
  transition:
    opacity 0.22s var(--ease-out),
    transform 0.22s var(--ease-out);
}
.panel-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.panel-leave-to {
  opacity: 0;
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(30px) scale(0.98);
  }
}
@keyframes drive {
  from {
    opacity: 0;
    transform: translateX(-18%);
    filter: blur(6px);
  }
}
@media (max-width: 960px) {
  .body {
    grid-template-columns: 1fr;
  }
  .stage {
    order: -1;
    min-height: 260px;
  }
  .links button {
    display: none;
  }
  .bottom {
    flex-wrap: wrap;
  }
  .thumbs {
    margin-left: 0;
    order: 2;
    width: 100%;
  }
  .price {
    margin-left: auto;
  }
  .avail-grid {
    grid-template-columns: 1fr;
  }
  .summary {
    position: static;
  }
}
@media (max-width: 520px) {
  .grid,
  .pair {
    grid-template-columns: 1fr;
  }
  .promo {
    display: none;
  }
  .thumbs a {
    flex: 1;
    width: auto;
  }
}
@media (prefers-reduced-motion: reduce) {
  .card,
  .car {
    animation: none;
  }
}

/* ---------- phones: one simple page ---------- */
.phone,
.p-overlay {
  display: none;
}
@media (max-width: 720px) {
  .studio,
  .avail {
    display: none;
  }
  .phone {
    display: block;
    min-height: 100svh;
    background: #eceef1;
    color: #111;
  }
  .p-overlay {
    display: flex;
  }
}
/* the car's "showroom": the room photo, darkened so the white title reads */
.p-top {
  position: relative;
  padding: 84px 0 20px;
  background:
    linear-gradient(180deg, rgb(12 13 16 / 0.55) 0%, rgb(12 13 16 / 0.15) 45%, rgb(12 13 16 / 0.65) 100%),
    url(/media/detail-room.jpg) center 30% / cover;
  color: #fff;
}
.p-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 20px;
}
.p-back {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #fff;
  color: #111;
}
.p-cat {
  font-size: var(--fs-xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgb(255 255 255 / 0.75);
}
.p-title {
  display: grid;
  margin: 14px 20px 0;
  font-family: var(--font-body);
  font-size: 2rem;
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: -0.02em;
}
.p-title {
  padding-right: 64px; /* clear of the side buttons */
  text-shadow: 0 2px 18px rgb(0 0 0 / 0.35);
}
.p-title span {
  font-size: 1.15rem;
  font-weight: 500;
  color: rgb(255 255 255 / 0.7);
}
/* round glass buttons down the right edge: favourite, availability, share */
.p-rail {
  position: absolute;
  z-index: 2;
  top: 132px;
  right: 16px;
  display: grid;
  gap: 6px;
  padding: 6px;
  border-radius: 999px;
  background: rgb(20 22 26 / 0.45);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
}
.p-rail button {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: rgb(255 255 255 / 0.12);
  color: #fff;
  cursor: pointer;
}
.p-rail button.on {
  background: #fff;
  color: var(--accent);
}
.p-rail button.on :deep(svg) {
  fill: currentColor;
}
.p-gallery {
  display: flex;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
}
.p-gallery::-webkit-scrollbar {
  display: none;
}
.p-car {
  flex: 0 0 100%;
  scroll-snap-align: center;
  margin: 8px 0 0;
  padding: 0 12px;
}
.p-car img {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: contain;
  filter: drop-shadow(0 22px 16px rgb(0 0 0 / 0.5));
}
.p-shots {
  display: flex;
  justify-content: center;
  gap: 6px;
  margin-top: 6px;
}
.p-shots i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgb(255 255 255 / 0.4);
  transition: width var(--dur-fast) var(--ease-out);
}
.p-shots i.on {
  width: 18px;
  border-radius: 3px;
  background: #fff;
}
.p-toast {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  padding: 6px 14px;
  border-radius: 999px;
  background: rgb(0 0 0 / 0.7);
  font-size: var(--fs-xs);
}
/* white cards lifted off the grey sheet */
.p-card {
  padding: 14px;
  border-radius: 18px;
  background: #fff;
  box-shadow:
    0 1px 2px rgb(0 0 0 / 0.05),
    0 8px 24px -12px rgb(0 0 0 / 0.18);
}
.p-sheet {
  position: relative;
  margin-top: -18px;
  /* room for the pinned price bar */
  padding: 18px 16px calc(104px + env(safe-area-inset-bottom));
  border-radius: 24px 24px 0 0;
  background: #eceef1;
}
.p-specs {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  margin: 0;
}
.p-specs div {
  display: grid;
  justify-items: center;
  gap: 2px;
  padding: 0 4px;
  text-align: center;
  border-left: 1px solid #ececec;
}
.p-specs div:first-child {
  border-left: 0;
}
.p-ico {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  margin-bottom: 4px;
  border-radius: 12px;
  background: #f1f2f4;
  color: #111;
}
.p-specs dd {
  margin: 0;
  font-size: var(--fs-sm);
  font-weight: 700;
  line-height: 1.25;
}
.p-specs dt {
  order: 2;
  font-size: 0.68rem;
  color: #8a8a8a;
}
.p-sheet h3 {
  margin: 22px 4px 10px;
  font-family: var(--font-body);
  font-size: var(--fs-md, 1rem);
  font-weight: 700;
  color: #111;
}
.p-inc {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.p-inc li {
  display: flex;
  gap: 8px;
  padding: 12px;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 6px 18px -12px rgb(0 0 0 / 0.2);
}
.p-inc strong {
  display: block;
  font-size: var(--fs-sm);
  font-weight: 600;
  line-height: 1.3;
}
.p-inc small {
  font-size: 0.72rem;
  color: #777;
}
.p-desc {
  margin-top: 14px;
  font-size: var(--fs-sm);
  line-height: 1.6;
  color: #555;
}
.p-others {
  display: flex;
  gap: 8px;
  margin: 0 -16px;
  padding: 0 16px 8px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
}
.p-others::-webkit-scrollbar {
  display: none;
}
.p-others a {
  flex: 0 0 42%;
  scroll-snap-align: start;
  padding: 10px;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 6px 18px -12px rgb(0 0 0 / 0.2);
  color: #111;
  font-size: var(--fs-xs);
  font-weight: 600;
}
.p-others img {
  width: 100%;
  aspect-ratio: 16 / 10;
  object-fit: contain;
}
/* price + book, pinned to the bottom of the screen */
.p-bar {
  position: fixed;
  z-index: 30;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
  border-top: 1px solid #e6e6e6;
  background: rgb(255 255 255 / 0.94);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
}
.p-bar p {
  flex: 1;
  margin: 0;
  line-height: 1.15;
}
.p-bar strong {
  font-size: 1.5rem;
  font-weight: 700;
}
.p-bar span {
  font-size: var(--fs-sm);
  color: #777;
}
.p-bar small {
  display: block;
  font-size: 0.7rem;
  color: #9a9a9a;
}
.p-line {
  height: 50px;
  padding: 0 14px;
  display: grid;
  place-items: center;
  border-radius: 16px;
  background: #06c755;
  color: #fff;
  font-size: var(--fs-xs);
  font-weight: 700;
}
.p-book {
  height: 50px;
  padding: 0 26px;
  border: 0;
  border-radius: 16px;
  background: #111;
  color: #fff;
  font-size: var(--fs-sm);
  font-weight: 600;
  cursor: pointer;
}
.p-book.wide {
  width: 100%;
}
/* the date sheet */
.p-overlay {
  position: fixed;
  z-index: var(--z-modal, 100);
  inset: 0;
  align-items: flex-end;
  background: rgb(0 0 0 / 0.45);
}
.p-dates {
  width: 100%;
  max-height: 92svh;
  overflow-y: auto;
  display: grid;
  gap: 14px;
  padding: 18px 16px calc(16px + env(safe-area-inset-bottom));
  border-radius: 24px 24px 0 0;
  background: var(--surface, #fff);
  color: var(--text);
}
.p-dates header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.p-dates h2 {
  font-family: var(--font-body);
  font-size: 1.2rem;
  font-weight: 600;
}
.p-x {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: #f0f0f0;
  cursor: pointer;
}
.p-sum {
  margin: 0;
  font-size: var(--fs-sm);
}
.p-sum b {
  float: right;
}
.p-sum.muted {
  color: var(--text-muted);
}
.sheet-enter-active,
.sheet-leave-active {
  transition: background 0.3s var(--ease-out);
}
.sheet-enter-active .p-dates,
.sheet-leave-active .p-dates {
  transition: transform 0.35s var(--ease-out);
}
.sheet-enter-from,
.sheet-leave-to {
  background: rgb(0 0 0 / 0);
}
.sheet-enter-from .p-dates,
.sheet-leave-to .p-dates {
  transform: translateY(100%);
}
</style>
