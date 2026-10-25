<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { distanceKm, fmtKm } from '@/utils/geo'

// Day map: numbered customer drop-off points (delivered ones fade out), every
// driver's last-known position, and a dashed line from each driver to the
// selected job with its straight-line distance. Basemap: OpenStreetMap tiles,
// darkened with a CSS filter to sit on the glass theme. Routing/ETA will come
// from the maps skill.
const props = defineProps({
  jobs: { type: Array, default: () => [] },
  staff: { type: Array, default: () => [] },
  selectedId: { type: String, default: null },
})
const emit = defineEmits(['select'])

const el = ref(null)
let map
let layer
let ro

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const initials = (name) =>
  String(name ?? '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
const clock = (iso) => new Date(iso).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })

function draw(fit) {
  if (!map) return
  layer.clearLayers()
  const bounds = []
  const target = props.jobs.find((j) => j.id === props.selectedId)
  const dest = target?.destination

  props.jobs.forEach((j, i) => {
    const d = j.destination
    if (d?.lat == null) return
    const cls = ['pin', j.delivered && 'done', j.id === props.selectedId && 'sel', j.fulfillment !== 'DELIVERY' && 'branch'].filter(Boolean).join(' ')
    const m = L.marker([d.lat, d.lng], {
      icon: L.divIcon({ className: '', html: `<span class="${cls}"><b>${i + 1}</b></span>`, iconSize: [30, 38], iconAnchor: [15, 36] }),
      zIndexOffset: j.id === props.selectedId ? 1000 : 0,
    })
      .bindTooltip(`<strong>${clock(j.pickupAt)} · ${esc(j.vehicle.plate)}</strong><br>${esc(j.customer.fullName ?? '')}<br>${esc(d.address ?? '')}`, {
        direction: 'top',
        offset: [0, -34],
      })
      .on('click', () => emit('select', j.id))
    m.addTo(layer)
    bounds.push([d.lat, d.lng])
  })

  for (const s of props.staff) {
    if (!s.location) continue
    const p = [s.location.lat, s.location.lng]
    const km = dest ? distanceKm(s.location, dest) : null
    const busy = s.onTheRoad ? 'road' : s.jobs.length ? 'busy' : 'free'
    L.marker(p, {
      icon: L.divIcon({
        className: '',
        html: `<span class="drv ${busy}">${esc(initials(s.name))}</span>${km != null ? `<span class="dist">${fmtKm(km)}</span>` : ''}`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      }),
    })
      .bindTooltip(`<strong>${esc(s.name)}</strong><br>${s.onTheRoad ? 'กำลังส่งรถ' : s.jobs.length ? `มีงาน ${s.jobs.length} งาน` : 'ว่าง'}`, { direction: 'top', offset: [0, -16] })
      .addTo(layer)
    if (dest?.lat != null) {
      L.polyline([p, [dest.lat, dest.lng]], { color: busy === 'free' ? '#5fd39a' : '#9aa3b8', weight: 2, dashArray: '6 6', opacity: 0.85 }).addTo(layer)
    }
    bounds.push(p)
  }

  // Selected job: frame it together with the drivers so the distances read at a glance.
  if (fit && bounds.length) {
    const focus = dest?.lat != null ? [[dest.lat, dest.lng], ...props.staff.filter((s) => s.location).map((s) => [s.location.lat, s.location.lng])] : bounds
    map.fitBounds(focus, { padding: [48, 48], maxZoom: 14 })
  }
}

onMounted(() => {
  map = L.map(el.value, { zoomControl: true, attributionControl: true }).setView([13.9126, 100.6068], 11)
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map)
  layer = L.layerGroup().addTo(map)
  draw(true)
  // The panel settles its height after mount (and on resize): let Leaflet fetch the missing tiles.
  ro = new ResizeObserver(() => map.invalidateSize())
  ro.observe(el.value)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  map?.remove()
})

watch(() => props.selectedId, () => draw(true))
watch(() => [props.jobs, props.staff], () => draw(false), { deep: true })
</script>

<template>
  <div ref="el" class="map" role="region" aria-label="แผนที่จุดส่งรถและตำแหน่งพนักงาน" />
</template>

<style scoped>
.map {
  width: 100%;
  height: 100%;
  min-height: 380px;
  border-radius: 16px;
  overflow: hidden;
  background: #0e1426;
}
.map :deep(.leaflet-tile-pane) {
  filter: invert(1) hue-rotate(180deg) brightness(0.85) contrast(0.9) saturate(0.6);
}
.map :deep(.leaflet-control-attribution) {
  background: rgb(10 14 28 / 0.7);
  color: rgb(255 255 255 / 0.6);
}
.map :deep(.leaflet-control-attribution a) {
  color: rgb(255 255 255 / 0.8);
}
.map :deep(.leaflet-bar a) {
  background: rgb(20 25 42 / 0.9);
  color: #fff;
  border-color: rgb(255 255 255 / 0.12);
}
.map :deep(.leaflet-tooltip) {
  border: 0;
  border-radius: 10px;
  background: #f2f3f7;
  color: #121319;
  font-size: 0.78rem;
  box-shadow: 0 8px 24px -8px rgb(0 0 0 / 0.6);
}
.map :deep(.pin) {
  position: relative;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 2px solid #fff;
  border-radius: 50% 50% 50% 0;
  background: #e2362c;
  transform: rotate(-45deg);
  box-shadow: 0 6px 14px -4px rgb(0 0 0 / 0.6);
}
.map :deep(.pin b) {
  transform: rotate(45deg);
  color: #fff;
  font-size: 0.75rem;
}
.map :deep(.pin.branch) {
  background: #2a78d6;
}
.map :deep(.pin.done) {
  background: #4b5363;
  opacity: 0.6;
}
.map :deep(.pin.sel) {
  width: 36px;
  height: 36px;
  box-shadow:
    0 0 0 6px rgb(226 54 44 / 0.3),
    0 6px 14px -4px rgb(0 0 0 / 0.6);
}
.map :deep(.drv) {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 2px solid #fff;
  border-radius: 50%;
  background: #2f8f62;
  color: #fff;
  font-size: 0.72rem;
  font-weight: 700;
  box-shadow: 0 6px 14px -4px rgb(0 0 0 / 0.6);
}
.map :deep(.drv.busy) {
  background: #9a6a1c;
}
.map :deep(.drv.road) {
  background: #2a64c4;
}
.map :deep(.dist) {
  position: absolute;
  top: 36px;
  left: 50%;
  transform: translateX(-50%);
  padding: 1px 6px;
  border-radius: 999px;
  background: rgb(10 14 28 / 0.85);
  color: #fff;
  font-size: 0.68rem;
  white-space: nowrap;
}
</style>
