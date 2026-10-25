import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { t } from '@/i18n'
import { api, ApiError, googleSignInUrl, oauthSignInUrl } from '@/api/http'
import { inLiffContext, liffReady, liffSignIn } from '@/utils/liff'

export const useAuthStore = defineStore('auth', () => {
  const me = ref(null)
  const ready = ref(false) // first /me resolved (signed in or not)
  const googleEnabled = ref(true)
  const facebookEnabled = ref(false) // flips on once the API reports the provider
  const lineEnabled = ref(false)
  const registerEnabled = ref(true) // email + password sign-up

  // Sign-in popup. `loginReturnTo` is where the user lands after OAuth.
  const loginOpen = ref(false)
  const loginView = ref('signin') // 'signin' | 'register'
  const loginReturnTo = ref(null)
  const loginNotice = ref('') // shown once in the popup, e.g. after the session expired

  const isSignedIn = computed(() => Boolean(me.value))
  const needsOnboarding = computed(() => Boolean(me.value?.needsOnboarding))
  const isStaff = computed(() => Boolean(me.value?.isStaff))
  const can = (permission) => Boolean(me.value?.permissions.includes(permission))

  async function load() {
    const providers = api('/auth/providers').catch(() => null)
    try {
      me.value = (await api('/me')).data
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) console.error(err)
      me.value = null
    }
    try {
      // Opened inside LINE (rich menu → LIFF): sign in with that LINE account.
      const liffId = (await providers)?.data.liffId
      if (liffId && inLiffContext()) {
        await liffReady(liffId)
        if (!me.value && (await liffSignIn(liffId))) me.value = (await api('/me')).data
      }
    } catch (err) {
      console.warn(err)
    } finally {
      const p = await providers
      if (p) {
        googleEnabled.value = Boolean(p.data.google)
        facebookEnabled.value = Boolean(p.data.facebook)
        lineEnabled.value = Boolean(p.data.line)
        registerEnabled.value = p.data.password !== false
      }
      ready.value = true
      announce()
    }
  }

  // The session cookie is shared by every tab of the browser, so signing in as
  // someone else in one tab switches all of them. Tabs tell each other which
  // account they now hold; a tab still showing another account reloads instead
  // of acting as the wrong user.
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('coolkids-auth') : null
  const currentId = () => me.value?.id ?? null
  function announce() {
    channel?.postMessage({ userId: currentId() })
  }
  channel?.addEventListener('message', ({ data }) => {
    if (ready.value && data?.userId !== currentId()) window.location.reload()
  })
  // Fallback for changes made elsewhere (another window, expiry while hidden).
  let lastCheck = 0
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !ready.value || Date.now() - lastCheck < 30_000) return
    lastCheck = Date.now()
    const before = currentId()
    const now = await api('/me').then((r) => r.data.id, (err) => (err instanceof ApiError && err.status === 401 ? null : before))
    if (now !== currentId()) window.location.reload() // expiry already signed this tab out → no reload
  })

  window.addEventListener('auth:expired', () => {
    if (!me.value) return
    me.value = null
    announce()
    promptLogin({ returnTo: window.location.pathname + window.location.search })
    loginNotice.value = t('misc.sessionExpired')
  })

  function signInWithGoogle(returnTo = loginReturnTo.value ?? undefined) {
    window.location.assign(googleSignInUrl(returnTo))
  }

  function signInWithFacebook(returnTo = loginReturnTo.value ?? undefined) {
    window.location.assign(oauthSignInUrl('facebook', returnTo))
  }

  function signInWithLine(returnTo = loginReturnTo.value ?? undefined) {
    window.location.assign(oauthSignInUrl('line', returnTo))
  }

  /** Opens the sign-in popup; after signing in the user is sent to `returnTo`. */
  function promptLogin({ returnTo = null, view = 'signin' } = {}) {
    loginReturnTo.value = returnTo
    loginView.value = view
    loginOpen.value = true
  }
  function closeLogin() {
    loginOpen.value = false
  }

  async function refreshMe() {
    me.value = (await api('/me')).data
    announce()
  }

  /** Username (or email) + password; resolves once /me is loaded. */
  async function loginWithPassword(login, password) {
    await api('/auth/login', { method: 'POST', body: { login, password } })
    await refreshMe()
    loginOpen.value = false
  }

  async function register({ fullName, email, phone, password }) {
    await api('/auth/register', { method: 'POST', body: { fullName, email, phone, password } })
    await refreshMe()
    loginOpen.value = false
  }

  async function completeOnboarding({ age, gender }) {
    const { data } = await api('/me/onboarding', {
      method: 'PUT',
      body: { age, gender },
    })
    me.value = data
  }

  async function updateProfile(patch) {
    const { data } = await api('/me', { method: 'PATCH', body: patch })
    me.value = { ...me.value, ...data }
    return data
  }

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {})
    me.value = null
    announce()
  }

  return {
    me,
    ready,
    googleEnabled,
    facebookEnabled,
    lineEnabled,
    registerEnabled,
    loginOpen,
    loginView,
    loginReturnTo,
    loginNotice,
    isSignedIn,
    needsOnboarding,
    isStaff,
    can,
    load,
    signInWithGoogle,
    signInWithFacebook,
    signInWithLine,
    promptLogin,
    closeLogin,
    refreshMe,
    updateProfile,
    loginWithPassword,
    register,
    completeOnboarding,
    logout,
  }
})
