<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useI18n } from '@/i18n'
import Icon from '@/components/ui/Icon.vue'

// Sign-in popup shown before a guest can pick a car (and from the header).
// Native modal <dialog>: focus trap + inert page for free; Esc / backdrop close it.
// Layout: logo → Sign in / Sign up tabs → form → social providers (Google, Facebook, LINE).
const auth = useAuthStore()
const { t, errorText } = useI18n()
const router = useRouter()
const dialog = ref(null)

const creds = ref({ login: '', password: '' })
const showPassword = ref(false)
const showForgot = ref(false)
const form = ref({ fullName: '', email: '', phone: '', password: '' })
const submitting = ref(false)
const error = ref('')

const emailValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.value.email))
const canRegister = computed(
  () => auth.registerEnabled && form.value.fullName.trim() && emailValid.value && form.value.password.length >= 8 && !submitting.value,
)

watch(
  () => auth.loginOpen,
  async (open) => {
    await nextTick()
    if (open && !dialog.value?.open) {
      error.value = auth.loginNotice
      auth.loginNotice = ''
      showForgot.value = false
      dialog.value?.showModal()
    } else if (!open && dialog.value?.open) dialog.value.close()
  },
  { immediate: true },
)

function onBackdrop(e) {
  if (e.target === dialog.value) auth.closeLogin()
}

function switchView(view) {
  auth.loginView = view
  error.value = ''
}

// Runs a sign-in action, then continues to wherever the popup was opened for.
async function run(action) {
  submitting.value = true
  error.value = ''
  try {
    await action()
    const to = auth.loginReturnTo
    creds.value.password = ''
    form.value.password = ''
    if (to) router.push(to)
    else if (auth.isStaff) router.push('/admin')
  } catch (err) {
    error.value = errorText(err, err.details?.password?.[0])
  } finally {
    submitting.value = false
  }
}

const canLogin = computed(() => creds.value.login.trim() && creds.value.password && !submitting.value)
const login = () => canLogin.value && run(() => auth.loginWithPassword(creds.value.login.trim(), creds.value.password))
const register = () => canRegister.value && run(() => auth.register(form.value))

const providers = computed(() => [
  { key: 'google', label: 'auth.google', enabled: auth.googleEnabled, go: auth.signInWithGoogle },
  { key: 'facebook', label: 'auth.facebook', enabled: auth.facebookEnabled, go: auth.signInWithFacebook },
  { key: 'line', label: 'auth.line', enabled: auth.lineEnabled, go: auth.signInWithLine },
])
</script>

<template>
  <dialog ref="dialog" class="login" aria-labelledby="login-title" @close="auth.closeLogin()" @click="onBackdrop">
    <div class="panel">
      <button type="button" class="x" :aria-label="t('common.close')" @click="auth.closeLogin()">
        <Icon name="x" :size="16" />
      </button>

      <img class="logo" src="/brand/logo-light.webp" alt="Coolkids Car Rental" width="180" height="58" />
      <h2 id="login-title" class="sr-only">{{ t(auth.loginView === 'signin' ? 'auth.signin' : 'auth.register') }}</h2>

      <div class="tabs" role="tablist" :aria-label="t('auth.tabs')">
        <button type="button" role="tab" :aria-selected="auth.loginView === 'signin'" @click="switchView('signin')">{{ t('auth.signin') }}</button>
        <button type="button" role="tab" :aria-selected="auth.loginView === 'register'" @click="switchView('register')">{{ t('auth.register') }}</button>
        <span class="ink" :class="{ right: auth.loginView === 'register' }" aria-hidden="true" />
      </div>

      <Transition name="swap" mode="out-in">
        <!-- Sign in -->
        <form v-if="auth.loginView === 'signin'" key="signin" class="view" novalidate @submit.prevent="login">
          <label class="field">
            <span>{{ t('auth.login') }}</span>
            <span class="box">
              <Icon name="mail" :size="16" class="lead" />
              <input v-model="creds.login" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required placeholder="you@example.com" />
            </span>
          </label>
          <label class="field">
            <span>{{ t('auth.password') }}</span>
            <span class="box">
              <Icon name="lock" :size="16" class="lead" />
              <input v-model="creds.password" :type="showPassword ? 'text' : 'password'" autocomplete="current-password" required placeholder="••••••••" />
              <button type="button" class="eye" :aria-label="t(showPassword ? 'auth.hide' : 'auth.show')" :aria-pressed="showPassword" @click="showPassword = !showPassword">
                <Icon :name="showPassword ? 'eye-off' : 'eye'" :size="16" />
              </button>
            </span>
          </label>
          <button type="button" class="forgot" :aria-expanded="showForgot" @click="showForgot = !showForgot">{{ t('auth.forgot') }}</button>
          <p v-if="showForgot" class="note">{{ t('auth.forgotNote', { line: '@Coolkidscar' }) }}</p>
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <button type="submit" class="primary" :disabled="!canLogin">
            <span v-if="!submitting">{{ t('auth.signin') }}</span>
            <span v-else class="spinner" :aria-label="t('auth.signingIn')" />
          </button>
        </form>

        <!-- Register -->
        <form v-else key="register" class="view" novalidate @submit.prevent="register">
          <label class="field">
            <span>{{ t('auth.fullName') }}</span>
            <span class="box">
              <Icon name="user" :size="16" class="lead" />
              <input v-model="form.fullName" type="text" autocomplete="name" required :placeholder="t('auth.fullNamePh')" />
            </span>
          </label>
          <label class="field">
            <span>{{ t('auth.email') }}</span>
            <span class="box">
              <Icon name="mail" :size="16" class="lead" />
              <input v-model="form.email" type="email" autocomplete="email" required placeholder="you@example.com" :aria-invalid="form.email !== '' && !emailValid" />
            </span>
          </label>
          <label class="field">
            <span>{{ t('auth.phone') }} <small>({{ t('common.optional') }})</small></span>
            <span class="box">
              <Icon name="phone" :size="16" class="lead" />
              <input v-model="form.phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="08x-xxx-xxxx" />
            </span>
          </label>
          <label class="field">
            <span>{{ t('auth.password') }}</span>
            <span class="box">
              <Icon name="lock" :size="16" class="lead" />
              <input v-model="form.password" :type="showPassword ? 'text' : 'password'" autocomplete="new-password" minlength="8" required :placeholder="t('auth.passwordPh')" />
              <button type="button" class="eye" :aria-label="t(showPassword ? 'auth.hide' : 'auth.show')" :aria-pressed="showPassword" @click="showPassword = !showPassword">
                <Icon :name="showPassword ? 'eye-off' : 'eye'" :size="16" />
              </button>
            </span>
          </label>
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <button type="submit" class="primary" :disabled="!canRegister">
            <span v-if="!submitting">{{ t('auth.create') }}</span>
            <span v-else class="spinner" :aria-label="t('auth.saving')" />
          </button>
        </form>
      </Transition>

      <div class="or"><span>{{ t('auth.or') }}</span></div>

      <div class="providers">
        <button
          v-for="p in providers"
          :key="p.key"
          type="button"
          class="provider"
          :disabled="!p.enabled"
          :title="p.enabled ? undefined : t('auth.notSetUp')"
          @click="p.go()"
        >
          <svg v-if="p.key === 'google'" viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z" />
            <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.3-.4-3.5z" />
          </svg>
          <svg v-else-if="p.key === 'facebook'" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path fill="#1877F2" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z" />
            <path fill="#fff" d="m16.67 15.56.53-3.49h-3.33V9.82c0-.96.47-1.89 1.96-1.89h1.51V4.96s-1.37-.24-2.68-.24c-2.74 0-4.53 1.67-4.53 4.69v2.66H7.08v3.49h3.05V24a12.2 12.2 0 0 0 3.74 0v-8.44z" />
          </svg>
          <svg v-else viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <rect width="24" height="24" rx="5.5" fill="#06C755" />
            <path
              fill="#fff"
              d="M19.9 11.1c0-3.6-3.6-6.5-8-6.5s-8 2.9-8 6.5c0 3.2 2.9 5.9 6.7 6.4.3.1.6.2.7.4.1.2.1.5 0 .7l-.1.7c0 .2-.2.8.7.4.9-.4 4.8-2.8 6.5-4.8 1.1-1.3 1.5-2.5 1.5-3.8zm-11 2h-1.6c-.2 0-.4-.2-.4-.4V9.6c0-.2.2-.4.4-.4s.4.2.4.4v2.7h1.2c.2 0 .4.2.4.4s-.2.4-.4.4zm1.6-.4c0 .2-.2.4-.4.4s-.4-.2-.4-.4V9.6c0-.2.2-.4.4-.4s.4.2.4.4zm3.8 0c0 .2-.1.3-.3.4h-.1c-.1 0-.3-.1-.3-.2l-1.6-2.2v1.9c0 .2-.2.4-.4.4s-.4-.2-.4-.4V9.6c0-.2.1-.3.3-.4h.1c.1 0 .3.1.3.2l1.6 2.2V9.6c0-.2.2-.4.4-.4s.4.2.4.4zm2.6-2c.2 0 .4.2.4.4s-.2.4-.4.4h-1.2v.7h1.2c.2 0 .4.2.4.4s-.2.4-.4.4h-1.6c-.2 0-.4-.2-.4-.4V9.6c0-.2.2-.4.4-.4h1.6c.2 0 .4.2.4.4s-.2.4-.4.4h-1.2v.7z"
            />
          </svg>
          <span>{{ t(p.label) }}</span>
        </button>
      </div>

      <p class="fine">
        <template v-if="auth.loginView === 'signin'">
          {{ t('auth.noAccount') }} <button type="button" class="link" @click="switchView('register')">{{ t('auth.register') }}</button>
        </template>
        <template v-else>
          {{ t('auth.haveAccount') }} <button type="button" class="link" @click="switchView('signin')">{{ t('auth.signin') }}</button>
        </template>
      </p>
    </div>
  </dialog>
</template>

<style scoped>
/* Frosted-glass card over the blurred page (reference: "Sign In / Sign Up" mock). */
.login {
  --text: #f4f3ef;
  --text-muted: rgb(244 243 239 / 0.62);
  --line: rgb(255 255 255 / 0.12);
  --line-strong: rgb(255 255 255 / 0.2);
  --field: rgb(255 255 255 / 0.06);
  --cream: #ece7dc;
  --focus-ring: 0 0 0 2px rgb(10 12 20), 0 0 0 4px var(--cream);
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--text);
  width: 100%;
  max-width: min(400px, calc(100vw - 2rem));
  max-height: calc(100dvh - 2rem);
  overflow: auto;
  color-scheme: dark;
  scrollbar-width: none;
}
.login::backdrop {
  background: rgb(6 8 16 / 0.55);
  -webkit-backdrop-filter: blur(14px) saturate(120%);
  backdrop-filter: blur(14px) saturate(120%);
  animation: fade var(--dur-slow) var(--ease-out);
}
.panel {
  position: relative;
  display: grid;
  gap: 16px;
  padding: 28px clamp(20px, 5vw, 28px) 24px;
  border: 1px solid var(--line-strong);
  border-radius: 22px;
  background:
    radial-gradient(120% 70% at 50% 0%, rgb(255 255 255 / 0.1), transparent 60%),
    linear-gradient(160deg, rgb(26 30 44 / 0.72), rgb(12 15 26 / 0.78));
  -webkit-backdrop-filter: blur(28px) saturate(150%);
  backdrop-filter: blur(28px) saturate(150%);
  box-shadow:
    0 30px 80px -30px rgb(0 0 0 / 0.75),
    inset 0 1px 0 rgb(255 255 255 / 0.12);
  animation: rise var(--dur-slow) var(--ease-out);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
.logo {
  justify-self: center;
  width: 150px;
  height: auto;
  margin-bottom: 4px;
}
.x {
  position: absolute;
  top: 14px;
  right: 14px;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
}
.x:hover {
  color: var(--text);
  border-color: var(--line-strong);
}
.tabs {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-bottom: 1px solid var(--line);
}
.tabs button {
  padding: 10px 0 12px;
  border: 0;
  background: none;
  color: var(--text-muted);
  font: inherit;
  font-size: 0.98rem;
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-out);
}
.tabs button[aria-selected='true'] {
  color: var(--text);
  font-weight: 500;
}
.ink {
  position: absolute;
  bottom: -1px;
  left: 0;
  width: 50%;
  height: 2px;
  border-radius: 2px;
  background: var(--cream);
  transition: transform var(--dur-base) var(--ease-out);
}
.ink.right {
  transform: translateX(100%);
}
.view {
  display: grid;
  gap: 14px;
}
.field {
  display: grid;
  gap: 7px;
  font-size: 0.86rem;
  color: var(--text);
}
.field small {
  color: var(--text-muted);
}
.box {
  position: relative;
  display: block;
}
.lead {
  position: absolute;
  top: 50%;
  left: 14px;
  transform: translateY(-50%);
  color: var(--text-muted);
  pointer-events: none;
}
.box input {
  width: 100%;
  height: 46px;
  padding: 0 44px 0 42px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--field);
  color: var(--text);
  font-size: 0.95rem;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out);
}
.box input::placeholder {
  color: rgb(255 255 255 / 0.32);
}
.box input:focus-visible {
  outline: none;
  border-color: rgb(236 231 220 / 0.6);
  background: rgb(255 255 255 / 0.09);
}
.box input[aria-invalid='true'] {
  border-color: var(--danger);
}
.eye {
  position: absolute;
  top: 50%;
  right: 6px;
  transform: translateY(-50%);
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 0;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
}
.eye[aria-pressed='true'] {
  color: var(--text);
}
.forgot {
  justify-self: end;
  margin-top: -6px;
  border: 0;
  background: none;
  padding: 0;
  color: var(--text-muted);
  font-size: 0.78rem;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}
.forgot:hover {
  color: var(--text);
}
.note {
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: rgb(255 255 255 / 0.05);
  color: var(--text-muted);
  font-size: 0.8rem;
}
.note b {
  color: #06c755;
}
.primary {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 48px;
  margin-top: 4px;
  border: 0;
  border-radius: 12px;
  background: var(--cream);
  color: #1b1d24;
  font-weight: 600;
  font-size: 0.98rem;
  cursor: pointer;
  transition:
    filter var(--dur-fast) var(--ease-out),
    opacity var(--dur-fast) var(--ease-out);
}
.primary:hover:not(:disabled) {
  filter: brightness(1.05);
}
.primary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.or {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--text-muted);
  font-size: 0.78rem;
}
.or::before,
.or::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--line);
}
.providers {
  display: grid;
  gap: 10px;
}
.provider {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 46px;
  border: 1px solid var(--line-strong);
  border-radius: 12px;
  background: rgb(255 255 255 / 0.03);
  color: var(--text);
  font: inherit;
  font-size: 0.9rem;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}
.provider:hover:not(:disabled) {
  background: rgb(255 255 255 / 0.09);
  border-color: rgb(255 255 255 / 0.32);
}
.provider:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.provider:focus-visible,
.primary:focus-visible,
.tabs button:focus-visible,
.x:focus-visible,
.link:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
  border-radius: 10px;
}
.error {
  color: #ff8a82;
  font-size: 0.84rem;
}
.fine {
  text-align: center;
  font-size: 0.86rem;
  color: var(--text-muted);
}
.link {
  margin-left: 6px;
  border: 0;
  background: none;
  padding: 0;
  color: var(--text);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid rgb(0 0 0 / 0.2);
  border-top-color: #1b1d24;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.swap-enter-active,
.swap-leave-active {
  transition:
    opacity var(--dur-base) var(--ease-out),
    transform var(--dur-base) var(--ease-out);
}
.swap-enter-from {
  opacity: 0;
  transform: translateX(12px);
}
.swap-leave-to {
  opacity: 0;
  transform: translateX(-12px);
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.98);
  }
}
@keyframes fade {
  from {
    opacity: 0;
  }
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
