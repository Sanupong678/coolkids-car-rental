<script setup>
import { AREAS, SIZE } from './richMenu'

// The rich menu artwork, drawn in HTML so the same component is the demo's
// tappable menu and, rendered at 2500×1686, the PNG uploaded to LINE.
// Each area shows the shop's finished artwork (frontend/public/media/richmenu,
// text already designed in): the cover across the top, three tiles below,
// split by thin light lines like the owner's reference design.
const emit = defineEmits(['tap'])
const pct = (v, of) => `${(v / of) * 100}%`
const box = (b) => ({ left: pct(b.x, SIZE.width), top: pct(b.y, SIZE.height), width: pct(b.width, SIZE.width), height: pct(b.height, SIZE.height) })

const ART = {
  cover: { img: '/media/richmenu/cover.jpg', label: 'Coolkids Car Rental' },
  cars: { img: '/media/richmenu/choose-car.jpg', label: 'เลือกรถที่ใช่' },
  contact: { img: '/media/richmenu/contact.jpg', label: 'ติดต่อเรา' },
  bookings: { img: '/media/richmenu/booking.jpg', label: 'การจองของฉัน' },
}
</script>

<template>
  <nav class="rm" aria-label="เมนู LINE Official Account">
    <button v-for="a in AREAS" :key="a.key" type="button" class="area" :class="a.key" :style="box(a.bounds)" :aria-label="ART[a.key].label" @click="emit('tap', a)">
      <img :src="ART[a.key].img" alt="" draggable="false" />
    </button>
  </nav>
</template>

<style scoped>
.rm {
  position: relative;
  width: 100%;
  min-width: 0;
  aspect-ratio: 2500 / 1686;
  container-type: inline-size;
  overflow: hidden;
  background: #0f1015;
}
.area {
  position: absolute;
  padding: 0;
  border: 0;
  background: none;
  overflow: hidden;
  cursor: pointer;
}
/* absolutely placed so the 2500 px artwork never sets the menu's width */
.area img {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
/* thin light dividers between the tiles and under the cover */
.area:not(.cover)::before,
.area.contact::after,
.area.bookings::after {
  content: '';
  position: absolute;
  background: rgb(255 255 255 / 0.55);
  pointer-events: none;
}
.area:not(.cover)::before {
  inset: 0 0 auto;
  height: max(1px, 0.12cqw);
}
.area.contact::after,
.area.bookings::after {
  inset: 0 auto 0 0;
  width: max(1px, 0.12cqw);
}
.area:focus-visible {
  outline: 3px solid #06c755;
  outline-offset: -3px;
}
</style>
