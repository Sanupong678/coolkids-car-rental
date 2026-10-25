<script setup>
import { RouterLink, useRoute } from 'vue-router'
import { t } from '@/i18n'

const route = useRoute()
</script>

<template>
  <main class="container placeholder">
    <span class="eyebrow">{{ route.meta.phase }}</span>
    <h1>{{ route.meta.phase === '404' ? t('page.notFound') : route.meta.title }}</h1>
    <p>{{ t('page.notFoundBody') }}</p>
    <RouterLink to="/" class="btn btn-primary btn-pill">{{ t('page.home') }}</RouterLink>
  </main>
</template>

<style scoped>
.placeholder {
  min-height: 100dvh;
  display: grid;
  align-content: center;
  gap: var(--s-4);
}
h1 {
  font-size: var(--fs-2xl);
}
p {
  color: var(--text-muted);
}
</style>
