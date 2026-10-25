<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getContractPrint } from '@/api/admin'
import { CONTRACT_LANGS, CONTRACT_TEXT, fuelGroup } from '@/utils/contractI18n'

// Printable rental agreement on A4, laid out like the Coolkids paper contract
// "B-Rental-Agreement": page 1 = renter & vehicle details, declarations,
// inspection diagram, fees, money and four signature boxes; page 2 = the nine
// articles of terms. One language per print (?lang=th|en|zh). Blank boxes
// (guarantor, purpose, fuel level, damage marks) are filled in by hand at handover.
const route = useRoute()
const router = useRouter()

const lang = computed(() => (CONTRACT_TEXT[route.query.lang] ? route.query.lang : 'th'))
const t = computed(() => CONTRACT_TEXT[lang.value])
const data = ref(null)
const error = ref('')
let printed = false

const TZ = 'Asia/Bangkok'
const when = (iso) => {
  if (!iso) return ''
  const loc = CONTRACT_LANGS[lang.value]
  const date = new Date(iso).toLocaleDateString(loc, { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' })
  const time = new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
  return `${date} @ ${time}`
}
const num = (minor) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format((minor ?? 0) / 100)

const left = computed(() => {
  const d = data.value
  const f = t.value.fields
  return [
    [f.fullName, d.renter.fullName],
    [f.id, d.renter.idMasked],
    [f.license, d.renter.licenseMasked],
    [f.address, d.renter.address],
    [f.mobile, d.renter.phone],
    [f.pickup, when(d.rental.pickupAt)],
    [f.return, when(d.rental.returnAt)],
  ]
})
const right = computed(() => {
  const d = data.value
  const f = t.value.fields
  return [
    [f.guarantor, ''],
    [f.guarantorId, ''],
    [f.model, [d.vehicle.make, d.vehicle.model].filter(Boolean).join(' ').toUpperCase()],
    [f.plate, d.vehicle.plate],
    [f.area, d.rental.area],
  ]
})
const fuel = computed(() => fuelGroup(data.value?.vehicle.fuel))
const money = computed(() => {
  const m = data.value?.money ?? {}
  return {
    rental: num(m.rentalMinor - (m.discountMinor ?? 0)),
    delivery: num(m.deliveryMinor),
    deposit: num(m.depositMinor),
    total: num((m.totalMinor ?? 0) + (m.depositMinor ?? 0)),
  }
})
const docNo = computed(() => data.value?.contract?.number ?? data.value?.bookingNumber)

async function load() {
  try {
    data.value = await getContractPrint(route.params.id)
    document.title = `${docNo.value} — ${t.value.title}`
    await nextTick()
    await Promise.all([...document.querySelectorAll('.sheet img')].map((img) => (img.complete ? null : new Promise((r) => (img.onload = img.onerror = r)))))
    await document.fonts?.ready
    if (!printed && route.query.auto !== '0' && !embedded) {
      printed = true
      window.print()
    }
  } catch (err) {
    error.value = err.message
  }
}
onMounted(load)
watch(lang, () => data.value && (document.title = `${docNo.value} — ${t.value.title}`))

// Shown inside the back office's contract preview (iframe): that dialog has its own buttons.
const embedded = typeof window !== 'undefined' && window.self !== window.top
const setLang = (l) => router.replace({ query: { ...route.query, lang: l, auto: '0' } })
const doPrint = () => window.print()
const closeTab = () => window.close()
</script>

<template>
  <div class="print-root" :lang="lang">
    <div v-if="!embedded" class="toolbar no-print">
      <strong>พิมพ์สัญญาเช่า · A4</strong>
      <div class="langs" role="radiogroup" aria-label="ภาษา">
        <button v-for="[code, label] in [['th', 'ไทย'], ['en', 'English'], ['zh', '中文']]" :key="code" type="button" role="radio" :aria-checked="lang === code" :class="{ on: lang === code }" @click="setLang(code)">
          {{ label }}
        </button>
      </div>
      <button type="button" class="print" :disabled="!data" @click="doPrint">พิมพ์</button>
      <button type="button" class="close" @click="closeTab">ปิด</button>
    </div>
    <p v-if="error" class="err no-print">{{ error }}</p>

    <template v-if="data">
      <!-- ===================== page 1 ===================== -->
      <section class="sheet p1">
        <header class="head">
          <img class="logo" src="/brand/logo-dark.webp" alt="Coolkids Car Rental" />
          <div class="co">
            <strong>{{ data.company?.name }}</strong>
            <span>{{ data.company?.address }}</span>
            <span>{{ t.contact(data.company ?? {}) }}</span>
          </div>
          <div class="ttl">
            <h1>{{ t.title }}</h1>
            <em>{{ t.subtitle }}</em>
            <small>{{ t.no }} {{ docNo }}</small>
          </div>
        </header>

        <div class="info">
          <div class="col">
            <h2 class="pill">{{ t.infoTitle[0] }} <i v-if="t.infoTitle[1]">{{ t.infoTitle[1] }}</i></h2>
            <div v-for="[label, value] in left" :key="label[0]" class="row">
              <span class="lb"><b>{{ label[0] }}</b><i v-if="label[1]">{{ label[1] }}</i></span>
              <span class="box">{{ value }}</span>
            </div>
          </div>
          <div class="col">
            <div class="row exec">
              <span class="lb inline"><b>{{ t.executedAt[0] }}</b> <i v-if="t.executedAt[1]">{{ t.executedAt[1] }}</i></span>
              <span class="box">{{ data.rental.executedAt }}</span>
            </div>
            <div v-for="[label, value] in right" :key="label[0] + label[1]" class="row">
              <span class="lb"><b>{{ label[0] }}</b><i v-if="label[1]">{{ label[1] }}</i></span>
              <span class="box">{{ value }}</span>
            </div>
            <div class="row choice">
              <span class="lb"><b>{{ t.fields.fuel[0] }}</b><i v-if="t.fields.fuel[1]">{{ t.fields.fuel[1] }}</i></span>
              <span class="opts">
                <span v-for="(o, k) in t.fuelOptions" :key="k" class="opt">
                  <i class="dot" :class="{ on: fuel === k }" /><span><b>{{ o[0] }}</b><i v-if="o[1]">{{ o[1] }}</i></span>
                </span>
              </span>
            </div>
            <div class="row choice">
              <span class="lb"><b>{{ t.fields.purpose[0] }}</b><i v-if="t.fields.purpose[1]">{{ t.fields.purpose[1] }}</i></span>
              <span class="opts">
                <span v-for="(o, k) in t.purposeOptions" :key="k" class="opt">
                  <i class="dot" :class="{ on: data.rental.purpose === k }" /><span><b>{{ o[0] }}</b><i v-if="o[1]">{{ o[1] }}</i></span>
                </span>
              </span>
            </div>
          </div>
        </div>

        <div class="warn">
          <p class="strong">{{ t.warning[0] }}</p>
          <p v-if="t.warning[1]" class="en">{{ t.warning[1] }}</p>
        </div>
        <div v-for="q in t.questions" :key="q[0]" class="q">
          <span><b>{{ q[0] }}</b><i v-if="q[1]">{{ q[1] }}</i></span>
          <span class="yn">
            <span class="opt"><i class="dot" :class="{ on: data.declared }" /><span><b>{{ t.yes[0] }}</b><i v-if="t.yes[1]">{{ t.yes[1] }}</i></span></span>
            <span class="opt"><i class="dot" /><span><b>{{ t.no_[0] }}</b><i v-if="t.no_[1]">{{ t.no_[1] }}</i></span></span>
          </span>
        </div>

        <div class="mid">
          <div class="inspect">
            <p class="center"><b>{{ t.damage[0] }}</b><i v-if="t.damage[1]">{{ t.damage[1] }}</i></p>
            <img class="diagram" src="/contract/car-diagram.png" alt="" />
            <p class="advice"><span>{{ t.inspectAdvice[0] }}</span><i v-if="t.inspectAdvice[1]">{{ t.inspectAdvice[1] }}</i></p>
          </div>
          <div class="side">
            <figure class="fuel">
              <figcaption><b>{{ t.fuelLevel[0] }}</b><i v-if="t.fuelLevel[1]">{{ t.fuelLevel[1] }}</i></figcaption>
              <svg viewBox="0 0 120 70" width="88" height="51" aria-hidden="true">
                <path d="M12 62a48 48 0 0 1 96 0" fill="none" stroke="#a9c3d6" stroke-width="10" stroke-linecap="round" />
                <path d="M60 14v8M26 28l6 6M94 28l-6 6" stroke="#5f7d93" stroke-width="3" stroke-linecap="round" />
                <text x="6" y="69" font-size="11" fill="#5f7d93">E</text>
                <text x="107" y="69" font-size="11" fill="#5f7d93">F</text>
                <text x="51" y="40" font-size="11" fill="#5f7d93">1/2</text>
              </svg>
            </figure>
            <table class="fees">
              <caption>{{ t.feesTitle[0] }} <span v-if="t.feesTitle[1]">{{ t.feesTitle[1] }}</span></caption>
              <tbody>
                <tr v-for="[name, sub, price] in t.fees" :key="name">
                  <th>{{ name }}<small v-if="sub">{{ sub }}</small></th>
                  <td>
                    <template v-for="(line, i) in price.split('|')" :key="i"><span>{{ line }}</span></template>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="notice">
          <p><b class="lbl">{{ t.notice[0] }}</b> {{ t.notice[1] }}</p>
          <p v-if="t.notice[2]" class="en"><b class="lbl">{{ t.notice[2] }}</b> {{ t.notice[3] }}</p>
        </div>

        <div class="money">
          <div v-for="k in ['rental', 'deposit', 'delivery', 'total']" :key="k" class="m">
            <span class="lb"><b>{{ t.money[k][0] }}</b><i v-if="t.money[k][1]">{{ t.money[k][1] }}</i></span>
            <span class="box" :class="{ total: k === 'total' }">{{ money[k] }}</span>
            <span class="unit"><b>{{ t.money.unit[0] }}</b><i v-if="t.money.unit[1]">{{ t.money.unit[1] }}</i></span>
          </div>
        </div>
        <p class="agreed"><span>{{ t.agreed[0] }}</span> <i v-if="t.agreed[1]">{{ t.agreed[1] }}</i></p>

        <div class="signs">
          <div v-for="(label, i) in t.signs" :key="label" class="sig">
            <img v-if="i === 0 && data.signature" :src="data.signature" alt="" />
            <small>{{ label }}</small>
          </div>
        </div>
      </section>

      <!-- ===================== page 2 ===================== -->
      <section class="sheet p2">
        <img class="wm" src="/brand/logo-dark.webp" alt="" aria-hidden="true" />
        <h2 class="terms-title">{{ t.termsTitle[0] }}<span v-if="t.termsTitle[1]">{{ t.termsTitle[1] }}</span></h2>
        <div class="terms">
          <template v-for="[heading, items] in t.terms" :key="heading">
            <h3>{{ heading }}</h3>
            <p v-for="item in items" :key="item" :class="{ sub: /^[(（]/.test(item) }">{{ item }}</p>
          </template>
        </div>
        <footer class="band" aria-hidden="true">
          <span v-for="n in 3" :key="n">COOLKIDS CAR RENTAL-RENTAL AGREEMENT</span>
        </footer>
      </section>
    </template>
    <p v-else-if="!error" class="loading no-print">กำลังโหลดสัญญา…</p>
  </div>
</template>

<style scoped>
.print-root {
  --ink: #111318;
  --muted: #5a5f6b;
  --field: #efefef;
  --red: #e2362c;
  --pink: #fdeef0;
  --pink-line: #f4a9b3;
  --orange: #f08a12;
  min-height: 100dvh;
  padding: 72px 0 40px;
  background: #5b5f6a;
  color: var(--ink);
  font-family: 'IBM Plex Sans Thai', 'Inter', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif;
}
.toolbar {
  position: fixed;
  inset: 0 0 auto;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  background: #121319;
  color: #fff;
}
.toolbar strong {
  margin-right: auto;
  font-size: 0.95rem;
}
.langs {
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  border-radius: 999px;
  background: rgb(255 255 255 / 0.1);
}
.langs button {
  padding: 6px 14px;
  border: 0;
  border-radius: 999px;
  background: none;
  color: rgb(255 255 255 / 0.75);
  cursor: pointer;
}
.langs button.on {
  background: #ece7dc;
  color: #15171e;
  font-weight: 600;
}
.toolbar .print,
.toolbar .close {
  padding: 8px 18px;
  border: 0;
  border-radius: 10px;
  background: var(--red);
  color: #fff;
  font-weight: 600;
  cursor: pointer;
}
.toolbar .close {
  background: rgb(255 255 255 / 0.12);
}
.err,
.loading {
  text-align: center;
  color: #fff;
}

/* ---- A4 sheet */
.sheet {
  position: relative;
  width: 210mm;
  height: 297mm;
  margin: 0 auto 10mm;
  padding: 8mm 9mm 8mm;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 10px 40px rgb(0 0 0 / 0.35);
  font-size: 8pt;
  line-height: 1.25;
}
i {
  display: block;
  font-family: Georgia, 'Times New Roman', serif;
  font-style: italic;
  font-size: 0.82em;
  color: var(--muted);
}
b {
  font-weight: 700;
}
.head {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 3.5mm;
}
.logo {
  width: 32mm;
}
.co {
  display: grid;
  font-size: 6.6pt;
  color: #333;
}
.co strong {
  font-family: 'Unbounded', 'Inter', sans-serif;
  font-size: 12pt;
  letter-spacing: 0.02em;
  color: var(--ink);
}
.ttl {
  display: grid;
  justify-items: end;
  text-align: right;
}
.ttl h1 {
  font-size: 20pt;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0;
}
.ttl em {
  font-family: Georgia, serif;
  font-size: 8.5pt;
  color: var(--muted);
  letter-spacing: 0.04em;
}
.ttl small {
  font-size: 6.5pt;
  color: var(--muted);
}

/* details */
.info {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 6mm;
  margin-top: 3mm;
}
.col {
  display: grid;
  align-content: start;
  gap: 0.9mm;
}
.pill {
  margin: 0 0 1mm;
  padding: 1.4mm 3mm;
  border-radius: 1.6mm;
  background: #111;
  color: #fff;
  font-size: 8.2pt;
  white-space: nowrap;
  font-weight: 700;
  letter-spacing: 0;
}
.pill i {
  display: inline;
  color: #fff;
  font-size: 8pt;
}
.row {
  display: grid;
  grid-template-columns: 42mm 1fr;
  align-items: center;
  gap: 2mm;
}
.lb b {
  display: block;
  font-size: 8.6pt;
  line-height: 1.05;
}
.lb.inline b,
.lb.inline i {
  display: inline;
}
.box {
  min-height: 6mm;
  padding: 1.1mm 2.4mm;
  border-radius: 1.6mm;
  background: var(--field);
  font-size: 8pt;
  overflow-wrap: anywhere;
}
.row.exec {
  margin-top: 1mm;
  margin-bottom: 2.4mm;
}
.row.choice {
  grid-template-columns: 30mm 1fr;
}
.opts {
  display: flex;
  justify-content: space-between;
  gap: 2mm;
}
.opt {
  display: inline-flex;
  align-items: center;
  gap: 1.4mm;
  font-size: 7.4pt;
}
.opt b {
  display: block;
}
.dot {
  flex: none;
  display: inline-block;
  width: 4.6mm;
  height: 4.6mm;
  border: 0.3mm solid #c9c9c9;
  border-radius: 50%;
  background: #f4f4f4;
}
.dot.on {
  border-color: var(--ink);
  background: radial-gradient(circle, var(--ink) 0 38%, #fff 42%);
}

/* warning + questions */
.warn {
  margin-top: 2.4mm;
  padding: 1.8mm 4mm;
  border: 0.35mm solid var(--pink-line);
  border-left: 1.4mm solid var(--red);
  border-radius: 2mm;
  background: var(--pink);
  color: var(--red);
}
.warn .strong {
  margin: 0;
  font-weight: 700;
  font-size: 8.6pt;
}
.warn .en {
  margin: 0.8mm 0 0;
  font-family: Georgia, serif;
  font-style: italic;
  font-weight: 700;
  font-size: 7.4pt;
}
.q {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 1.6mm;
  padding: 1.3mm 4mm;
  border: 0.35mm solid var(--pink-line);
  border-radius: 2mm;
}
.q b {
  font-size: 8.6pt;
}
.yn {
  display: flex;
  gap: 4mm;
}

/* inspection + fees */
.mid {
  display: grid;
  grid-template-columns: 1fr 72mm;
  gap: 3mm;
  margin-top: 2.6mm;
}
.inspect {
  padding: 2mm 3mm;
  border-radius: 1.6mm;
  background: #f6f6f6;
}
.center {
  margin: 0;
  text-align: center;
  font-size: 7.2pt;
}
.diagram {
  display: block;
  width: 100%;
  max-width: 80mm;
  margin: 1mm auto;
  mix-blend-mode: multiply;
}
.advice {
  margin: 0;
  font-size: 6.8pt;
}
.advice i {
  color: var(--ink);
  font-weight: 700;
}
.side {
  display: grid;
  align-content: start;
  gap: 1mm;
}
.fuel {
  display: grid;
  grid-template-columns: auto auto;
  justify-content: center;
  align-items: start;
  gap: 4mm;
  margin: 0;
}
.fees {
  width: 100%;
  border-collapse: collapse;
  border: 1.2mm solid #000;
  font-size: 6.8pt;
}
.fees caption {
  padding: 1.2mm;
  background: #000;
  color: #fff;
  font-size: 9.5pt;
  font-weight: 700;
}
.fees caption span {
  font-family: Georgia, serif;
}
.fees th,
.fees td {
  padding: 0.45mm 1.6mm;
  line-height: 1.12;
  border-bottom: 0.25mm solid #cfcfcf;
  vertical-align: middle;
}
.fees th {
  text-align: left;
  font-weight: 600;
  border-right: 0.25mm solid #cfcfcf;
}
.fees th small {
  display: block;
  font-weight: 500;
  font-family: Georgia, serif;
}
.fees td {
  width: 27mm;
  text-align: right;
  font-weight: 600;
}
.fees td span {
  display: block;
}

/* notice, money, signatures */
.notice {
  margin-top: 2mm;
  padding: 1.6mm 4mm;
  border: 0.35mm solid #f7d58a;
  border-left: 1.4mm solid var(--orange);
  border-radius: 2mm;
  background: #fff8e6;
  color: var(--orange);
  font-size: 7.8pt;
}
.notice p {
  margin: 0;
}
.notice .lbl {
  color: var(--red);
}
.notice .en {
  margin-top: 0.8mm;
  font-family: Georgia, serif;
  font-style: italic;
  font-weight: 700;
  font-size: 7pt;
}
.money {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2mm 4mm;
  margin-top: 2.4mm;
}
.m {
  display: grid;
  grid-template-columns: 34mm 1fr 9mm;
  align-items: center;
  gap: 2mm;
}
.m .box {
  min-height: 7mm;
  border: 0.25mm solid #e1e1e1;
  background: #fff;
  font-size: 9pt;
  font-weight: 600;
}
.m .box.total {
  background: var(--field);
}
.unit b {
  display: block;
}
.agreed {
  margin: 1.6mm 0;
  font-size: 7pt;
}
.agreed i {
  color: var(--ink);
  font-weight: 700;
}
.signs {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 2.4mm;
}
.sig {
  position: relative;
  display: grid;
  place-items: center;
  height: 14mm;
  border: 0.25mm solid #dcdcdc;
  border-left: 1.2mm solid #555;
  border-radius: 1.6mm;
}
.sig img {
  max-width: 80%;
  max-height: 10mm;
}
.sig small {
  position: absolute;
  right: 2mm;
  bottom: 1.2mm;
  font-size: 5.4pt;
  color: var(--muted);
}

/* page 2 */
.wm {
  position: absolute;
  top: 45%;
  left: 50%;
  width: 190mm;
  transform: translate(-50%, -50%);
  opacity: 0.09;
  filter: grayscale(1);
  pointer-events: none;
}
.p2 {
  display: flex;
  flex-direction: column;
  padding-bottom: 0;
}
.terms-title {
  position: relative;
  margin: 2mm 0 3mm;
  text-align: center;
  font-size: 12pt;
  font-weight: 700;
  letter-spacing: 0;
}
.terms-title span {
  display: block;
  font-family: Georgia, serif;
  font-size: 11pt;
}
.terms {
  position: relative;
  flex: 1;
  font-size: 6pt;
  line-height: 1.27;
}
.print-root[lang='en'] .terms {
  font-size: 6.05pt;
}
.print-root[lang='zh'] .terms {
  font-size: 7pt;
  line-height: 1.4;
}
.terms h3 {
  margin: 1mm 0 0.2mm;
  font-size: 6.9pt;
  font-weight: 700;
  letter-spacing: 0;
}
.terms p {
  margin: 0 0 0.4mm;
  text-align: justify;
}
.terms p.sub {
  padding-left: 3mm;
}
.band {
  display: flex;
  justify-content: space-between;
  margin: 2mm -9mm 0;
  padding: 2mm 6mm;
  background: #000;
  color: #fff;
  font-size: 8pt;
  font-weight: 700;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

@media print {
  .print-root {
    padding: 0;
    background: none;
  }
  .no-print {
    display: none !important;
  }
  .sheet {
    margin: 0;
    box-shadow: none;
    break-after: page;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sheet:last-of-type {
    break-after: auto;
  }
}
</style>

<style>
@page {
  size: A4;
  margin: 0;
}
</style>
