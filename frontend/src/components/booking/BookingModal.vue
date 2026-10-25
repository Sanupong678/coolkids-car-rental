<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { createBooking, getBooking, submitForReview } from '@/api/bookings'
import { useAuthStore } from '@/stores/auth'
import { money, toLocalInput } from '@/utils/format'
import { useI18n } from '@/i18n'
import Icon from '@/components/ui/Icon.vue'
import AddressSearch from './AddressSearch.vue'
import IdentityDocuments from './IdentityDocuments.vue'
import MapPicker from './MapPicker.vue'
import TermsPopup from './TermsPopup.vue'

// "จองเลย" wizard (also the LINE rich-menu flow):
//   1 details → 2 photos (driver 1 required; driver 2 and a reference optional)
//   → 3 sent: staff check everything, then the customer pays the reservation
//   fee from the booking page (QR + slip). No e-signature: the contract PDF is
//   sent for acknowledgement and signed on paper at pick-up.
// Step 1 creates a PENDING booking that holds the car; the server prices it and
// fills the contract with exactly what the customer typed. `resumeNumber`
// re-opens an unfinished booking at the right step.
const props = defineProps({
  vehicle: { type: Object, default: null },
  dates: { type: Object, default: null }, // { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' } from the calendar
  resumeNumber: { type: String, default: null },
})
const emit = defineEmits(['close'])

const auth = useAuthStore()
const { t, tx, fmtDate, countryName, errorText } = useI18n()
const dialog = ref(null)
const step = ref(1)
const busy = ref(false)
const error = ref('')
const booking = ref(null)
const scroller = ref(null)

// ---------------------------------------------------------------- step 1
const at10 = (iso, addDays = 0) => {
  const d = iso ? new Date(`${iso}T10:00:00`) : new Date()
  if (!iso) d.setHours(10, 0, 0, 0)
  d.setDate(d.getDate() + addDays)
  return toLocalInput(d)
}
const pickupAt = ref(props.dates ? at10(props.dates.from) : at10(null, 1))
const returnAt = ref(props.dates ? at10(props.dates.to) : at10(null, 3))
const fulfillment = ref('BRANCH_PICKUP')
const quote = ref(null)
const deliveryNotes = ref('')
const notes = ref('')
const c = ref({
  fullName: auth.me?.fullName ?? '',
  phone: auth.me?.phone ?? '',
  countryCode: 'TH',
  idType: 'NATIONAL_ID',
  idNumber: '',
  dateOfBirth: '',
  address: '',
  licenseNumber: '',
  licenseCountry: 'TH',
  licenseExpiry: '',
})
const decl = ref({ hasOriginalLicense: false, infoMatchesLicense: false })
// The shop's chat form: where the car is used, where the renter stays, Facebook / IG.
const realEmail = (e) => (e && !/@(line\.coolkids\.invalid|coolkids\.local)$/i.test(e) ? e : '')
const use = ref({ areaOfUse: t('bk.areaDefault'), stayLocation: '', socialUrl: '', rentalPurpose: 'TRAVEL', contactEmail: realEmail(auth.me?.email) })

const COUNTRIES = ['TH', 'CN', 'JP', 'KR', 'MY', 'SG', 'IN', 'VN', 'LA', 'MM', 'KH', 'ID', 'PH', 'HK', 'TW', 'US', 'GB', 'DE', 'FR', 'IT', 'NL', 'RU', 'AU', 'CA']
function onCountry() {
  c.value.idType = c.value.countryCode === 'TH' ? 'NATIONAL_ID' : 'PASSPORT'
  if (c.value.licenseCountry === 'TH' && c.value.countryCode !== 'TH') c.value.licenseCountry = c.value.countryCode
}

const days = computed(() => {
  const ms = new Date(returnAt.value) - new Date(pickupAt.value)
  return ms > 0 ? Math.max(1, Math.ceil((ms - 59 * 60_000) / 86_400_000)) : 0
})
const v = computed(() => props.vehicle)
const daily = computed(() => {
  if (!v.value) return 0
  const p = v.value.price
  const promoOk = p.discountedDailyMinor != null && (!v.value.promotion?.minRentalDays || days.value >= v.value.promotion.minRentalDays)
  return promoOk ? p.discountedDailyMinor : p.dailyMinor
})
// This car's delivery fee as staff set it on the fleet form (shop default otherwise).
const deliveryText = computed(() => {
  const p = v.value?.delivery
  if (!p) return t('common.byDistance')
  return p.freeKm ? t('common.freeKm', { km: p.freeKm, price: p.perKmMinor / 100 }) : t('common.perKm', { price: p.perKmMinor / 100 })
})
const deliveryFee = computed(() => (fulfillment.value === 'DELIVERY' ? (quote.value?.feeMinor ?? 0) : 0))
const estimate = computed(() => daily.value * days.value + deliveryFee.value)
const currency = computed(() => v.value?.price.currency ?? booking.value?.money.currency ?? 'THB')

const thaiIdOk = computed(() => c.value.idType !== 'NATIONAL_ID' || c.value.countryCode !== 'TH' || /^\d{13}$/.test(c.value.idNumber.replace(/[\s-]/g, '')))
// Everything still missing or wrong on the details form, in form order, so the
// customer is told exactly what to fix instead of facing a dead button.
const problems = computed(() => {
  const out = {}
  const add = (key, msg) => (out[key] ??= msg)
  const blank = (v, min) => v.trim().length < min
  if (days.value <= 0) add('returnAt', t('bk.p.returnAt'))
  if (fulfillment.value === 'DELIVERY' && !quote.value) add('delivery', t('bk.p.delivery'))
  if (blank(c.value.fullName, 2)) add('fullName', t('bk.p.fullName'))
  if (blank(c.value.phone, 1)) add('phone', t('bk.p.phone'))
  else if (!/^\+?[0-9 ()-]{6,20}$/.test(c.value.phone.trim())) add('phone', t('bk.p.phoneBad'))
  if (blank(c.value.idNumber, 1)) add('idNumber', t(c.value.idType === 'PASSPORT' ? 'bk.p.passport' : 'bk.p.idNumber'))
  else if (blank(c.value.idNumber, 5)) add('idNumber', t('bk.p.idShort'))
  else if (!thaiIdOk.value) add('idNumber', t('bk.p.thaiId'))
  if (!c.value.dateOfBirth) add('dateOfBirth', t('bk.p.dob'))
  if (blank(c.value.address, 5)) add('address', t('bk.p.address'))
  if (blank(c.value.licenseNumber, 4)) add('licenseNumber', t('bk.p.licenceNo'))
  if (!c.value.licenseExpiry) add('licenseExpiry', t('bk.p.expiry'))
  if (!decl.value.hasOriginalLicense) add('hasOriginalLicense', t('bk.p.hasOriginal'))
  if (!decl.value.infoMatchesLicense) add('infoMatchesLicense', t('bk.p.matches'))
  if (blank(use.value.areaOfUse, 2)) add('areaOfUse', t('bk.p.area'))
  if (blank(use.value.socialUrl, 2)) add('socialUrl', t('bk.p.social'))
  if (blank(use.value.stayLocation, 3)) add('stayLocation', t('bk.p.stay'))
  if (use.value.contactEmail.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(use.value.contactEmail.trim())) add('contactEmail', t('bk.p.email'))
  return out
})
const missing = computed(() => Object.entries(problems.value).map(([key, msg]) => ({ key, msg })))
const step1Ready = computed(() => missing.value.length === 0)
// Fields turn red only after the first "ดำเนินการต่อ" press, not while the customer is still typing.
const tried = ref(false)
const bad = (key) => tried.value && Boolean(problems.value[key])

function goTo(key) {
  const el = scroller.value?.querySelector(`[data-field="${key}"]`)
  if (!el) return
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  el.querySelector('input, select, textarea')?.focus({ preventScroll: true })
}

function explain(err) {
  const details = err.details ? Object.values(err.details).flat().filter((m) => typeof m === 'string') : []
  return errorText(err, details.length ? details.join(' · ') : undefined)
}

// The rental terms pop up as soon as a new booking starts (choosing a car) and
// must be read and accepted once; the booking records the language they were read in.
const termsLocale = ref(null) // language the customer accepted them in
const showTerms = ref(false)
function onTermsAccepted(lang) {
  termsLocale.value = lang
  showTerms.value = false
  if (step1Ready.value) submitDetails() // popped up from "ดำเนินการต่อ": carry on
}

async function submitDetails() {
  if (busy.value) return
  if (!step1Ready.value) {
    tried.value = true
    goTo(missing.value[0].key)
    return
  }
  if (!termsLocale.value) {
    showTerms.value = true
    return
  }
  busy.value = true
  error.value = ''
  try {
    booking.value = await createBooking({
      vehicleSlug: v.value.slug,
      pickupAt: new Date(pickupAt.value).toISOString(),
      returnAt: new Date(returnAt.value).toISOString(),
      fulfillment: fulfillment.value,
      ...(fulfillment.value === 'DELIVERY'
        ? { delivery: { placeId: quote.value.placeId ?? undefined, address: quote.value.address, lat: quote.value.lat, lng: quote.value.lng, notes: deliveryNotes.value || undefined } }
        : {}),
      notes: notes.value || undefined,
      areaOfUse: use.value.areaOfUse.trim(),
      stayLocation: use.value.stayLocation.trim(),
      socialUrl: use.value.socialUrl.trim(),
      rentalPurpose: use.value.rentalPurpose,
      termsLocale: termsLocale.value,
      contactEmail: use.value.contactEmail.trim() || undefined,
      customer: { ...c.value, fullName: c.value.fullName.trim(), phone: c.value.phone.trim(), idNumber: c.value.idNumber.trim(), licenseNumber: c.value.licenseNumber.trim() },
      declarations: { hasOriginalLicense: true, infoMatchesLicense: true },
    })
    await afterDetails()
  } catch (err) {
    error.value = explain(err)
  } finally {
    busy.value = false
  }
}

// ---------------------------------------------------------------- map pins
// "📍 แผนที่" next to an address field: drop a pin, the address text comes back.
// The stay location also keeps a Google Maps link so staff can navigate to it.
const picker = ref(null) // 'address' | 'stayLocation'
const pins = ref({})
const mapsLink = ({ lat, lng }) => `https://maps.google.com/?q=${lat},${lng}`
function onPick({ address, lat, lng }) {
  const field = picker.value
  pins.value = { ...pins.value, [field]: { lat, lng } }
  if (field === 'address') c.value.address = address.slice(0, 300)
  else use.value.stayLocation = `${address.slice(0, 300 - 60)} · ${mapsLink({ lat, lng })}`
}

// ---------------------------------------------------------------- step 2
// Photos go to private storage right away; staff see them once the booking is sent.
const onDocs = (documents) => (booking.value = { ...booking.value, documents })
async function afterDetails() {
  const review = booking.value.review?.status
  step.value = review === 'SUBMITTED' || review === 'APPROVED' ? 3 : 2
  await nextTick()
  scroller.value?.scrollTo({ top: 0 })
}

async function submit() {
  if (!booking.value?.documents?.complete || busy.value) return
  busy.value = true
  error.value = ''
  try {
    booking.value = await submitForReview(booking.value.number)
    step.value = 3
    scroller.value?.scrollTo({ top: 0 })
  } catch (err) {
    error.value = explain(err)
  } finally {
    busy.value = false
  }
}

// ---------------------------------------------------------------- step 3
const holdLeft = ref('')
let holdTimer
function tickHold() {
  const until = booking.value?.holdExpiresAt
  if (!until) return (holdLeft.value = '')
  const s = Math.max(0, Math.floor((new Date(until) - Date.now()) / 1000))
  holdLeft.value = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const fmt = (iso) => fmtDate(iso)

// The page behind the popup must not scroll too (it showed a second scrollbar).
let pageOverflow = ''
onMounted(async () => {
  pageOverflow = document.documentElement.style.overflow
  document.documentElement.style.overflow = 'hidden'
  dialog.value.showModal()
  // A new booking starts with the rental terms: read to the end and accept before the form.
  if (!props.resumeNumber) showTerms.value = true
  holdTimer = setInterval(tickHold, 1000)
  if (props.resumeNumber) {
    busy.value = true
    try {
      booking.value = await getBooking(props.resumeNumber)
      await afterDetails()
    } catch (err) {
      error.value = explain(err)
    } finally {
      busy.value = false
    }
  }
})

onBeforeUnmount(() => (document.documentElement.style.overflow = pageOverflow))

function close() {
  clearInterval(holdTimer)
  dialog.value?.close()
  emit('close', booking.value)
}

const STEPS = computed(() => t('bk.steps'))
const HEADS = { 1: ['car', 'bk.head1'], 2: ['camera', 'bk.head2'], 3: ['check', 'bk.head3'] }
</script>

<template>
  <dialog ref="dialog" class="bk" aria-labelledby="bk-title" @cancel.prevent="close">
    <div class="card">
      <header class="head">
        <div class="title">
          <Icon :name="HEADS[step][0]" :size="20" />
          <h2 id="bk-title">
            {{ t(HEADS[step][1]) }}
            <small v-if="v || booking">{{ v ? `${v.brand} ${v.model} ${v.trim ?? ''}` : `${booking.vehicle.brand} ${booking.vehicle.model}` }}</small>
          </h2>
        </div>
        <button type="button" class="x" :aria-label="t('common.close')" @click="close"><Icon name="x" :size="18" /></button>
      </header>
      <ol class="steps" :aria-label="t('bk.stepsLabel')">
        <li v-for="(s, i) in STEPS" :key="s" :class="{ on: step === i + 1, done: step > i + 1 }" :aria-current="step === i + 1 ? 'step' : undefined">
          <span>{{ step > i + 1 ? '✓' : i + 1 }}</span>{{ s }}
        </li>
      </ol>

      <div ref="scroller" class="body">
        <!-- 1. details -->
        <form v-if="step === 1 && v" id="bk-details" class="details" novalidate @submit.prevent="submitDetails">
          <section>
            <h3>{{ t('bk.period') }}</h3>
            <div class="row2">
              <label class="f"><span>{{ t('bk.pickupAt') }}</span><input v-model="pickupAt" type="datetime-local" required /></label>
              <label class="f" data-field="returnAt" :class="{ bad: bad('returnAt') }"><span>{{ t('bk.returnAt') }}</span><input v-model="returnAt" type="datetime-local" required :min="pickupAt" /><em v-if="bad('returnAt')" class="why">{{ problems.returnAt }}</em></label>
            </div>
          </section>

          <section>
            <h3>{{ t('bk.method') }}</h3>
            <div class="choice">
              <label :class="{ on: fulfillment === 'BRANCH_PICKUP' }">
                <input v-model="fulfillment" type="radio" value="BRANCH_PICKUP" />
                <Icon name="pin" :size="18" />
                <span><strong>{{ t('bk.branch') }}</strong><small>{{ v.homeLocation?.name ? tx(v.homeLocation.name) : t('bk.branchDefault') }} · {{ t('common.free') }}</small></span>
              </label>
              <label :class="{ on: fulfillment === 'DELIVERY' }">
                <input v-model="fulfillment" type="radio" value="DELIVERY" />
                <Icon name="car" :size="18" />
                <span><strong>{{ t('bk.delivery') }}</strong><small>{{ deliveryText }}</small></span>
              </label>
            </div>
            <template v-if="fulfillment === 'DELIVERY'">
              <div data-field="delivery" :class="{ 'bad-box': bad('delivery') }">
                <AddressSearch :quote="quote" :vehicle-slug="v.slug" :policy="v.delivery" @quote="quote = $event" />
                <em v-if="bad('delivery')" class="why">{{ problems.delivery }}</em>
              </div>
              <label class="f"><span>{{ t('bk.driverNotes') }} <small>({{ t('common.optional') }})</small></span><input v-model="deliveryNotes" type="text" maxlength="300" :placeholder="t('bk.driverNotesPh')" /></label>
            </template>
          </section>

          <section>
            <h3>{{ t('bk.renter') }}</h3>
            <div class="row2">
              <label class="f" data-field="fullName" :class="{ bad: bad('fullName') }"><span>{{ t('bk.fullName') }}</span><input v-model="c.fullName" type="text" autocomplete="name" required /><em v-if="bad('fullName')" class="why">{{ problems.fullName }}</em></label>
              <label class="f" data-field="phone" :class="{ bad: bad('phone') }"><span>{{ t('bk.phone') }}</span><input v-model="c.phone" type="tel" autocomplete="tel" inputmode="tel" required placeholder="08x-xxx-xxxx / +66…" /><em v-if="bad('phone')" class="why">{{ problems.phone }}</em></label>
            </div>
            <div class="row3">
              <label class="f">
                <span>{{ t('bk.nationality') }}</span>
                <select v-model="c.countryCode" @change="onCountry">
                  <option v-for="code in COUNTRIES" :key="code" :value="code">{{ countryName(code) }}</option>
                </select>
              </label>
              <label class="f">
                <span>{{ t('bk.document') }}</span>
                <select v-model="c.idType">
                  <option value="NATIONAL_ID">{{ t('bk.idCard') }}</option>
                  <option value="PASSPORT">{{ t('bk.passport') }}</option>
                </select>
              </label>
              <label class="f" data-field="idNumber" :class="{ bad: bad('idNumber') }">
                <span>{{ t(c.idType === 'PASSPORT' ? 'bk.passportNo' : 'bk.idNo') }}</span>
                <input v-model="c.idNumber" type="text" autocomplete="off" required :aria-invalid="bad('idNumber') || (c.idNumber !== '' && !thaiIdOk)" :inputmode="c.idType === 'NATIONAL_ID' ? 'numeric' : 'text'" />
                <em v-if="bad('idNumber')" class="why">{{ problems.idNumber }}</em>
              </label>
            </div>
            <div class="row2">
              <label class="f" data-field="dateOfBirth" :class="{ bad: bad('dateOfBirth') }"><span>{{ t('bk.dob') }}</span><input v-model="c.dateOfBirth" type="date" required autocomplete="bday" /><em v-if="bad('dateOfBirth')" class="why">{{ problems.dateOfBirth }}</em></label>
              <label class="f" data-field="address" :class="{ bad: bad('address') }"><span>{{ t('bk.address') }}</span><span class="with-map"><input v-model="c.address" type="text" autocomplete="street-address" required /><button type="button" class="map-btn" :aria-label="t('bk.addressMap')" @click="picker = 'address'"><Icon name="pin" :size="16" /> {{ t('common.map') }}</button></span><em v-if="bad('address')" class="why">{{ problems.address }}</em></label>
            </div>
          </section>

          <section>
            <h3>{{ t('bk.licence') }}</h3>
            <div class="row3">
              <label class="f" data-field="licenseNumber" :class="{ bad: bad('licenseNumber') }"><span>{{ t('bk.licenceNo') }}</span><input v-model="c.licenseNumber" type="text" autocomplete="off" required /><em v-if="bad('licenseNumber')" class="why">{{ problems.licenseNumber }}</em></label>
              <label class="f">
                <span>{{ t('bk.issuedIn') }}</span>
                <select v-model="c.licenseCountry">
                  <option v-for="code in COUNTRIES" :key="code" :value="code">{{ countryName(code) }}</option>
                </select>
              </label>
              <label class="f" data-field="licenseExpiry" :class="{ bad: bad('licenseExpiry') }"><span>{{ t('bk.expiry') }}</span><input v-model="c.licenseExpiry" type="date" required /><em v-if="bad('licenseExpiry')" class="why">{{ problems.licenseExpiry }}</em></label>
            </div>
            <p class="hint">{{ t('bk.idpHint') }}</p>
            <label class="check" data-field="hasOriginalLicense" :class="{ bad: bad('hasOriginalLicense') }"><input v-model="decl.hasOriginalLicense" type="checkbox" /> {{ t('bk.hasOriginal') }}</label>
            <label class="check" data-field="infoMatchesLicense" :class="{ bad: bad('infoMatchesLicense') }"><input v-model="decl.infoMatchesLicense" type="checkbox" /> {{ t('bk.matches') }}</label>
          </section>

          <section>
            <h3>{{ t('bk.rental') }}</h3>
            <div class="row2">
              <label class="f" data-field="areaOfUse" :class="{ bad: bad('areaOfUse') }"><span>{{ t('bk.area') }}</span><input v-model="use.areaOfUse" type="text" maxlength="120" required :placeholder="t('bk.areaPh')" /><em v-if="bad('areaOfUse')" class="why">{{ problems.areaOfUse }}</em></label>
              <label class="f" data-field="socialUrl" :class="{ bad: bad('socialUrl') }"><span>{{ t('bk.social') }}</span><input v-model="use.socialUrl" type="text" maxlength="300" required autocomplete="url" :placeholder="t('bk.socialPh')" /><em v-if="bad('socialUrl')" class="why">{{ problems.socialUrl }}</em></label>
            </div>
            <label class="f" data-field="stayLocation" :class="{ bad: bad('stayLocation') }"><span>{{ t('bk.stay') }}</span><span class="with-map"><input v-model="use.stayLocation" type="text" maxlength="300" required :placeholder="t('bk.stayPh')" /><button type="button" class="map-btn" :aria-label="t('bk.stayMap')" @click="picker = 'stayLocation'"><Icon name="pin" :size="16" /> {{ t('common.map') }}</button></span><em v-if="bad('stayLocation')" class="why">{{ problems.stayLocation }}</em></label>
            <label class="f" data-field="contactEmail" :class="{ bad: bad('contactEmail') }"><span>{{ t('bk.email') }} <small>({{ t('bk.emailHint') }})</small></span><input v-model="use.contactEmail" type="email" autocomplete="email" maxlength="254" placeholder="you@example.com" /><em v-if="bad('contactEmail')" class="why">{{ problems.contactEmail }}</em></label>
            <div class="choice">
              <label :class="{ on: use.rentalPurpose === 'TRAVEL' }"><input v-model="use.rentalPurpose" type="radio" value="TRAVEL" /><span><strong>{{ t('bk.travel') }}</strong></span></label>
              <label :class="{ on: use.rentalPurpose === 'REPLACEMENT' }"><input v-model="use.rentalPurpose" type="radio" value="REPLACEMENT" /><span><strong>{{ t('bk.replacement') }}</strong><small>{{ t('bk.replacementHint') }}</small></span></label>
            </div>
          </section>

          <section>
            <label class="f"><span>{{ t('bk.notes') }} <small>({{ t('common.optional') }})</small></span><textarea v-model="notes" rows="2" maxlength="500" /></label>
          </section>
          <p class="hint">{{ t('bk.pdpa') }}</p>
        </form>

        <!-- 2. identity documents -->
        <div v-else-if="step === 2 && booking?.documents" class="docs-step">
          <p v-if="booking.review?.status === 'CHANGES_REQUESTED'" class="changes" role="alert">
            <Icon name="receipt" :size="15" /> {{ t('bk.changes', { note: booking.review.note }) }}
          </p>
          <p class="lead">{{ t('bk.docsLead', { number: booking.number }) }}</p>
          <IdentityDocuments :number="booking.number" :documents="booking.documents" @updated="onDocs" />
        </div>

        <!-- 3. sent for review -->
        <div v-else-if="step === 3 && booking" class="sent">
          <span class="badge"><Icon name="check" :size="26" /></span>
          <h3>{{ t('bk.sentTitle') }}</h3>
          <p>{{ t('bk.sentBody', { fee: money(booking.money.dueNowMinor, booking.money.currency) }) }}</p>
          <dl class="sum">
            <div><dt>{{ t('bk.number') }}</dt><dd>{{ booking.number }}</dd></div>
            <div><dt>{{ t('bk.car') }}</dt><dd>{{ booking.vehicle.brand }} {{ booking.vehicle.model }} {{ booking.vehicle.trim }}</dd></div>
            <div><dt>{{ t('bk.pickup') }}</dt><dd>{{ fmt(booking.pickupAt) }}</dd></div>
            <div><dt>{{ t('bk.return') }}</dt><dd>{{ fmt(booking.returnAt) }} · {{ t('common.days', { n: booking.rentalDays }) }}</dd></div>
          </dl>
          <p v-if="holdLeft" class="hold"><Icon name="clock" :size="14" /> {{ t('bk.hold') }}</p>
        </div>
        <div v-else-if="busy" class="loading"><span class="spinner" /></div>
      </div>

      <footer class="foot">
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <template v-if="step === 1 && v">
          <div v-if="tried && missing.length" class="missing" role="alert">
            <strong>{{ t('bk.missing', { n: missing.length }) }}</strong>
            <ul>
              <li v-for="m in missing.slice(0, 3)" :key="m.key"><button type="button" @click="goTo(m.key)">{{ m.msg }}</button></li>
              <li v-if="missing.length > 3" class="more">{{ t('bk.more', { n: missing.length - 3 }) }}</li>
            </ul>
          </div>
          <div class="est">
            <small>{{ t('common.days', { n: days }) }} × {{ money(daily, currency) }}<template v-if="deliveryFee"> + {{ t('bk.deliveryFee') }} {{ money(deliveryFee, currency) }}</template></small>
            <strong>{{ money(estimate, currency) }}</strong>
          </div>
          <button type="submit" form="bk-details" class="primary" :disabled="busy">
            <span v-if="!busy">{{ t('bk.continue') }}</span><span v-else class="spinner" />
          </button>
        </template>
        <template v-else-if="step === 2 && booking?.documents">
          <button type="button" class="primary wide" :disabled="!booking.documents.complete || busy" @click="submit">
            <span v-if="busy" class="spinner" />
            <template v-else>{{ t(booking.documents.complete ? 'bk.send' : 'bk.needDocs') }}</template>
          </button>
        </template>
        <template v-else-if="step === 3">
          <button type="button" class="primary wide" @click="close">{{ t('bk.viewStatus') }}</button>
        </template>
      </footer>
    </div>
    <TermsPopup v-if="showTerms" @accept="onTermsAccepted" />
    <MapPicker
      v-if="picker"
      :title="t(picker === 'address' ? 'bk.addressMap' : 'bk.stayMap')"
      :start="pins[picker]"
      @pick="onPick"
      @close="picker = null"
    />
  </dialog>
</template>

<style scoped>
.bk {
  --accent: #e2362c;
  border: 0;
  padding: 0;
  overflow: hidden; /* only the body scrolls: no second scrollbar on the dialog itself */
  width: min(760px, calc(100vw - 24px));
  max-height: calc(100dvh - 24px);
  background: transparent;
  color: #121319;
  color-scheme: light;
}
.bk::backdrop {
  background: rgb(8 9 12 / 0.6);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
}
.card {
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - 24px);
  border-radius: 24px;
  background: #fff;
  box-shadow: 0 30px 80px -30px rgb(0 0 0 / 0.5);
  overflow: hidden;
  animation: rise var(--dur-slow) var(--ease-out);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 22px 10px;
}
.title {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--accent);
}
h2 {
  display: grid;
  font-family: var(--font-body);
  font-size: 1.1rem;
  font-weight: 700;
  color: #121319;
  letter-spacing: 0;
}
h2 small {
  font-weight: 400;
  font-size: 0.8rem;
  color: #6b6e7a;
}
.x {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 1px solid #e3e4e8;
  border-radius: 50%;
  background: #fff;
  cursor: pointer;
}
.steps {
  display: flex;
  gap: 6px;
  margin: 0;
  padding: 0 22px 14px;
  list-style: none;
  border-bottom: 1px solid #ececee;
  font-size: 0.8rem;
  color: #8d909b;
}
.steps li {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
}
.steps li:not(:last-child)::after {
  content: '';
  flex: 1;
  height: 2px;
  margin-left: 6px;
  background: #ececee;
  border-radius: 2px;
}
.steps span {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #ececee;
  font-weight: 700;
  font-size: 0.72rem;
  color: #6b6e7a;
}
.steps .on {
  color: #121319;
  font-weight: 600;
}
.steps .on span,
.steps .done span {
  background: var(--accent);
  color: #fff;
}
.steps .done::after {
  background: var(--accent) !important;
}
.body {
  flex: 1;
  overflow-y: auto;
  padding: 18px 22px;
  scrollbar-width: thin;
}
.details {
  display: grid;
  gap: 18px;
}
section {
  display: grid;
  gap: 10px;
}
h3 {
  font-family: var(--font-body);
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: 0;
}
h3 i,
.check i {
  font-weight: 400;
  color: #8d909b;
  font-size: 0.85em;
}
.row2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.row3 {
  display: grid;
  grid-template-columns: 1fr 1fr 1.3fr;
  gap: 10px;
}
.f {
  display: grid;
  gap: 5px;
  font-size: 0.78rem;
  color: #4b5060;
}
.f small {
  color: #8d909b;
}
.f input,
.f select,
.f textarea {
  width: 100%;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid #dcdee3;
  border-radius: 12px;
  background: #fff;
  color: #121319;
  font: inherit;
  font-size: 0.95rem;
}
.f input:focus-visible,
.f select:focus-visible,
.f textarea:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgb(226 54 44 / 0.15);
}
.f input[aria-invalid='true'] {
  border-color: #c22a21;
}
.f.bad > span:first-child {
  color: #c22a21;
}
.with-map {
  display: flex;
  gap: 6px;
}
.with-map input {
  flex: 1;
  min-width: 0;
}
.map-btn {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid #dcdee3;
  border-radius: 12px;
  background: #fff5f4;
  color: #c22a21;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
}
.map-btn:focus-visible {
  outline: 3px solid rgb(226 54 44 / 0.3);
}
.f.bad input,
.f.bad select,
.f.bad textarea {
  border-color: #c22a21;
  background: #fff7f6;
}
.why {
  color: #c22a21;
  font-size: 0.75rem;
  font-style: normal;
}
.check.bad {
  color: #c22a21;
}
.bad-box :deep(input) {
  border-color: #c22a21;
}
.missing {
  grid-column: 1 / -1;
  padding: 10px 12px;
  border-radius: 12px;
  background: #fdecea;
  color: #a3241b;
  font-size: 0.8rem;
}
.missing ul {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
}
.missing .more {
  align-self: center;
}
.missing button {
  padding: 4px 10px;
  border: 1px solid #f3b5af;
  border-radius: 999px;
  background: #fff;
  color: #a3241b;
  font: inherit;
  cursor: pointer;
}
.choice {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.choice label {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border: 1.5px solid #dcdee3;
  border-radius: 14px;
  cursor: pointer;
}
.choice label.on {
  border-color: var(--accent);
  background: #fff6f5;
}
.choice input {
  position: absolute;
  opacity: 0;
}
.choice span {
  display: grid;
}
.choice small {
  color: #6b6e7a;
  font-size: 0.75rem;
}
.check {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 0.85rem;
  cursor: pointer;
}
.check input {
  width: 18px;
  height: 18px;
  margin-top: 2px;
  accent-color: var(--accent);
  flex: none;
}
.hint {
  font-size: 0.75rem;
  color: #6b6e7a;
}
.foot {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 14px 22px 18px;
  border-top: 1px solid #ececee;
  background: #fafaf9;
}
.foot .error,
.foot .wide {
  grid-column: 1 / -1;
}
.est {
  display: grid;
}
.est small {
  color: #6b6e7a;
  font-size: 0.78rem;
}
.est strong {
  font-family: var(--font-display);
  font-size: 1.4rem;
  font-weight: 500;
}
.primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 50px;
  padding: 0 26px;
  border: 0;
  border-radius: 14px;
  background: var(--accent);
  color: #fff;
  font-weight: 700;
  font-size: 1rem;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}
.primary:hover:not(:disabled) {
  background: #c22a21;
}
.primary:disabled {
  background: #b9bbc2;
  cursor: not-allowed;
}
.error {
  padding: 10px 12px;
  border-radius: 10px;
  background: #fdeceb;
  color: #a3221a;
  font-size: 0.85rem;
}
.docs-step {
  display: grid;
  gap: 12px;
}
.docs-step .lead {
  color: #4b5060;
  font-size: 0.9rem;
}
.changes {
  display: flex;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 12px;
  background: #fdf3e2;
  color: #8a5a12;
  font-size: 0.9rem;
}
.sent {
  display: grid;
  justify-items: center;
  gap: 12px;
  padding: 12px 0;
  text-align: center;
}
.sent .badge {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #e6f6ee;
  color: #1f8a56;
}
.sent h3 {
  font-size: 1.2rem;
}
.sent p {
  max-width: 46ch;
  color: #4b5060;
}
.sent .sum {
  justify-self: stretch;
  text-align: left;
}
.sum {
  display: grid;
  gap: 6px;
  margin: 0;
}
.sum div {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 8px;
  font-size: 0.9rem;
}
.sum dt {
  color: #6b6e7a;
}
.sum dd {
  margin: 0;
  font-weight: 500;
}
.hold {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  font-size: 0.8rem;
  color: #4b5060;
}
.hold b {
  color: var(--accent);
}
.loading {
  display: grid;
  place-items: center;
  min-height: 200px;
}
.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid rgb(255 255 255 / 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.loading .spinner {
  border-color: #ececee;
  border-top-color: var(--accent);
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.98);
  }
}
@media (max-width: 640px) {
  .row2,
  .row3,
  .choice {
    grid-template-columns: 1fr;
  }
  .head,
  .body,
  .foot {
    padding-inline: 16px;
  }
  .steps {
    padding-inline: 16px;
    font-size: 0.72rem;
  }
  .foot {
    grid-template-columns: 1fr;
  }
}
</style>
