<script setup>
import { useAuthStore } from '@/stores/auth'

defineProps({ compact: Boolean })
const auth = useAuthStore()
</script>

<template>
  <button
    type="button"
    class="google-btn"
    :class="{ compact }"
    :disabled="!auth.googleEnabled"
    :title="auth.googleEnabled ? undefined : 'Google sign-in is not configured on this server'"
    @click="auth.signInWithGoogle()"
  >
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"/>
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.3-.4-3.5z"/>
    </svg>
    <span>{{ compact ? 'Sign in' : 'Continue with Google' }}</span>
  </button>
</template>

<style scoped>
.google-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--s-3);
  padding: 0.7rem 1.25rem;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-pill);
  background: var(--c-ink-50);
  color: var(--text-inverse);
  font-weight: 500;
  font-size: var(--fs-sm);
  cursor: pointer;
  transition:
    transform var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out);
}
.google-btn.compact {
  padding: 0.5rem 1rem;
}
.google-btn:hover:not(:disabled) {
  background: #fff;
  transform: translateY(-1px);
}
.google-btn:active:not(:disabled) {
  transform: translateY(0);
}
.google-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
