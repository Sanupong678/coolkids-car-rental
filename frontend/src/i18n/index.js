import { ref, watch } from 'vue'
import base from './messages'
import customer from './customer'

// Home-page copy (messages.js) + the customer pages (customer.js), per locale.
const messages = Object.fromEntries(
  Object.keys(base).map((code) => [code, { ...base[code], ...customer[code], cms: { ...base[code].cms, ...customer[code].cms } }]),
)

// Tiny i18n: one reactive locale shared by every component (no plugin needed).
//   const { t, tc, locale } = useI18n()
//   t('hero.cta')                        → string for the current locale
//   t('cat.from', { price: '฿990' })     → "{price}" placeholders filled in
//   tc(cmsText, 'nav.home')              → CMS copy in Thai, dictionary copy otherwise
//   tx(cmsText)                          → CMS copy, or its entry in the locale's `cms` table
// The CMS stores Thai only, so Thai keeps showing the admin-edited text and the
// other languages fall back to the dictionary.
export const LOCALES = [
  { code: 'th', label: 'ไทย', short: 'TH', html: 'th' },
  { code: 'en', label: 'English', short: 'EN', html: 'en' },
  { code: 'zh', label: '中文', short: '中', html: 'zh-Hans' },
]
const KEY = 'coolkids.locale'

function initial() {
  try {
    const saved = localStorage.getItem(KEY)
    if (LOCALES.some((l) => l.code === saved)) return saved
  } catch {
    /* storage blocked: fall through to the default */
  }
  return 'th'
}

export const locale = ref(typeof window === 'undefined' ? 'th' : initial())

if (typeof document !== 'undefined') {
  watch(
    locale,
    (code) => {
      document.documentElement.lang = LOCALES.find((l) => l.code === code)?.html ?? code
      try {
        localStorage.setItem(KEY, code)
      } catch {
        /* not persisted; fine */
      }
    },
    { immediate: true },
  )
}

function lookup(code, key) {
  return key.split('.').reduce((o, k) => (o == null ? o : o[k]), messages[code])
}

export function t(key, vars) {
  let s = lookup(locale.value, key) ?? lookup('th', key) ?? key
  if (vars && typeof s === 'string') s = s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')
  return s
}

export const tc = (cmsText, key, vars) => (locale.value === 'th' && cmsText ? cmsText : t(key, vars))

// Free CMS text (footer columns, addresses…): exact Thai string → translation
// from the locale's `cms` table, else the Thai original.
export const tx = (thai) => (locale.value === 'th' || !thai ? thai : (messages[locale.value]?.cms?.[thai] ?? thai))

export const setLocale = (code) => (locale.value = code)

// Dates, times and country names follow the chosen language too.
const INTL = { th: 'th-TH', en: 'en-GB', zh: 'zh-CN' }
export const intlLocale = () => INTL[locale.value] ?? 'th-TH'
export const fmtDate = (iso, opts = { dateStyle: 'medium', timeStyle: 'short' }) =>
  iso ? new Date(iso).toLocaleString(intlLocale(), { timeZone: 'Asia/Bangkok', ...opts }) : '—'
export function countryName(code) {
  try {
    return new Intl.DisplayNames([intlLocale()], { type: 'region' }).of(code)
  } catch {
    return code
  }
}

// Shop data (category names, equipment, car descriptions) is stored in Thai and edited by
// staff; other languages use the dictionary entry for that slug/code when there is one.
export const td = (key, thai) => (locale.value === 'th' ? thai : (lookup(locale.value, key) ?? thai))
export const catName = (cat) => (cat ? td(`cats.${cat.slug}`, cat.name) : '')
export const featName = (f) => td(`feat.${f.code}`, f.name)
export const carDesc = (v) => td(`desc.${v.slug}`, v.description)

// API errors: known codes get the customer's language; anything else keeps the server's text.
export function errorText(err, fallback) {
  const code = err?.code ?? (err instanceof TypeError ? 'NETWORK' : null)
  const own = code && lookup(locale.value, `err.${code}`)
  return own || fallback || err?.message || String(err)
}

export const useI18n = () => ({ t, tc, tx, td, locale, setLocale, LOCALES, fmtDate, countryName, intlLocale, errorText, catName, featName, carDesc })
