<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useSiteStore } from '@/stores/site'
import Icon from '@/components/ui/Icon.vue'
import { useI18n } from '@/i18n'

const auth = useAuthStore()
const router = useRouter()
const menuOpen = ref(false)
const scrolled = ref(false)
const menuRoot = ref(null)

// Dark, full-width bar (Resend reference): wordmark left, links centred,
// plain sign-in text + white pill CTA right. Links come from CMS "site.navbar".
const site = useSiteStore()
const { t, tc, locale, setLocale, LOCALES } = useI18n()
// CMS labels are Thai; other languages use the dictionary entry for the same link
const NAV_KEYS = { '/': 'nav.home', '/vehicles': 'nav.vehicles', '/#reviews': 'nav.reviews', '/#locations': 'nav.contact' }
const links = computed(() =>
  (site.content?.navbar?.links ?? [{ label: 'รถของเรา', href: '/vehicles' }]).map((l) => ({
    ...l,
    label: NAV_KEYS[l.href] ? tc(l.label, NAV_KEYS[l.href]) : l.label,
  })),
)
const cta = computed(() => site.content?.navbar?.cta)

// language switcher
const langOpen = ref(false)
const langRoot = ref(null)
const currentLang = computed(() => LOCALES.find((l) => l.code === locale.value))
function pickLang(code) {
  setLocale(code)
  langOpen.value = false
}

const menuItems = computed(() => [
  { label: t('header.myBookings'), to: '/account' },
  ...(auth.isStaff ? [{ label: t('header.admin'), to: '/admin' }] : []),
  { label: t('header.settings'), to: '/account/settings' },
])

const onScroll = () => (scrolled.value = window.scrollY > 12)
const onDocClick = (e) => {
  if (menuOpen.value && !menuRoot.value?.contains(e.target)) menuOpen.value = false
  if (langOpen.value && !langRoot.value?.contains(e.target)) langOpen.value = false
}
const onKey = (e) => {
  if (e.key !== 'Escape') return
  menuOpen.value = false
  langOpen.value = false
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKey)
  onScroll()
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
})

async function logout() {
  menuOpen.value = false
  await auth.logout()
  router.push('/')
}
</script>

<template>
  <header class="header" :class="{ scrolled }">
    <div class="bar">
      <RouterLink to="/" class="brand" :aria-label="t('header.home')">COOLKIDS</RouterLink>

      <nav class="nav" :aria-label="t('header.primary')">
        <RouterLink v-for="l in links" :key="l.href" :to="l.href" exact-active-class="on">{{ l.label }}</RouterLink>
      </nav>

      <div class="actions">
        <div ref="langRoot" class="lang">
          <button
            type="button"
            class="lang-btn"
            :aria-expanded="langOpen"
            aria-haspopup="listbox"
            :aria-label="t('nav.language')"
            @click="langOpen = !langOpen"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" /></svg>
            {{ currentLang.short }}
            <Icon name="chevron-down" :size="12" />
          </button>
          <Transition name="menu">
            <ul v-if="langOpen" class="lang-menu" role="listbox" :aria-label="t('nav.language')">
              <li v-for="l in LOCALES" :key="l.code">
                <button type="button" role="option" :aria-selected="l.code === locale" :class="{ on: l.code === locale }" :lang="l.html" @click="pickLang(l.code)">
                  <span>{{ l.label }}</span>
                  <Icon v-if="l.code === locale" name="check" :size="14" />
                </button>
              </li>
            </ul>
          </Transition>
        </div>
        <template v-if="!auth.ready" />
        <button
          v-else-if="!auth.isSignedIn"
          type="button"
          class="signin"
          @click="auth.promptLogin()"
        >
          {{ t('nav.signin') }}
        </button>
        <div v-else ref="menuRoot" class="profile">
          <button
            type="button"
            class="avatar-btn"
            :aria-expanded="menuOpen"
            aria-haspopup="menu"
            @click="menuOpen = !menuOpen"
          >
            <img v-if="auth.me.avatarUrl" :src="auth.me.avatarUrl" alt="" referrerpolicy="no-referrer" />
            <span v-else class="initial">{{ auth.me.fullName?.[0] ?? '?' }}</span>
            <span class="sr-only">{{ t('header.account') }}</span>
          </button>
          <Transition name="menu">
            <div v-if="menuOpen" class="menu" role="menu">
              <div class="who">
                <strong>{{ auth.me.fullName }}</strong>
                <span>{{ auth.me.email }}</span>
              </div>
              <RouterLink
                v-for="item in menuItems"
                :key="item.to"
                :to="item.to"
                role="menuitem"
                @click="menuOpen = false"
              >
                {{ item.label }}
              </RouterLink>
              <button type="button" role="menuitem" class="logout" @click="logout">{{ t('header.logout') }}</button>
            </div>
          </Transition>
        </div>
        <a v-if="cta" :href="cta.href" target="_blank" rel="noopener" class="cta">
          {{ tc(cta.label, 'nav.line') }} <Icon name="chevron-right" :size="14" />
        </a>
      </div>
    </div>
  </header>
</template>

<style scoped>
.header {
  position: fixed;
  inset: 0 0 auto;
  z-index: var(--z-header);
  background: rgb(0 0 0 / 0.55);
  backdrop-filter: blur(14px) saturate(140%);
  border-bottom: 1px solid rgb(255 255 255 / 0.08);
  transition: background var(--dur-base) var(--ease-out);
}
.header.scrolled {
  background: rgb(0 0 0 / 0.82);
}
.bar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  max-width: 1720px;
  height: 64px;
  margin-inline: auto;
  padding-inline: clamp(1rem, 3vw, 3rem);
}
.brand {
  justify-self: start;
  font-family: 'Unbounded', var(--font-display);
  font-weight: 700;
  font-size: 1.05rem;
  letter-spacing: -0.01em;
  color: #fff;
}
.nav {
  display: flex;
  gap: clamp(1.25rem, 3vw, 2.4rem);
  font-size: 0.93rem;
}
.nav a {
  color: #a1a1aa;
  transition: color var(--dur-fast) var(--ease-out);
}
.nav a:hover,
.nav a.on {
  color: #fff;
}
.actions {
  justify-self: end;
  display: flex;
  align-items: center;
  gap: 1.1rem;
}
.signin {
  padding: 0;
  border: 0;
  background: none;
  color: #e4e4e7;
  font-size: 0.93rem;
  font-weight: 500;
  cursor: pointer;
}
.signin:hover:not(:disabled) {
  color: #fff;
}
.signin:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.cta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 38px;
  padding: 0 14px 0 18px;
  border-radius: var(--r-pill);
  background: #fff;
  color: #000;
  font-size: 0.9rem;
  font-weight: 600;
  transition: background var(--dur-fast) var(--ease-out);
}
.cta:hover {
  background: #e4e4e7;
}
.profile {
  position: relative;
}
.lang {
  position: relative;
}
.lang-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 10px;
  border: 1px solid rgb(255 255 255 / 0.16);
  border-radius: var(--r-pill);
  background: rgb(255 255 255 / 0.06);
  color: #e4e4e7;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}
.lang-btn:hover {
  background: rgb(255 255 255 / 0.12);
  border-color: rgb(255 255 255 / 0.3);
}
.lang-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 10px);
  z-index: var(--z-dropdown);
  min-width: 160px;
  margin: 0;
  padding: 6px;
  list-style: none;
  border: 1px solid rgb(255 255 255 / 0.1);
  border-radius: 12px;
  background: rgb(14 14 16 / 0.92);
  -webkit-backdrop-filter: blur(16px);
  backdrop-filter: blur(16px);
  box-shadow: var(--shadow-lg);
}
.lang-menu button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 8px 12px;
  border: 0;
  border-radius: 8px;
  background: none;
  color: #d4d4d8;
  font-size: var(--fs-sm);
  text-align: left;
  cursor: pointer;
}
.lang-menu button:hover {
  background: rgb(255 255 255 / 0.07);
  color: #fff;
}
.lang-menu button.on {
  color: #fff;
}
.avatar-btn {
  width: 34px;
  height: 34px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid rgb(255 255 255 / 0.2);
  background: #18181b;
  color: #fff;
  overflow: hidden;
  cursor: pointer;
  display: grid;
  place-items: center;
}
.avatar-btn img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.menu {
  position: absolute;
  right: 0;
  top: calc(100% + 12px);
  z-index: var(--z-dropdown);
  min-width: 240px;
  display: grid;
  padding: 6px;
  border: 1px solid rgb(255 255 255 / 0.1);
  border-radius: 12px;
  background: #0a0a0b;
  color: #e4e4e7;
  box-shadow: var(--shadow-lg);
}
.who {
  display: grid;
  padding: 10px 12px;
  border-bottom: 1px solid rgb(255 255 255 / 0.08);
  margin-bottom: 6px;
  font-size: var(--fs-sm);
}
.who span {
  color: #a1a1aa;
  font-size: var(--fs-xs);
  overflow: hidden;
  text-overflow: ellipsis;
}
.menu a,
.menu .logout {
  padding: 8px 12px;
  border-radius: 8px;
  font-size: var(--fs-sm);
  text-align: left;
  background: none;
  border: 0;
  color: inherit;
  cursor: pointer;
}
.menu a:hover,
.menu .logout:hover {
  background: rgb(255 255 255 / 0.06);
}
.logout {
  color: #a1a1aa !important;
}
.menu-enter-active,
.menu-leave-active {
  transition:
    opacity var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
}
.menu-enter-from,
.menu-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
@media (max-width: 820px) {
  .bar {
    grid-template-columns: 1fr auto;
  }
  .nav {
    display: none;
  }
}
@media (max-width: 480px) {
  /* phones: the sign-in link stays (compact) so customers can still log in */
  .signin {
    font-size: 0.8rem;
    white-space: nowrap;
  }
  .cta {
    height: 34px;
    padding: 0 12px;
    font-size: 0.78rem;
    white-space: nowrap;
  }
  .cta :deep(svg) {
    display: none;
  }
  .actions {
    gap: 8px;
  }
  .brand {
    font-size: 0.92rem;
  }
  .lang-btn {
    padding: 0 8px;
  }
  .lang-btn > svg:last-child {
    display: none;
  }
}
@media (max-width: 360px) {
  .lang-btn > svg:first-child {
    display: none;
  }
  .cta {
    padding: 0 10px;
  }
}
</style>
