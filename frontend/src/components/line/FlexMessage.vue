<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import FlexNode from './FlexNode.vue'

// A Flex Message container (bubble or carousel) the way the LINE app shows it.
// A carousel shows the edge of the next card and scrolls sideways: swipe on a
// phone; on a computer drag it, use the mouse wheel or the arrows (as LINE PC).
const props = defineProps({ contents: { type: Object, required: true } })
const emit = defineEmits(['action'])

const WIDTH = { nano: 120, micro: 160, deca: 220, hecto: 241, kilo: 260, mega: 300, giga: 386 }
const isCarousel = computed(() => props.contents.type === 'carousel')
const bubbles = computed(() => (isCarousel.value ? props.contents.contents : [props.contents]))

const track = ref(null)
const atStart = ref(true)
const atEnd = ref(false)
function update() {
  const t = track.value
  if (!t) return
  atStart.value = t.scrollLeft <= 2
  atEnd.value = t.scrollLeft + t.clientWidth >= t.scrollWidth - 2
}
function page(dir) {
  const t = track.value
  const card = t?.querySelector('.bubble')
  if (card) t.scrollBy({ left: dir * (card.offsetWidth + 8), behavior: 'smooth' })
}
// Vertical mouse wheel scrolls the carousel sideways (a trackpad already does).
function onWheel(e) {
  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || atStart.value && e.deltaY < 0 || atEnd.value && e.deltaY > 0) return
  e.preventDefault()
  track.value.scrollBy({ left: e.deltaY })
}
// Mouse drag (touch keeps the browser's own swipe).
let drag = null
let dragged = false
function onDown(e) {
  if (e.pointerType !== 'mouse' || e.button !== 0) return
  drag = { x: e.clientX, left: track.value.scrollLeft }
  dragged = false
}
function onMove(e) {
  if (!drag) return
  const dx = e.clientX - drag.x
  if (Math.abs(dx) > 4) {
    dragged = true
    track.value.classList.add('dragging')
  }
  track.value.scrollLeft = drag.left - dx
}
function onUp() {
  if (!drag) return
  drag = null
  track.value.classList.remove('dragging')
}
// A drag must not also press the button it ended on.
function onClickCapture(e) {
  if (dragged) {
    e.stopPropagation()
    e.preventDefault()
    dragged = false
  }
}
onMounted(() => nextTick(update))
</script>

<template>
  <div class="wrap">
    <div
      ref="track"
      class="flex"
      :class="{ carousel: isCarousel }"
      @scroll.passive="update"
      @wheel="isCarousel && onWheel($event)"
      @pointerdown="isCarousel && onDown($event)"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointerleave="onUp"
      @click.capture="onClickCapture"
    >
      <article v-for="(b, i) in bubbles" :key="i" class="bubble" :style="{ width: `${WIDTH[b.size ?? 'mega']}px` }">
        <FlexNode v-if="b.hero" :node="b.hero" @action="emit('action', $event)" />
        <div v-if="b.hero?.action" class="hero-hit" role="button" tabindex="0" aria-label="เปิด" @click="emit('action', b.hero.action)" @keydown.enter="emit('action', b.hero.action)" />
        <FlexNode v-if="b.body" class="sec body" :node="b.body" @action="emit('action', $event)" />
        <FlexNode v-if="b.footer" class="sec foot" :node="b.footer" @action="emit('action', $event)" />
      </article>
    </div>
    <template v-if="isCarousel && bubbles.length > 1">
      <button v-show="!atStart" type="button" class="nav prev" aria-label="คันก่อนหน้า" @click="page(-1)">‹</button>
      <button v-show="!atEnd" type="button" class="nav next" aria-label="คันถัดไป" @click="page(1)">›</button>
    </template>
  </div>
</template>

<style scoped>
.wrap {
  position: relative;
  min-width: 0;
}
.flex {
  display: flex;
  gap: 8px;
}
.carousel {
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  padding-right: 24px; /* the last card can scroll fully into view */
  scrollbar-width: none;
  cursor: grab;
  user-select: none;
}
.carousel::-webkit-scrollbar {
  display: none;
}
.carousel.dragging {
  scroll-snap-type: none;
  cursor: grabbing;
}
.carousel img {
  -webkit-user-drag: none;
}
.bubble {
  position: relative;
  flex: none;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 17px;
  background: #fff;
  scroll-snap-align: start;
}
.hero-hit {
  position: absolute;
  inset: 0 0 auto;
  aspect-ratio: 20 / 13;
  cursor: pointer;
}
.sec.body {
  flex: 1 1 auto;
  padding: 20px;
}
.sec.foot {
  padding: 0 10px 10px;
}
.nav {
  position: absolute;
  top: 40%;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 50%;
  background: rgb(0 0 0 / 0.45);
  color: #fff;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}
.nav:hover {
  background: rgb(0 0 0 / 0.65);
}
.prev {
  left: 4px;
}
.next {
  right: 4px;
}
@media (hover: none) {
  .nav {
    display: none; /* phones swipe, like the LINE app */
  }
}
</style>
