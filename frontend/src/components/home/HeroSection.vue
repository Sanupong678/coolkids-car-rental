<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/ui/Icon.vue'
import RentalSearch from '@/components/booking/RentalSearch.vue'
import DriveInStage from '@/components/home/DriveInStage.vue'
import HeroVideo from '@/components/home/HeroVideo.vue'
import HeroScrollFilm from '@/components/home/HeroScrollFilm.vue'
import HeroStudioDrive from '@/components/home/HeroStudioDrive.vue'
import HeroScrollVideo from '@/components/home/HeroScrollVideo.vue'
import HeroCopy from '@/components/home/HeroCopy.vue'
import { toLocalInput } from '@/utils/format'
import { useI18n } from '@/i18n'

// Homepage hero (rRw reference). The stage depends on the CMS section config:
//   motion "video-bg" + config.video        → full-bleed video scrubbed by the scroll wheel (HeroScrollVideo)
//   motion "studio-drive" + config.asset   → studio scene, car drives in through the glass wordmark
//   motion "scroll-film" + config.sequence → scroll-scrubbed film, car in front of the wordmark
//   banner video                            → clip card in front of the wordmark
//   neither                                 → SVG drive-in motion graphic
// A white search card with rental-length tabs straddles the bottom edge.
const props = defineProps({ section: { type: Object, required: true } })
const router = useRouter()

const banner = computed(() => props.section.banners?.[0] ?? {})
const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const backdrop = computed(() => (props.section.config?.motion === 'video-bg' && props.section.config.video ? props.section.config : null))
const studio = computed(() => (props.section.config?.motion === 'studio-drive' ? props.section.config.asset : null))
const film = computed(() => (props.section.config?.motion === 'scroll-film' ? props.section.config.sequence : null))
const hasVideo = computed(() => !backdrop.value && !studio.value && !film.value && !!banner.value.video)

const replayKey = ref(0)

// Rental-length presets fill the dates: tomorrow 10:00 → +1 / +7 / +30 days.
const { t, tx } = useI18n()
const plans = [
  { key: 'day', days: 2 },
  { key: 'week', days: 7 },
  { key: 'month', days: 30 },
]
const plan = ref('day')
const search = ref({ pickup: '', dropoff: '', from: '', to: '' })
function choosePlan(p) {
  plan.value = p.key
  const from = search.value.from ? new Date(search.value.from) : new Date(Date.now() + 86_400_000)
  if (!search.value.from) from.setHours(10, 0, 0, 0)
  const to = new Date(from.getTime() + p.days * 86_400_000)
  search.value = { ...search.value, from: toLocalInput(from), to: toLocalInput(to) }
}
// start with tomorrow 10:00 → +2 days filled in, like the reference bar
onMounted(() => choosePlan(plans[0]))
function onSearch(q) {
  router.push({ name: 'vehicles', query: { pickup: q.pickup || undefined, dropoff: q.dropoff || undefined, from: q.from || undefined, to: q.to || undefined } })
}
</script>

<template>
  <section class="hero" :class="{ 'is-film': film || studio || backdrop, 'is-backdrop': backdrop }">
    <HeroScrollVideo
      v-if="backdrop"
      :src="backdrop.video"
      :poster="backdrop.poster"
      :line="banner.ctaSecondary?.href"
      :headline="banner.headline"
    >
      <div class="container search-wrap dark">
        <div class="tabs" role="tablist" :aria-label="t('search.period')">
          <button
            v-for="p in plans"
            :key="p.key"
            type="button"
            role="tab"
            :aria-selected="plan === p.key"
            :class="{ on: plan === p.key }"
            @click="choosePlan(p)"
          >
            {{ t(`search.${p.key}`) }}
          </button>
        </div>
        <RentalSearch v-model="search" variant="hero" @search="onSearch" />
      </div>
    </HeroScrollVideo>
    <HeroStudioDrive v-else-if="studio":asset="studio" :alt="t('home.studioAlt')">
      <!-- the wordmark is the visual title; keep a real heading for screen readers and search -->
      <h1 class="sr-only">Coolkids Car Rental — {{ banner.headline ? tx(banner.headline) : t('home.tagline') }}</h1>
    </HeroStudioDrive>
    <HeroScrollFilm v-else-if="film" :base="film" :alt="banner.headline">
      <template #default="{ done }">
        <HeroCopy :banner="banner" variant="film" :show="done" />
      </template>
    </HeroScrollFilm>

    <div v-else class="frame" :class="{ 'is-video': hasVideo }">
      <HeroVideo v-if="hasVideo" :src="banner.video" :poster="banner.poster" :alt="banner.headline" />
      <template v-else>
        <DriveInStage :key="replayKey" class="scene" :still="reduced" />
        <div class="shade" aria-hidden="true" />
      </template>
      <HeroCopy :banner="banner" :variant="hasVideo ? 'video' : 'scene'" />
      <button v-if="!reduced && !hasVideo" type="button" class="replay" @click="replayKey++">
        <Icon name="play" :size="12" /> {{ t('home.replay') }}
      </button>
    </div>

    <div v-if="!backdrop" class="container search-wrap">
      <div class="tabs" role="tablist" :aria-label="t('search.period')">
        <button
          v-for="p in plans"
          :key="p.key"
          type="button"
          role="tab"
          :aria-selected="plan === p.key"
          :class="{ on: plan === p.key }"
          @click="choosePlan(p)"
        >
          {{ t(`search.${p.key}`) }}
        </button>
      </div>
      <RentalSearch v-model="search" variant="hero" @search="onSearch" />
    </div>
  </section>
</template>

<style scoped>
.hero {
  padding: 10px 10px 0;
}
/* the film is full-bleed: edge to edge, no outer padding */
.hero.is-film {
  padding: 0;
}
.frame {
  position: relative;
  height: max(640px, min(100svh - 20px, 940px));
  border-radius: 28px;
  overflow: hidden;
  isolation: isolate;
  background: #0b0c12;
  color: #fff;
}
.scene {
  position: absolute;
  inset: 0;
  z-index: -2;
}
.shade {
  position: absolute;
  inset: auto 0 0;
  height: 42%;
  z-index: -1;
  background: linear-gradient(0deg, rgb(7 8 12 / 0.9), transparent);
  pointer-events: none;
}
.replay {
  position: absolute;
  top: 96px;
  right: clamp(1.25rem, 4vw, 3.5rem);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid rgb(255 255 255 / 0.2);
  border-radius: var(--r-pill);
  background: rgb(255 255 255 / 0.06);
  color: rgb(255 255 255 / 0.75);
  font-size: var(--fs-xs);
  cursor: pointer;
  backdrop-filter: blur(8px);
}
.replay:hover {
  color: #fff;
  border-color: rgb(255 255 255 / 0.45);
}

/* search card straddles the bottom edge of the stage */
.search-wrap {
  position: relative;
  z-index: 2;
  margin-top: -54px;
  max-width: 1060px;
  animation: rise 1s var(--ease-out) 1.4s both;
}
.tabs {
  display: flex;
  width: fit-content;
  margin-inline: auto;
  border-radius: 14px 14px 0 0;
  overflow: hidden;
}
.tabs button {
  height: 40px;
  padding: 0 1.4rem;
  border: 0;
  background: #e4e4e2;
  color: var(--text-muted);
  font-size: var(--fs-sm);
  cursor: pointer;
}
.tabs button.on {
  background: var(--surface);
  color: var(--text);
  font-weight: 600;
}
/* over the video: dark smoked-glass bar (reference: "Professional Upkeep" pill) */
.search-wrap.dark {
  margin-top: 0;
  animation: none;
  max-width: 1120px;
}
.dark .tabs {
  gap: 4px;
  padding: 4px;
  margin-bottom: 10px;
  border-radius: var(--r-pill);
  border: 1px solid rgb(255 255 255 / 0.14);
  background: rgb(22 22 26 / 0.5);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
  backdrop-filter: blur(18px) saturate(140%);
}
.dark .tabs button {
  height: 32px;
  padding: 0 1.1rem;
  border-radius: var(--r-pill);
  background: transparent;
  color: rgb(255 255 255 / 0.7);
  font-size: var(--fs-xs);
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}
.dark .tabs button:hover {
  color: #fff;
}
.dark .tabs button.on {
  background: rgb(255 255 255 / 0.9);
  color: #111;
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(18px);
  }
}
@media (max-width: 720px) {
  .hero:not(.is-film) {
    padding: 6px 6px 0;
  }
  .frame {
    height: auto;
    border-radius: 20px;
    padding-top: 76px;
  }
  .scene {
    position: relative;
    inset: auto;
    height: auto;
    aspect-ratio: 940 / 580;
  }
  .shade {
    display: none;
  }
  /* sit on the floor of the scene, under the car */
  .replay {
    top: calc(76px + (100vw - 12px) * 0.617 - 42px);
    right: 14px;
  }
}
@media (max-width: 720px) {
  .frame.is-video {
    height: max(640px, 100svh - 12px);
    padding-top: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .search-wrap {
    animation: none;
  }
}
</style>
