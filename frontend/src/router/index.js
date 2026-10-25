import { watch } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { locale, t } from '@/i18n'
import { useAuthStore } from '@/stores/auth'
import HomeView from '@/views/HomeView.vue'
import { listMyBookings } from '@/api/bookings'

// Route-level code splitting: only the homepage ships in the entry chunk.
const Placeholder = () => import('@/views/PlaceholderView.vue')
const soon = (path, title, phase, meta = {}) => ({ path, component: Placeholder, meta: { title, phase, ...meta } })

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/vehicles', name: 'vehicles', component: () => import('@/views/VehiclesView.vue') },
    { path: '/vehicles/:slug', name: 'vehicle', component: () => import('@/views/VehicleDetailView.vue') },
    { path: '/promotions', name: 'promotions', component: () => import('@/views/PromotionsView.vue') },
    // LINE rich menu / chat cards (LIFF): choose a car → dates → details and documents.
    { path: '/book', name: 'book', component: () => import('@/views/BookView.vue'), meta: { title: 'จองรถ' } },
    { path: '/book/:slug', name: 'book-car', component: () => import('@/views/BookView.vue'), meta: { title: 'เลือกวันเช่า' } },
    // Rich menu "กรอกเอกสาร": the customer's booking in progress, else their bookings.
    {
      path: '/continue',
      name: 'continue',
      component: Placeholder,
      meta: { requiresAuth: true },
      beforeEnter: async () => {
        const open = (await listMyBookings().catch(() => [])).find((b) => b.status === 'PENDING')
        return open ? { name: 'booking', params: { number: open.number } } : { name: 'account' }
      },
    },
    { path: '/bookings/:number', name: 'booking', component: () => import('@/views/BookingStatusView.vue'), meta: { title: 'สถานะการจอง', requiresAuth: true } },
    { path: '/pay/mock/:id', name: 'mock-pay', component: () => import('@/views/MockPayView.vue'), meta: { title: 'ชำระเงิน (ทดสอบ)', requiresAuth: true } },
    { path: '/account', name: 'account', component: () => import('@/views/AccountView.vue'), meta: { title: 'การจองของฉัน', requiresAuth: true } },
    { path: '/account/settings', name: 'account-settings', component: () => import('@/views/AccountSettingsView.vue'), meta: { title: 'ตั้งค่าบัญชี', requiresAuth: true } },
    {
      path: '/admin/contracts/:id/print',
      name: 'contract-print',
      component: () => import('@/views/ContractPrintView.vue'),
      meta: { title: 'พิมพ์สัญญาเช่า', requiresAuth: true, requiresStaff: true, bare: true },
    },
    // LINE look-alike demo of the OA (developer machines; its API is not mounted in production).
    { path: '/line-demo', name: 'line-demo', component: () => import('@/views/LineDemoView.vue'), meta: { title: 'LINE demo', bare: true } },
    { path: '/line-demo/richmenu', name: 'line-richmenu', component: () => import('@/views/RichMenuExportView.vue'), meta: { title: 'Rich menu', bare: true } },
    { path: '/admin', name: 'admin', component: () => import('@/views/AdminView.vue'), meta: { title: 'Back Office', requiresAuth: true, requiresStaff: true } },
    soon('/backoffice', 'Back Office', 'Phase 9', { requiresAuth: true, requiresStaff: true }),
    { path: '/:pathMatch(.*)*', component: Placeholder, meta: { title: 'Page not found', phase: '404' } },
  ],
  scrollBehavior(to, from, saved) {
    if (saved) return saved
    if (to.hash) return { el: to.hash, behavior: 'smooth', top: 80 }
    // Filter changes on the listing replace the query — keep the scroll position.
    if (to.name === from.name && to.name === 'vehicles') return false
    return { top: 0 }
  },
})

// UX-level guards only. Real enforcement is server-side on every API call.
router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!auth.ready) await auth.load()
  if (to.meta.requiresAuth && !auth.isSignedIn) return { path: '/', query: { signin: to.fullPath } }
  if (to.meta.requiresStaff && !auth.isStaff) return { path: '/' }
})

router.afterEach((to) => {
  // Protected pages bounce guests to "/?signin=<page>": open the sign-in popup there.
  const auth = useAuthStore()
  if (to.query.signin && !auth.isSignedIn) auth.promptLogin({ returnTo: String(to.query.signin) })
  setTitle(to)
})

// Tab titles follow the language too (the car page sets its own from the car's name).
const TITLE_KEYS = { book: 'book', 'book-car': 'bookCar', booking: 'booking', 'mock-pay': 'mockPay', account: 'account', 'account-settings': 'settings', 'contract-print': 'print' }
function setTitle(to) {
  if (to.name === 'vehicle') return
  const title = TITLE_KEYS[to.name] ? t(`titles.${TITLE_KEYS[to.name]}`) : to.meta.title
  document.title = title ? `${title} — Coolkids Car Rental` : t('titles.default')
}
watch(locale, () => setTitle(router.currentRoute.value))

export default router
