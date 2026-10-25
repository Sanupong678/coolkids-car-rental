<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { ambientTargets } from '@/composables/ambient'

// Page-wide ambient light for the homepage: a fixed layer behind every section,
// tinted with the hero video's sampled colour (--amb) and lit by a heavily
// blurred copy of its current frame. Sections are transparent, so this light
// runs unbroken from the hero to the footer.
const canvas = ref(null)
onMounted(() => ambientTargets.add(canvas.value))
onBeforeUnmount(() => ambientTargets.delete(canvas.value))
</script>

<template>
  <div class="ambient" aria-hidden="true">
    <canvas ref="canvas" width="48" height="27" />
    <span class="lights" />
  </div>
</template>

<style scoped>
.ambient {
  position: fixed;
  inset: 0;
  z-index: -1;
  overflow: hidden;
  background: var(--amb, #141517);
  pointer-events: none;
}
canvas {
  position: absolute;
  inset: -20%;
  width: 140%;
  height: 140%;
  filter: blur(90px) saturate(1.5);
  opacity: 0.7;
}
/* two soft pools of light that drift very slowly, so the page never feels flat */
.lights {
  position: absolute;
  inset: -30%;
  background:
    radial-gradient(40% 35% at 25% 30%, rgb(255 255 255 / 0.07), transparent 70%),
    radial-gradient(35% 30% at 78% 70%, rgb(226 54 44 / 0.06), transparent 70%);
  animation: drift 28s ease-in-out infinite alternate;
}
@keyframes drift {
  to {
    transform: translate3d(6%, -4%, 0) rotate(8deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .lights {
    animation: none;
  }
}
</style>
