<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { reverseGeocode, searchPlaces } from '@/api/bookings'
import Icon from '@/components/ui/Icon.vue'
import { t } from '@/i18n'

// "เลือกจากแผนที่": the pin stays in the middle and the customer moves the map
// under it (like ride-hailing apps), jumps to their GPS position, or searches
// a place name (condo, hotel, mall, road) and picks a result. Each stop
// is turned into a Thai address by the server; "ใช้ตำแหน่งนี้" hands back
// { address, lat, lng } to the form field that opened it.
const props = defineProps({
  title: { type: String, default: () => t('map.title') },
  start: { type: Object, default: null }, // { lat, lng } of a previous pick
})
const emit = defineEmits(['pick', 'close'])

const BANGKOK = { lat: 13.7563, lng: 100.5018 }
const dialog = ref(null)
const el = ref(null)
const address = ref('')
const looking = ref(false)
const locating = ref(false)
const error = ref('')
let map
let timer
let lookupId = 0
let presetAddress = null // a chosen search result already knows its address

// ---- search (on submit: the free OpenStreetMap service does not allow search-as-you-type)
const q = ref('')
const results = ref(null) // null = no search yet
const searching = ref(false)
async function search() {
  const text = q.value.trim()
  if (text.length < 2 || searching.value) return
  searching.value = true
  error.value = ''
  try {
    results.value = await searchPlaces(text)
  } catch (err) {
    results.value = []
    error.value = t(err.status === 429 ? 'map.searchBusy' : 'map.searchFail')
  } finally {
    searching.value = false
  }
}
function choose(place) {
  results.value = null
  presetAddress = [place.name, place.address].filter(Boolean).join(' ')
  map.setView([place.lat, place.lng], 17)
}

async function lookup() {
  const { lat, lng } = map.getCenter()
  const id = ++lookupId
  looking.value = true
  error.value = ''
  try {
    const r = await reverseGeocode(lat, lng)
    if (id === lookupId) address.value = r.address
  } catch (err) {
    if (id === lookupId) {
      address.value = ''
      error.value = t(err.status === 429 ? 'map.moveBusy' : 'map.noAddress')
    }
  } finally {
    if (id === lookupId) looking.value = false
  }
}
// Look the address up once the map stops moving (not on every frame of a drag).
function onMove() {
  clearTimeout(timer)
  if (presetAddress) {
    address.value = presetAddress
    presetAddress = null
    looking.value = false
    return
  }
  looking.value = true
  timer = setTimeout(lookup, 600)
}

function locate() {
  if (!('geolocation' in navigator)) {
    error.value = t('map.noGeo')
    return
  }
  locating.value = true
  error.value = ''
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      locating.value = false
      map.setView([coords.latitude, coords.longitude], 17)
    },
    (e) => {
      locating.value = false
      error.value = t(e.code === 1 ? 'map.denied' : 'map.geoFail')
    },
    { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
  )
}

function confirm() {
  const { lat, lng } = map.getCenter()
  emit('pick', { address: address.value, lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) })
  close()
}
function close() {
  dialog.value?.close()
  emit('close')
}

onMounted(() => {
  dialog.value.showModal()
  const start = props.start?.lat != null ? props.start : BANGKOK
  map = L.map(el.value, { zoomControl: false, attributionControl: true }).setView([start.lat, start.lng], props.start ? 17 : 12)
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map)
  L.control.zoom({ position: 'bottomright' }).addTo(map)
  map.on('movestart', () => {
    if (!presetAddress) looking.value = true
    results.value = null
  })
  map.on('moveend', onMove)
  // The dialog finishes laying out after mount: let Leaflet measure it again.
  setTimeout(() => map.invalidateSize(), 50)
  if (props.start) lookup()
  else locate()
})
onBeforeUnmount(() => {
  clearTimeout(timer)
  map?.remove()
})
</script>

<template>
  <dialog ref="dialog" class="mp" :aria-label="title" @cancel.prevent="close">
    <div class="card">
      <header>
        <strong>{{ title }}</strong>
        <button type="button" class="x" :aria-label="t('common.close')" @click="close"><Icon name="x" :size="18" /></button>
      </header>
      <form class="search" role="search" @submit.prevent="search">
        <input v-model="q" type="search" enterkeyhint="search" :placeholder="t('map.searchPh')" :aria-label="t('map.searchLabel')" />
        <button type="submit" :disabled="searching || q.trim().length < 2">{{ t(searching ? 'map.searching' : 'map.search') }}</button>
      </form>
      <div class="stage">
        <ul v-if="results" class="results">
          <li v-for="(r, i) in results" :key="i">
            <button type="button" @click="choose(r)">
              <Icon name="pin" :size="15" />
              <span><strong>{{ r.name }}</strong><small v-if="r.address">{{ r.address }}</small></span>
            </button>
          </li>
          <li v-if="!results.length" class="none">{{ t('map.none') }}</li>
        </ul>
        <div ref="el" class="map" />
        <span class="pin" aria-hidden="true"><Icon name="pin" :size="40" :stroke="2" /></span>
        <button type="button" class="me" :disabled="locating" @click="locate">
          <Icon name="navigation" :size="16" /> {{ t(locating ? 'map.locating' : 'map.useMine') }}
        </button>
      </div>
      <footer>
        <p class="hint">{{ t('map.hint') }}</p>
        <p class="addr" aria-live="polite">
          <Icon name="pin" :size="15" />
          <span v-if="looking" class="muted">{{ t('map.looking') }}</span>
          <span v-else-if="address">{{ address }}</span>
          <span v-else class="err">{{ error || t('map.notChosen') }}</span>
        </p>
        <p v-if="error && address" class="err">{{ error }}</p>
        <button type="button" class="ok" :disabled="looking || !address" @click="confirm">{{ t('map.use') }}</button>
      </footer>
    </div>
  </dialog>
</template>

<style scoped>
.mp {
  width: min(560px, calc(100vw - 16px));
  max-height: calc(100dvh - 16px);
  padding: 0;
  border: 0;
  background: transparent;
  color: #121319;
  color-scheme: light;
}
.mp::backdrop {
  background: rgb(8 9 12 / 0.6);
}
.card {
  display: flex;
  flex-direction: column;
  height: min(680px, calc(100dvh - 16px));
  overflow: hidden;
  border-radius: 20px;
  background: #fff;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #ececee;
}
.x {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 50%;
  background: #f2f3f5;
  cursor: pointer;
}
.search {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #ececee;
}
.search input {
  flex: 1;
  min-width: 0;
  min-height: 44px;
  padding: 0 14px;
  border: 1px solid #dcdee3;
  border-radius: 999px;
  font: inherit;
  font-size: 16px; /* 16px keeps iOS from zooming the page on focus */
}
.search input:focus-visible {
  outline: none;
  border-color: #e2362c;
  box-shadow: 0 0 0 3px rgb(226 54 44 / 0.15);
}
.search button {
  min-height: 44px;
  padding: 0 16px;
  border: 0;
  border-radius: 999px;
  background: #121319;
  color: #fff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.search button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.results {
  position: absolute;
  inset: 0 0 auto;
  z-index: 600;
  max-height: 70%;
  margin: 0;
  padding: 4px 0;
  overflow-y: auto;
  list-style: none;
  background: #fff;
  box-shadow: 0 10px 24px -12px rgb(0 0 0 / 0.35);
}
.results button {
  display: flex;
  gap: 10px;
  width: 100%;
  padding: 10px 14px;
  border: 0;
  background: none;
  text-align: left;
  font: inherit;
  cursor: pointer;
}
.results button:hover,
.results button:focus-visible {
  background: #fff5f4;
  outline: none;
}
.results :deep(svg) {
  flex: none;
  margin-top: 3px;
  color: #e2362c;
}
.results span {
  display: grid;
  gap: 2px;
}
.results strong {
  font-size: 0.9rem;
}
.results small {
  color: #6b6e7a;
  font-size: 0.78rem;
}
.results .none {
  padding: 12px 14px;
  color: #6b6e7a;
  font-size: 0.85rem;
}
.stage {
  position: relative;
  flex: 1;
  min-height: 0;
}
.map {
  position: absolute;
  inset: 0;
  isolation: isolate;
}
/* Leaflet focuses the map on click: show a ring for keyboard users only (red read as an error). */
.map:focus:not(:focus-visible) {
  outline: none;
}
.map:focus-visible {
  outline: 3px solid rgb(226 54 44 / 0.35);
  outline-offset: -3px;
}
/* The tip of the pin marks the map centre. */
.pin {
  position: absolute;
  left: 50%;
  top: 50%;
  z-index: 500;
  color: #e2362c;
  transform: translate(-50%, -100%);
  filter: drop-shadow(0 4px 6px rgb(0 0 0 / 0.35));
  pointer-events: none;
}
.pin :deep(svg) {
  fill: #fff;
}
.me {
  position: absolute;
  left: 12px;
  bottom: 12px;
  z-index: 500;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 40px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.2);
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}
footer {
  display: grid;
  gap: 8px;
  padding: 12px 16px calc(14px + env(safe-area-inset-bottom));
  border-top: 1px solid #ececee;
}
.hint {
  color: #8d909b;
  font-size: 0.75rem;
}
.addr {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  min-height: 2.6em;
  font-size: 0.9rem;
  font-weight: 500;
}
.addr :deep(svg) {
  flex: none;
  margin-top: 3px;
  color: #e2362c;
}
.muted {
  color: #8d909b;
}
.err {
  color: #c22a21;
  font-size: 0.8rem;
}
.ok {
  min-height: 48px;
  border: 0;
  border-radius: 999px;
  background: #e2362c;
  color: #fff;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.ok:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
