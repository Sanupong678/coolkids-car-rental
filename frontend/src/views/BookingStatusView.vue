<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { contractPdfUrl, getBooking, getContract, getMyDocuments, getTracking, myDocumentPdfUrl, startCheckout, verifyPayment } from '@/api/bookings'
import { money } from '@/utils/format'
import { useI18n } from '@/i18n'
import Icon from '@/components/ui/Icon.vue'
import BookingModal from '@/components/booking/BookingModal.vue'
import ContractDocument from '@/components/booking/ContractDocument.vue'
import IdentityDocuments from '@/components/booking/IdentityDocuments.vue'
import PromptPayPayment from '@/components/booking/PromptPayPayment.vue'
import TrackingMap from '@/components/booking/TrackingMap.vue'

// After payment: thank-you message plus a live tracker
//   กำลังเตรียมเอกสาร → กำลังส่งรถ → ถึงที่หมาย
// driven by the statuses staff set on the back-office board. Polls while the
// booking is still moving; while the car is on its way the driver's position
// is shown on a map, refreshed every 10 s. Before payment the page walks the
// LINE flow: send documents → staff check → transfer the reservation fee (QR +
// slip) → staff confirm the slip → summary + contract PDF.
const route = useRoute()
const router = useRouter()
const { t, tx, fmtDate, errorText, locale } = useI18n()
// The booking summary in the chosen language (the server sends th / en / zh).
const summaryText = computed(() => b.value?.summaries?.[locale.value] ?? b.value?.summary)
const b = ref(null)
const error = ref('')
const contract = ref(null)
const showContract = ref(false)
const resume = ref(false)
const tracking = ref(null)
let poll
let trackPoll

async function load() {
  try {
    b.value = await getBooking(route.params.number)
  } catch (err) {
    error.value = err.status === 404 ? t('st.notFound') : errorText(err)
  }
}

async function loadTracking() {
  if (b.value?.status !== 'IN_DELIVERY') return (tracking.value = null)
  tracking.value = await getTracking(b.value.number).catch(() => tracking.value)
}
// Live map only while the car is on its way.
watch(
  () => b.value?.status,
  (s) => {
    clearInterval(trackPoll)
    if (s !== 'IN_DELIVERY') return (tracking.value = null)
    loadTracking()
    trackPoll = setInterval(loadTracking, 10_000)
  },
)

onMounted(async () => {
  const sessionId = route.query.session_id
  if (sessionId) {
    try {
      b.value = await verifyPayment(route.params.number, sessionId)
    } catch {
      /* fall through to a normal load; the webhook will confirm */
    }
    router.replace({ query: { paid: '1' } })
  }
  await load()
  poll = setInterval(() => {
    if (b.value && !['COMPLETED', 'CANCELLED', 'REFUNDED', 'EXPIRED'].includes(b.value.status)) load()
  }, 15_000)
})
onBeforeUnmount(() => {
  clearInterval(poll)
  clearInterval(trackPoll)
})
watch(() => route.params.number, (n) => n && load())

const delivery = computed(() => b.value?.fulfillment === 'DELIVERY')
const paid = computed(() => b.value && !['PENDING', 'EXPIRED', 'CANCELLED'].includes(b.value.status))
// Document photos can be added or replaced until the car is handed over.
const docsOpen = computed(() => {
  const s = b.value?.status
  // While staff check the documents (or after approval) they are frozen until the fee is paid.
  if (s === 'PENDING') return !['SUBMITTED', 'APPROVED'].includes(b.value.review?.status)
  return ['CONFIRMED', 'PREPARING', 'READY', 'IN_DELIVERY'].includes(s)
})
const onDocs = (documents) => (b.value = { ...b.value, documents })

// Tracker steps. Branch pick-ups say "ready to collect" instead of "on the way".
const steps = computed(() => [
  { key: 'docs', label: t('st.stepDocs'), icon: 'receipt' },
  { key: 'move', label: t(delivery.value ? 'st.stepMove' : 'st.stepReady'), icon: 'car' },
  { key: 'done', label: t(delivery.value ? 'st.stepArrived' : 'st.stepCollected'), icon: 'flag' },
])
const current = computed(() => ({ CONFIRMED: 0, PREPARING: 0, READY: 1, IN_DELIVERY: 1, ACTIVE: 2, COMPLETED: 3 })[b.value?.status] ?? -1)

const slipInReview = computed(() => b.value?.status === 'PENDING' && b.value.slip?.status === 'NEEDS_REVIEW')
const review = computed(() => (b.value?.status === 'PENDING' ? b.value.review?.status : null))
// Approved and not paid yet: show the transfer QR right on this page.
const canPay = computed(() => Boolean(b.value?.payWith?.promptpay || b.value?.payWith?.card) && !slipInReview.value)

// Card / Apple Pay / Google Pay on Stripe's hosted page; Stripe sends the customer back here
// with ?session_id=…, which onMounted confirms (the webhook confirms it too).
const cardBusy = ref(false)
const cardError = ref('')
const cardCancelled = computed(() => route.query.cancelled === '1')
async function payByCard() {
  cardBusy.value = true
  cardError.value = ''
  try {
    const { url } = await startCheckout(b.value.number, locale.value)
    window.location.assign(url)
  } catch (err) {
    cardError.value = errorText(err)
    cardBusy.value = false
  }
}
const canResume = computed(() => b.value?.status === 'PENDING' && (!review.value || ['DRAFT', 'CHANGES_REQUESTED'].includes(review.value)))
const until = (iso) => fmtDate(iso, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const headline = computed(() => {
  const s = b.value?.status
  const h = (key, vars) => [t(`st.h.${key}`)[0], t(`st.h.${key}`)[1].replace(/\{(\w+)\}/g, (_, k) => vars?.[k] ?? '')]
  if (slipInReview.value) return h('slip')
  if (review.value === 'DRAFT') return h('draft')
  if (review.value === 'CHANGES_REQUESTED') return [h('changes')[0], b.value.review.note ?? h('changes')[1]]
  if (review.value === 'SUBMITTED') return h('submitted')
  if (review.value === 'APPROVED') return h('approved', { fee: money(b.value.money.dueNowMinor, b.value.money.currency), until: until(b.value.holdExpiresAt) })
  if (s === 'PENDING') return h('pending')
  if (s === 'EXPIRED') return h('expired')
  if (s === 'CANCELLED' || s === 'REFUNDED') return h('cancelled')
  if (s === 'COMPLETED') return h('completed')
  return h('thanks')
})

const live = computed(() => {
  const tr = tracking.value
  if (!tr?.live) return null
  const ageMin = tr.position ? Math.round((Date.now() - new Date(tr.position.at)) / 60_000) : null
  return {
    ...tr,
    km: tr.remainingMeters != null ? (tr.remainingMeters / 1000).toFixed(tr.remainingMeters < 10_000 ? 1 : 0) : null,
    updated: ageMin == null ? null : ageMin < 1 ? t('st.justNow') : t('st.minAgo', { n: ageMin }),
    stale: ageMin != null && ageMin >= 3,
  }
})

const etaText = computed(() => {
  const d = b.value?.delivery
  if (!d) return null
  if (b.value.status === 'IN_DELIVERY' && live.value?.arrivedAt) return t('st.arrivedNow')
  if (b.value.status === 'IN_DELIVERY' && live.value?.km != null) {
    return t('st.kmLeft', { km: live.value.km, time: fmtTime(live.value.etaAt) })
  }
  if (b.value.status === 'IN_DELIVERY' && d.etaAt) {
    const mins = Math.max(0, Math.round((new Date(d.etaAt) - Date.now()) / 60_000))
    return t('st.etaAt', { time: fmtTime(d.etaAt), n: mins })
  }
  if (d.deliveredAt) return t('st.deliveredAt', { time: fmtTime(d.deliveredAt) })
  if (d.durationSeconds) return t('st.distance', { km: (d.distanceMeters / 1000).toFixed(1), n: Math.round(d.durationSeconds / 60) })
  return null
})

const fmt = (iso) => fmtDate(iso, { dateStyle: 'long', timeStyle: 'short' })
const fmtTime = (iso) => fmtDate(iso, { hour: '2-digit', minute: '2-digit' })
// Line items carry a type, so the label follows the language (discount = the promotion's own name).
function itemLabel(it) {
  if (it.type === 'RENTAL') return t('st.itemRental', { car: `${b.value.vehicle.brand} ${b.value.vehicle.model}`, n: it.quantity })
  if (it.type === 'DELIVERY_FEE' && b.value.delivery?.distanceMeters) return t('st.itemDelivery', { km: (b.value.delivery.distanceMeters / 1000).toFixed(1) })
  return it.description
}

async function openContract() {
  contract.value ??= await getContract(b.value.number)
  showContract.value = true
}
function onResumeClose() {
  resume.value = false
  load()
}
const onPaid = (booking) => (b.value = booking)

// Booking slip + receipts (PDF) once something has been paid.
const papers = ref(null)
watch(
  () => [b.value?.number, b.value?.payment?.status],
  async ([n, paidStatus]) => (papers.value = n && paidStatus === 'SUCCEEDED' ? await getMyDocuments(n).catch(() => null) : null),
)

const copied = ref(false)
async function copySummary() {
  try {
    await navigator.clipboard.writeText(summaryText.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    /* clipboard blocked: the text is still selectable */
  }
}
</script>

<template>
  <main class="status">
    <div v-if="error" class="wrap empty">
      <h1>{{ error }}</h1>
      <RouterLink to="/account" class="btn btn-primary btn-pill">{{ t('st.myBookings') }}</RouterLink>
    </div>

    <div v-else-if="b" class="wrap">
      <section class="hero" :class="{ ok: paid }">
        <span class="badge"><Icon :name="paid ? 'check' : 'clock'" :size="22" /></span>
        <h1>{{ headline[0] }}</h1>
        <p>{{ headline[1] }}</p>
        <p class="num">{{ t('st.number') }} <b>{{ b.number }}</b><template v-if="b.contract"> · {{ t('st.contract', { n: b.contract.number }) }}</template></p>
        <div v-if="canResume" class="actions">
          <button type="button" class="btn btn-primary btn-pill" @click="resume = true">{{ t(review === 'CHANGES_REQUESTED' ? 'st.fixResend' : 'st.continue') }}</button>
        </div>
        <RouterLink v-else-if="b.status === 'EXPIRED'" :to="{ name: 'vehicle', params: { slug: b.vehicle.slug } }" class="btn btn-primary btn-pill">{{ t('st.bookAgain') }}</RouterLink>
      </section>

      <section v-if="canPay" class="card pay" :aria-label="t('st.payFee')">
        <h2>{{ t('st.payFee') }}</h2>
        <template v-if="b.payWith.card">
          <p v-if="cardCancelled" class="card-note">{{ t('st.cardCancelled') }}</p>
          <button type="button" class="btn btn-primary btn-pill card-btn" :disabled="cardBusy" @click="payByCard">
            <span v-if="cardBusy" class="spinner" /><template v-else><Icon name="receipt" :size="16" /> {{ t('st.payCard', { fee: money(b.money.dueNowMinor, b.money.currency) }) }}</template>
          </button>
          <small class="card-hint">{{ t('st.payCardHint') }}</small>
          <p v-if="cardError" class="card-err" role="alert">{{ cardError }}</p>
          <div v-if="b.payWith.promptpay" class="or"><span>{{ t('st.orPromptpay') }}</span></div>
        </template>
        <PromptPayPayment v-if="b.payWith.promptpay" :number="b.number" @done="onPaid" />
      </section>

      <section v-if="paid && b.status !== 'COMPLETED'" class="track" :aria-label="t('st.trackLabel')">
        <ol>
          <li v-for="(s, i) in steps" :key="s.key" :class="{ done: i < current || current === 2, on: i === current }">
            <span class="dot"><Icon :name="i < current || (i === current && current === 2) ? 'check' : s.icon" :size="18" /></span>
            <strong>{{ s.label }}</strong>
          </li>
        </ol>
        <p v-if="b.status === 'CONFIRMED'" class="wait"><Icon name="clock" :size="14" /> {{ t('st.waitStaff') }}</p>
        <p v-if="etaText" class="eta"><Icon name="pin" :size="14" /> {{ etaText }}</p>
        <div v-if="live" class="live">
          <TrackingMap :position="live.position" :destination="live.destination" :branch="live.branch" />
          <div class="live-meta">
            <span v-if="live.position" :class="{ stale: live.stale }">
              <i class="dot-live" aria-hidden="true" /> {{ t('st.gpsUpdated', { when: live.updated }) }}<template v-if="live.stale"> {{ t('st.gpsGap') }}</template>
            </span>
            <span v-else>{{ t('st.gpsWait') }}</span>
            <a v-if="live.driver?.phone" :href="`tel:${live.driver.phone}`" class="call"><Icon name="phone" :size="14" /> {{ t('st.callDriver') }}{{ live.driver.name ? ` (${live.driver.name})` : '' }}</a>
          </div>
        </div>
      </section>

      <section v-if="b.summary" class="card summary">
        <header>
          <h2>{{ t('st.summary') }}</h2>
          <div class="ct-actions">
            <button type="button" class="btn btn-ghost btn-sm btn-pill" @click="copySummary"><Icon v-if="copied" name="check" :size="14" />{{ t(copied ? 'st.copied' : 'st.copy') }}</button>
            <a :href="contractPdfUrl(b.number, { download: true })" class="btn btn-primary btn-sm btn-pill"><Icon name="printer" :size="14" /> {{ t('st.contractPdf') }}</a>
            <a v-if="papers" :href="myDocumentPdfUrl(b.number, 'booking')" class="btn btn-ghost btn-sm btn-pill"><Icon name="receipt" :size="14" /> {{ t('st.bookingSlip') }}</a>
            <a v-for="r in papers?.receipts ?? []" :key="r.id" :href="myDocumentPdfUrl(b.number, 'receipt', r.id)" class="btn btn-ghost btn-sm btn-pill"><Icon name="receipt" :size="14" /> {{ t('st.receipt', { n: r.number }) }}</a>
          </div>
        </header>
        <pre>{{ summaryText }}</pre>
      </section>

      <div class="grid">
        <section class="card">
          <h2>{{ t('st.details') }}</h2>
          <div class="car">
            <img v-if="b.vehicle.image" :src="b.vehicle.image.variants?.w640 ?? b.vehicle.image.url" alt="" />
            <div>
              <strong>{{ b.vehicle.brand }} {{ b.vehicle.model }}</strong>
              <small>{{ b.vehicle.trim }} · {{ b.vehicle.year }} · {{ t('st.plate', { plate: b.vehicle.plate }) }}</small>
            </div>
          </div>
          <dl>
            <div><dt>{{ t('st.pickup') }}</dt><dd>{{ fmt(b.pickupAt) }}</dd></div>
            <div><dt>{{ t('st.return') }}</dt><dd>{{ fmt(b.returnAt) }} ({{ t('common.days', { n: b.rentalDays }) }})</dd></div>
            <div v-if="delivery">
              <dt>{{ t('st.deliverTo') }}</dt>
              <dd>
                {{ b.delivery.address }}<template v-if="b.delivery.notes"> · {{ b.delivery.notes }}</template>
                <a v-if="b.delivery.mapsUrl" :href="b.delivery.mapsUrl" target="_blank" rel="noopener" class="map">{{ t('st.onMaps') }}</a>
              </dd>
            </div>
            <div v-else><dt>{{ t('st.pickupAt') }}</dt><dd>{{ tx(b.branch) }}</dd></div>
            <div><dt>{{ t('st.renter') }}</dt><dd>{{ b.customer.fullName }} · {{ b.customer.phone }}</dd></div>
            <div v-if="b.details?.areaOfUse"><dt>{{ t('st.area') }}</dt><dd>{{ b.details.areaOfUse }}</dd></div>
            <div v-if="b.details?.stayLocation"><dt>{{ t('st.stay') }}</dt><dd>{{ b.details.stayLocation }}</dd></div>
          </dl>
          <div v-if="b.contract" class="ct-actions">
            <button type="button" class="btn btn-ghost btn-sm btn-pill" @click="openContract"><Icon name="receipt" :size="14" /> {{ t('st.viewContract') }}</button>
            <a :href="contractPdfUrl(b.number, { download: true })" class="btn btn-ghost btn-sm btn-pill"><Icon name="printer" :size="14" /> {{ t('st.downloadPdf') }}</a>
          </div>
        </section>

        <section class="card">
          <h2>{{ t('st.payment') }}</h2>
          <table>
            <tr v-for="it in b.money.items" :key="it.description"><th>{{ itemLabel(it) }}</th><td>{{ money(it.amountMinor, b.money.currency) }}</td></tr>
            <tr><th>{{ t('st.deposit') }}</th><td>{{ money(b.money.depositMinor, b.money.currency) }}</td></tr>
            <tr class="total"><th>{{ t(paid ? 'st.feePaid' : 'st.feeDue') }}</th><td>{{ money(paid ? b.payment.amountMinor : b.money.dueNowMinor, b.money.currency) }}</td></tr>
            <tr class="muted"><th>{{ t('st.atPickup') }}</th><td>{{ money(b.money.payAtPickupMinor, b.money.currency) }}</td></tr>
          </table>
          <p v-if="b.payment?.status === 'SUCCEEDED'" class="paid">
            <Icon name="check" :size="14" /> {{ t('st.paidAt', { time: fmt(b.payment.succeededAt) }) }}<template v-if="b.payment.methodType === 'promptpay'"> · {{ t('st.viaPromptpay') }}</template><template v-else-if="b.payment.last4"> · {{ t('st.card', { n: b.payment.last4 }) }}</template>
          </p>
          <p v-else-if="slipInReview" class="review"><Icon name="clock" :size="14" /> {{ t('st.slipAt', { time: fmt(b.slip.createdAt) }) }}</p>
        </section>
      </div>

      <IdentityDocuments v-if="b.documents && !['EXPIRED', 'CANCELLED', 'REFUNDED'].includes(b.status)" :number="b.number" :documents="b.documents" :editable="docsOpen" @updated="onDocs" />

      <p class="help">{{ t('st.help', { line: '@Coolkidscar', phone: '065-365-6514' }) }} · <RouterLink to="/account">{{ t('st.allMine') }}</RouterLink></p>
    </div>
    <div v-else class="wrap"><div class="skeleton" style="height: 360px" /></div>

    <BookingModal v-if="resume" :resume-number="b.number" @close="onResumeClose" />

    <dialog v-if="showContract" open class="ct-dialog" @click.self="showContract = false">
      <div class="ct-card">
        <button type="button" class="x" :aria-label="t('common.close')" @click="showContract = false"><Icon name="x" :size="18" /></button>
        <ContractDocument :html="contract.html" />
      </div>
    </dialog>
  </main>
</template>

<style scoped>
.ct-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.summary header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.summary pre {
  margin: 0;
  padding: var(--s-4);
  max-height: 420px;
  overflow: auto;
  border-radius: var(--r-md);
  background: var(--bg);
  font-family: var(--font-body);
  font-size: var(--fs-sm);
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.pay {
  max-width: 520px;
  width: 100%;
  justify-self: center;
}
.card-btn {
  width: 100%;
  justify-content: center;
  gap: 8px;
}
.card-hint {
  display: block;
  margin-top: 6px;
  text-align: center;
  color: var(--muted);
}
.card-note,
.card-err {
  margin: 0 0 10px;
  font-size: 0.9rem;
  color: var(--muted);
}
.card-err {
  color: var(--danger, #e5484d);
}
.or {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 16px 0 6px;
  color: var(--muted);
  font-size: 0.85rem;
}
.or::before,
.or::after {
  content: '';
  flex: 1;
  border-top: 1px solid var(--line, rgba(127, 127, 127, 0.25));
}
.status {
  min-height: 100dvh;
  padding: 96px var(--gutter) var(--s-8);
  background: var(--bg);
}
.wrap {
  display: grid;
  gap: var(--s-5);
  max-width: 980px;
  margin-inline: auto;
}
.hero {
  display: grid;
  justify-items: center;
  gap: var(--s-2);
  padding: var(--s-6) var(--s-5);
  border-radius: var(--r-lg);
  background: var(--surface);
  text-align: center;
  box-shadow: var(--shadow-sm);
}
.badge {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #fdf3e2;
  color: #b7791f;
}
.hero.ok .badge {
  background: #e6f6ee;
  color: #1f8a56;
}
h1 {
  font-family: var(--font-body);
  font-size: var(--fs-2xl);
  font-weight: 700;
  letter-spacing: -0.01em;
}
.hero p {
  color: var(--text-muted);
}
.num {
  font-size: var(--fs-sm);
}
.num b {
  color: var(--text);
}
.track {
  padding: var(--s-5);
  border-radius: var(--r-lg);
  background: var(--night);
  color: var(--night-text);
}
.track ol {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  margin: 0;
  padding: 0;
  list-style: none;
}
.track li {
  position: relative;
  display: grid;
  justify-items: center;
  gap: 6px;
  text-align: center;
  color: rgb(255 255 255 / 0.5);
}
.track li:not(:last-child)::after {
  content: '';
  position: absolute;
  top: 22px;
  left: calc(50% + 30px);
  right: calc(-50% + 30px);
  height: 3px;
  border-radius: 3px;
  background: rgb(255 255 255 / 0.15);
}
.track li.done:not(:last-child)::after {
  background: var(--accent);
}
.dot {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  border-radius: 50%;
  border: 2px solid rgb(255 255 255 / 0.2);
  background: rgb(255 255 255 / 0.05);
}
.track li.on,
.track li.done {
  color: #fff;
}
.track li.done .dot {
  background: var(--accent);
  border-color: var(--accent);
}
.track li.on .dot {
  border-color: var(--accent);
  box-shadow: 0 0 0 6px rgb(226 54 44 / 0.2);
  animation: pulse 1.8s var(--ease-in-out) infinite;
}
.track small {
  font-size: var(--fs-xs);
  opacity: 0.7;
}
.wait,
.eta {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 6px;
  margin-top: var(--s-4);
  font-size: var(--fs-sm);
}
.eta {
  color: #ffd2cf;
}
.live {
  display: grid;
  gap: 10px;
  margin-top: var(--s-4);
}
.live-meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-sm);
}
.live-meta .stale {
  color: #ffd29a;
}
.dot-live {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 4px;
  border-radius: 50%;
  background: #5fd39a;
  animation: blink 1.6s ease-in-out infinite;
}
.stale .dot-live {
  background: #ffb547;
  animation: none;
}
@keyframes blink {
  50% {
    opacity: 0.3;
  }
}
@media (prefers-reduced-motion: reduce) {
  .dot-live {
    animation: none;
  }
}
.call {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 40px;
  padding: 0 14px;
  border-radius: 999px;
  background: #fff;
  color: #121319;
  font-weight: 600;
}
.grid {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: var(--s-5);
}
.card {
  display: grid;
  align-content: start;
  gap: var(--s-3);
  padding: var(--s-5);
  border-radius: var(--r-lg);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}
h2 {
  font-family: var(--font-body);
  font-size: var(--fs-lg);
  font-weight: 700;
  letter-spacing: 0;
}
.car {
  display: flex;
  align-items: center;
  gap: var(--s-3);
}
.car img {
  width: 120px;
  aspect-ratio: 16 / 10;
  object-fit: contain;
}
.car div {
  display: grid;
}
.car small,
dt {
  color: var(--text-muted);
}
dl {
  display: grid;
  gap: 8px;
  margin: 0;
  font-size: var(--fs-sm);
}
dl div {
  display: grid;
  grid-template-columns: 80px 1fr;
  gap: 8px;
}
dd {
  margin: 0;
}
.map {
  display: block;
  color: var(--accent);
  font-size: var(--fs-xs);
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-sm);
}
th {
  text-align: left;
  font-weight: 400;
  padding: 7px 0;
  border-bottom: 1px solid var(--border);
}
td {
  text-align: right;
  white-space: nowrap;
  padding: 7px 0;
  border-bottom: 1px solid var(--border);
}
.total th,
.total td {
  font-weight: 700;
}
.muted th,
.muted td {
  color: var(--text-muted);
  border: 0;
}
.review {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #b7791f;
  font-size: var(--fs-xs);
}
.paid {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #1f8a56;
  font-size: var(--fs-xs);
}
.help {
  text-align: center;
  color: var(--text-muted);
  font-size: var(--fs-sm);
}
.help a {
  color: var(--accent);
}
.empty {
  justify-items: center;
  padding-top: var(--s-8);
}
.ct-dialog {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
  padding: 12px;
  border: 0;
  background: rgb(8 9 12 / 0.6);
}
.ct-card {
  position: relative;
  width: min(820px, 100%);
  max-height: calc(100dvh - 24px);
  overflow-y: auto;
  padding: 28px 22px 22px;
  border-radius: 20px;
  background: #fff;
}
.x {
  position: sticky;
  top: 0;
  float: right;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 1px solid #e3e4e8;
  border-radius: 50%;
  background: #fff;
  cursor: pointer;
}
@keyframes pulse {
  50% {
    box-shadow: 0 0 0 12px rgb(226 54 44 / 0);
  }
}
@media (max-width: 760px) {
  .grid {
    grid-template-columns: 1fr;
  }
  .track li strong {
    font-size: var(--fs-sm);
  }
  .track li:not(:last-child)::after {
    left: calc(50% + 26px);
    right: calc(-50% + 26px);
  }
}
</style>
