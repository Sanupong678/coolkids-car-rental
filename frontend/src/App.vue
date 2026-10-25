<script setup>
import { onMounted } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useSiteStore } from '@/stores/site'
import AppHeader from '@/components/layout/AppHeader.vue'
import AppFooter from '@/components/layout/AppFooter.vue'
import OnboardingModal from '@/components/auth/OnboardingModal.vue'
import LoginModal from '@/components/auth/LoginModal.vue'

const auth = useAuthStore()
const site = useSiteStore()
const route = useRoute() // `meta.bare` pages (print views) render without the site chrome
onMounted(() => site.load())
</script>

<template>
  <AppHeader v-if="!route.meta.bare" />
  <RouterView v-slot="{ Component, route }">
    <Transition name="page" mode="out-in">
      <component :is="Component" :key="route.name === 'vehicles' ? 'vehicles' : route.path" />
    </Transition>
  </RouterView>
  <AppFooter v-if="!route.meta.bare" />
  <!-- Blocking until the first-login profile is complete (spec 1.1). -->
  <OnboardingModal v-if="auth.needsOnboarding" />
  <LoginModal />
</template>
