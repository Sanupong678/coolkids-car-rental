<script setup>
import { t } from '@/i18n'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { getFacets, getHomepage, getPromotions, listVehicles } from '@/api/catalogue'
import { useSiteStore } from '@/stores/site'
import HeroSection from '@/components/home/HeroSection.vue'
import CategoryShowcase from '@/components/home/CategoryShowcase.vue'
import ShowcaseSection from '@/components/home/ShowcaseSection.vue'
import FeaturedFleet from '@/components/home/FeaturedFleet.vue'
import PromotionsSection from '@/components/home/PromotionsSection.vue'
import PromoBand from '@/components/home/PromoBand.vue'
import WhyChooseUs from '@/components/home/WhyChooseUs.vue'
import BrandStrip from '@/components/home/BrandStrip.vue'
import LocationsSection from '@/components/home/LocationsSection.vue'
import ReviewsSection from '@/components/home/ReviewsSection.vue'
import AmbientBackdrop from '@/components/home/AmbientBackdrop.vue'

// The homepage is a list of CMS sections (homepage_sections). Order, copy and
// visibility are controlled from the admin CMS; this view only maps each
// section_type to its component and feeds it data.
const site = useSiteStore()
const route = useRoute()
const sections = ref([])
const featured = ref([])
const promotions = ref([])
const brands = ref([])
const failed = ref(false)

// The homepage runs on the hero's ambient light from top to footer: dark tokens
// for every section, transparent backgrounds, and the footer fades in from it.
onMounted(() => document.body.classList.add('ambient-page'))
onBeforeUnmount(() => document.body.classList.remove('ambient-page'))

onMounted(async () => {
  try {
    const [home, vehicles, promos, facets] = await Promise.all([
      getHomepage(),
      listVehicles({ sort: 'recommended', pageSize: 24 }),
      getPromotions(),
      getFacets(),
      site.load(),
    ])
    sections.value = home
    // Featured first, then the rest, so the MODEL band always has content.
    featured.value = [...vehicles.data].sort((a, b) => Number(b.isFeatured) - Number(a.isFeatured))
    promotions.value = promos
    brands.value = facets.brands ?? []
  } catch (err) {
    console.error(err)
    failed.value = true
  }
})

const components = {
  hero: HeroSection,
  // the "choose your style" slot shows the four car classes as photo cards
  category_slider: CategoryShowcase,
  showcase: ShowcaseSection,
  featured_vehicles: FeaturedFleet,
  promotions: PromotionsSection,
  promo_band: PromoBand,
  why_choose_us: WhyChooseUs,
  brand_strip: BrandStrip,
  locations_map: LocationsSection,
  reviews: ReviewsSection,
}

const propsFor = (s) => {
  switch (s.type) {
    case 'category_slider':
      return { vehicles: featured.value }
    case 'featured_vehicles':
      return { vehicles: featured.value }
    case 'promotions':
      return { promotions: promotions.value }
    case 'promo_band':
      return { promotion: promotions.value.find((p) => p.is_featured) ?? promotions.value[0] ?? null }
    case 'brand_strip':
      return { brands: brands.value }
    case 'locations_map':
      return { locations: site.locations, contact: site.content?.contact ?? null }
    case 'reviews':
      return { reviews: site.content?.reviews ?? null }
    default:
      return {}
  }
}

const authError = computed(() => {
  const map = {
    cancelled: 'Sign-in was cancelled.',
    account_disabled: 'This account has been disabled. Please contact support.',
    signin_failed: 'We could not sign you in. Please try again.',
    invalid_request: 'We could not sign you in. Please try again.',
  }
  return map[route.query.auth_error] ?? null
})
</script>

<template>
  <main class="home">
    <AmbientBackdrop />
    <p v-if="authError" class="toast" role="alert">{{ authError }}</p>

    <div v-if="!sections.length && !failed" class="loading" aria-busy="true">
      <div class="skeleton hero-skel" />
    </div>
    <div v-else-if="failed" class="container failed">
      <h1>{{ t('page.downTitle') }}</h1>
      <p>{{ t('page.downBody') }}</p>
    </div>

    <template v-for="s in sections" :key="s.id">
      <component :is="components[s.type]" v-if="components[s.type]" :section="s" v-bind="propsFor(s)" />
    </template>
  </main>
</template>

<style scoped>
.home {
  --bg: transparent;
  --text: #f1f2f4;
  --text-muted: rgb(255 255 255 / 0.62);
  --surface: rgb(255 255 255 / 0.06);
  --surface-raised: rgb(255 255 255 / 0.08);
  --border: rgb(255 255 255 / 0.1);
  --border-strong: rgb(255 255 255 / 0.2);
  --accent-soft: rgb(226 54 44 / 0.25);
  --focus-ring: 0 0 0 2px #111, 0 0 0 4px var(--accent);
  color: var(--text);
}
.home :deep(.btn-dark) {
  background: #fff;
  color: #111;
}
.home :deep(.btn-dark:hover) {
  background: #e7e7ea;
}
.toast {
  position: fixed;
  top: 88px;
  left: 50%;
  transform: translateX(-50%);
  z-index: var(--z-dropdown);
  padding: var(--s-3) var(--s-5);
  border: 1px solid rgb(229 103 92 / 0.5);
  border-radius: var(--r-md);
  background: var(--surface-glass);
  backdrop-filter: blur(12px);
  color: var(--danger);
}
.hero-skel {
  height: 100dvh;
  border-radius: 0;
}
.failed {
  min-height: 80dvh;
  display: grid;
  align-content: center;
  gap: var(--s-3);
}
.failed p {
  color: var(--text-muted);
}
</style>
