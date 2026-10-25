<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { t } from '@/i18n'

// Customer's live delivery map: the car (driver's latest GPS fix), the drop-off
// point and a dashed line between them. The view frames both once, then only
// the car marker moves so pinch-zooming is not undone by every update.
const props = defineProps({
  position: { type: Object, default: null }, // { lat, lng }
  destination: { type: Object, default: null }, // { lat, lng }
  branch: { type: Object, default: null }, // { lat, lng } before the first fix
})

const el = ref(null)
let map
let car
let dest
let line
let ro
let framed = false

const icon = (cls, html) => L.divIcon({ className: '', html: `<span class="${cls}">${html}</span>`, iconSize: [36, 36], iconAnchor: [18, 18] })
const CAR = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 17h14l-1.5-6.5A2 2 0 0 0 15.6 9H8.4a2 2 0 0 0-1.9 1.5Z"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/></svg>'

function draw() {
  if (!map) return
  const from = props.position ?? props.branch
  if (props.destination?.lat != null) {
    const p = [props.destination.lat, props.destination.lng]
    dest ??= L.marker(p, { icon: L.divIcon({ className: '', html: '<span class="dest"></span>', iconSize: [28, 36], iconAnchor: [14, 34] }) }).addTo(map)
    dest.setLatLng(p)
  }
  if (from?.lat != null) {
    const p = [from.lat, from.lng]
    car ??= L.marker(p, { icon: icon('car', CAR), zIndexOffset: 1000 }).addTo(map)
    car.setLatLng(p)
    car.setOpacity(props.position ? 1 : 0.45)
  }
  if (car && dest) {
    line ??= L.polyline([], { color: '#e2362c', weight: 3, dashArray: '6 8', opacity: 0.8 }).addTo(map)
    line.setLatLngs([car.getLatLng(), dest.getLatLng()])
  }
  if (!framed && (car || dest)) {
    const pts = [car?.getLatLng(), dest?.getLatLng()].filter(Boolean)
    if (pts.length > 1) map.fitBounds(pts, { padding: [40, 40], maxZoom: 16 })
    else map.setView(pts[0], 15)
    framed = Boolean(props.position)
  }
}

onMounted(() => {
  map = L.map(el.value, { zoomControl: true, attributionControl: true }).setView([13.9126, 100.6068], 12)
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map)
  draw()
  ro = new ResizeObserver(() => map.invalidateSize())
  ro.observe(el.value)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  map?.remove()
})
watch(() => [props.position, props.destination], draw, { deep: true })
</script>

<template>
  <div ref="el" class="map" role="region" :aria-label="t('trackMap')" />
</template>

<style scoped>
.map {
  width: 100%;
  height: 300px;
  border-radius: 16px;
  overflow: hidden;
  background: #dfe3ea;
  isolation: isolate; /* keep Leaflet's z-indexes under the site header */
}
.map :deep(.car) {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 3px solid #fff;
  border-radius: 50%;
  background: #e2362c;
  color: #fff;
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.3);
}
.map :deep(.dest) {
  display: block;
  width: 28px;
  height: 28px;
  border: 3px solid #fff;
  border-radius: 50% 50% 50% 0;
  background: #121319;
  transform: rotate(-45deg);
  box-shadow: 0 4px 12px rgb(0 0 0 / 0.3);
}
</style>
