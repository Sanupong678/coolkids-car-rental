<script setup>
import { AREAS, SIZE } from './richMenu'

// The rich menu artwork, drawn in HTML so the same component is the demo's
// tappable menu and, rendered at 2500×1686, the PNG uploaded to LINE.
// Sizes use container units (cqw) so it scales from a phone to 2500 px.
const emit = defineEmits(['tap'])
const pct = (v, of) => `${(v / of) * 100}%`
const box = (b) => ({ left: pct(b.x, SIZE.width), top: pct(b.y, SIZE.height), width: pct(b.width, SIZE.width), height: pct(b.height, SIZE.height) })

// The shop's own artwork per tile (frontend/public/media/richmenu, from the owner's
// banners). style: navy = logo on the banner's navy · cover = picture fills the tile,
// label on top · bare = a finished poster, no label · dim = darkened photo behind the label.
const ART = {
  logo: { style: 'navy', img: '/media/richmenu/logo.jpg' },
  documents: { style: 'cover light', bg: '/media/richmenu/documents.jpg' },
  contact: { style: 'dim', bg: '/media/categories/suv.webp' },
  promotions: { style: 'bare', bg: '/media/richmenu/promotion.jpg' },
  cars: { style: 'cover shade', bg: '/media/richmenu/cars.jpg' },
}
const bgStyle = (key) => (ART[key]?.bg ? { '--bg': `url(${ART[key].bg})` } : {})

const COPY = {
  documents: ['กรอกเอกสาร', 'Documents'],
  contact: ['ติดต่อเรา', 'TikTok · Facebook'],
  promotions: ['โปรโมชั่น', 'Promotions'],
  cars: ['เลือกรถ', 'จองรถ · Book a car'],
}
</script>

<template>
  <nav class="rm" aria-label="เมนู LINE Official Account">
    <button v-for="a in AREAS" :key="a.key" type="button" class="area" :class="a.key" :style="box(a.bounds)" :aria-label="COPY[a.key]?.[0] ?? 'Coolkids Car Rental'" @click="emit('tap', a)">
      <span class="panel" :class="ART[a.key]?.style" :style="bgStyle(a.key)">
        <template v-if="a.key === 'logo'">
          <img class="logo-img" :src="ART.logo.img" alt="" />
          <span class="sub">รถเช่าขับเอง · ส่งรถถึงที่</span>
        </template>
        <template v-else-if="!ART[a.key]?.style?.includes('bare')">
          <span class="icon" aria-hidden="true">
            <svg v-if="a.key === 'documents'" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></svg>
            <svg v-else-if="a.key === 'contact'" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /><path d="M8 9h8M8 13h5" /></svg>
            <svg v-else-if="a.key === 'promotions'" viewBox="0 0 24 24"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" /><circle cx="7.5" cy="7.5" r="1.5" /></svg>
            <svg v-else viewBox="0 0 24 24"><path d="M5 17h14l-1.5-6.5A2 2 0 0 0 15.6 9H8.4a2 2 0 0 0-1.9 1.5Z" /><circle cx="7.5" cy="17.5" r="1.5" /><circle cx="16.5" cy="17.5" r="1.5" /></svg>
          </span>
          <span class="label">{{ COPY[a.key][0] }}</span>
          <span class="en">{{ COPY[a.key][1] }}</span>
        </template>
      </span>
    </button>
  </nav>
</template>

<style scoped>
.rm {
  position: relative;
  width: 100%;
  aspect-ratio: 2500 / 1686;
  container-type: inline-size;
  background: #0f1015;
  font-family: 'Inter', 'Noto Sans Thai', system-ui, sans-serif;
}
.area {
  position: absolute;
  padding: 0.6cqw;
  border: 0;
  background: none;
  color: #fff;
  cursor: pointer;
}
.area:focus-visible {
  outline: 3px solid #06c755;
  outline-offset: -3px;
}
.panel {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 0.8cqw;
  width: 100%;
  height: 100%;
  border-radius: 2.2cqw;
  background: linear-gradient(160deg, #23252f, #17181f);
  box-shadow: inset 0 0 0 0.12cqw rgb(255 255 255 / 0.08);
}
.panel {
  position: relative;
  overflow: hidden;
  isolation: isolate;
}
.area:active .panel {
  filter: brightness(1.25);
}
.logo .panel {
  align-items: flex-start;
  padding-left: 6cqw;
  gap: 0.4cqw;
}
.mark {
  width: 9cqw;
  color: #e2362c;
}
.word {
  font-size: 8.4cqw;
  font-weight: 900;
  letter-spacing: 0.02em;
  line-height: 1;
}
.tag {
  font-size: 1.9cqw;
  font-weight: 600;
  letter-spacing: 0.32em;
  color: #ff8a82;
}
.sub {
  margin-top: 1.2cqw;
  font-size: 2.6cqw;
  color: rgb(255 255 255 / 0.75);
}
.icon {
  display: grid;
  place-items: center;
  width: 9cqw;
  height: 9cqw;
  border-radius: 50%;
  background: rgb(255 255 255 / 0.08);
}
.icon svg {
  width: 5cqw;
  height: 5cqw;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.label {
  font-size: 4.2cqw;
  font-weight: 800;
}
.en {
  font-size: 1.9cqw;
  color: rgb(255 255 255 / 0.65);
}
.cars .panel {
  background: linear-gradient(160deg, #f0473c, #c4271e);
  box-shadow: none;
}
.cars .icon {
  display: none;
}
.cars .icon {
  background: rgb(255 255 255 / 0.2);
}
.cars .en {
  color: rgb(255 255 255 / 0.85);
}
/* ---- the owner's artwork */
.panel.navy {
  align-items: center;
  padding-left: 0;
  gap: 1.6cqw;
  background: #2c2f40;
}
.logo-img {
  width: 40cqw;
}
.navy .sub {
  margin-top: 0;
  color: rgb(255 255 255 / 0.8);
}
.panel.dim {
  background:
    linear-gradient(180deg, rgb(10 11 16 / 0.35), rgb(10 11 16 / 0.82)),
    var(--bg) center / cover no-repeat;
}
.panel.cover,
.panel.bare {
  justify-content: flex-end;
  padding-bottom: 2.6cqw;
  background: var(--bg) center / cover no-repeat;
  box-shadow: none;
}
.panel.cover .icon {
  display: none;
}
.panel.shade {
  background:
    linear-gradient(180deg, transparent 50%, rgb(10 11 16 / 0.88)),
    var(--bg) center / cover no-repeat;
}
.panel.light .label {
  color: #1d1f27;
}
.panel.light .en {
  color: rgb(29 31 39 / 0.6);
}
/* documents: the folder sits higher and smaller so the label has its own space */
.documents .panel.cover {
  background: #f7f8fa var(--bg) center 18% / 78% auto no-repeat;
}
/* cars: label on the dark wall above the car */
.cars .panel.shade {
  justify-content: flex-start;
  padding: 1.8cqw 0 0;
  background:
    linear-gradient(0deg, transparent 55%, rgb(10 11 16 / 0.7)),
    #2d3036 var(--bg) center top / 112% auto no-repeat;
}
</style>
