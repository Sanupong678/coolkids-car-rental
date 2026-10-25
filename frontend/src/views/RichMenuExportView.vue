<script setup>
import RichMenu from '@/components/line/RichMenu.vue'

// The rich menu alone, edge to edge: open at a 2500×1686 window (or let
// `npm run line:richmenu` do it) to get the PNG uploaded to LINE.
</script>

<template>
  <div class="export"><RichMenu /></div>
</template>

<style>
/* the dev server's Vue DevTools button must not end up in the exported image */
#__vue-devtools-container__,
.vue-devtools__anchor {
  display: none !important;
}
</style>

<style scoped>
.export {
  width: 100vw;
  background: #0f1015;
}
</style>
