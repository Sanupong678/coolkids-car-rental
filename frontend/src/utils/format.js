// Display formatting only. Money arrives from the API in minor units.
import { t } from '@/i18n'

const moneyFormatters = new Map()

export function money(minor, currency = 'USD', { decimals = false } = {}) {
  if (minor == null) return '—'
  const key = `${currency}:${decimals}`
  if (!moneyFormatters.has(key)) {
    moneyFormatters.set(
      key,
      new Intl.NumberFormat(currency === 'THB' ? 'th-TH' : 'en-US', {
        style: 'currency',
        currency,
        minimumFractionDigits: decimals ? 2 : 0,
        maximumFractionDigits: decimals ? 2 : 0,
      }),
    )
  }
  return moneyFormatters.get(key).format(minor / 100)
}

/** "Promotion ends in 2 days" style countdown text. */
export function endsIn(iso, now = Date.now()) {
  const ms = new Date(iso).getTime() - now
  if (ms <= 0) return t('ends.over')
  const days = Math.floor(ms / 86_400_000)
  if (days >= 2) return t('ends.days', { n: days })
  const hours = Math.floor(ms / 3_600_000)
  if (hours >= 1) return t(hours > 1 ? 'ends.hours' : 'ends.hour', { n: hours })
  return t('ends.soon')
}

export const titleCase = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())

const LABELS = ['AUTOMATIC', 'MANUAL', 'PETROL', 'DIESEL', 'HYBRID', 'PLUG_IN_HYBRID', 'ELECTRIC']
export const label = (v) => (LABELS.includes(v) ? t(`lbl.${v}`) : /^[A-Z0-9]{2,3}$/.test(v) ? v : titleCase(v))

/** Whole rental days between two ISO instants (display estimate; server prices bookings). */
export function rentalDays(fromIso, toIso) {
  if (!fromIso || !toIso) return null
  const ms = new Date(toIso) - new Date(fromIso)
  if (!(ms > 0)) return null
  return Math.max(1, Math.ceil((ms - 59 * 60_000) / 86_400_000))
}

/** Responsive srcset from media.variants ({w480, w960, …}). */
export function srcset(variants) {
  if (!variants) return undefined
  return Object.entries(variants)
    .map(([k, url]) => `${url} ${k.slice(1)}w`)
    .join(', ')
}

export const toLocalInput = (d) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
