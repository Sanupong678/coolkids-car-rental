<script setup>
import { onMounted, ref } from 'vue'
import { getPromotions } from '@/api/catalogue'
import PromotionsSection from '@/components/home/PromotionsSection.vue'

const promotions = ref(null)
onMounted(async () => (promotions.value = await getPromotions().catch(() => [])))
</script>

<template>
  <main class="page">
    <PromotionsSection v-if="promotions?.length" :section="{ title: 'Current offers' }" :promotions="promotions" />
    <div v-else-if="promotions" class="container empty">
      <h1>No offers right now</h1>
      <p>New promotions are published regularly — check back soon.</p>
    </div>
  </main>
</template>

<style scoped>
.page {
  padding-top: 72px;
  min-height: 80dvh;
}
.empty {
  padding-block: var(--s-9);
  display: grid;
  gap: var(--s-3);
}
.empty p {
  color: var(--text-muted);
}
</style>
