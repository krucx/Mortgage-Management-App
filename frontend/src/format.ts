import { formatINR } from './money'

const dateFormat = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC', // business dates are plain dates; don't shift them
})

/** "2026-01-14" → "14 Jan 2026". */
export const formatDate = (isoDate: string) => dateFormat.format(new Date(`${isoDate}T00:00:00Z`))

const dayMonthFormat = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

/** A Grace Payment's date, the date it was received and what it let off (ADR 0020),
 *  e.g. "6 Nov 2026 · received 8 Nov 2026 · Grace, ₹420 let off". */
export const formatGraceDate = (paidOn: string, receivedOn: string, letOff: number) =>
  `${formatDate(paidOn)} · received ${formatDate(receivedOn)} · Grace, ${formatINR(letOff)} let off`

/** "2026-03-15" → "15 Mar". */
export const formatDayMonth = (isoDate: string) =>
  dayMonthFormat.format(new Date(`${isoDate}T00:00:00Z`))

/** "2026-04-20T10:30:00" → "20 Apr 2026, 10:30" (a local date-time from the server). */
export const formatDateTime = (isoDateTime: string) =>
  `${formatDate(isoDateTime.slice(0, 10))}, ${isoDateTime.slice(11, 16)}`

/** Milligrams → grams with up to 3 decimals, e.g. 25400 → "25.4 grams". */
export const formatGrams = (mg: number) => `${(mg / 1000).toLocaleString('en-IN')} grams`

/** Today in the browser's time zone as YYYY-MM-DD. */
export function todayIso(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** A ratio as a percentage with up to one decimal (or `decimals`), e.g. 0.9561 → "95.6%". */
export const formatPercent = (ratio: number, decimals = 1) =>
  `${(ratio * 100).toLocaleString('en-IN', { maximumFractionDigits: decimals })}%`

/** The date `months` on from `isoDate` (YYYY-MM-DD), on the same day or, when that
 *  month is shorter, its last day: as Accrual Dates are. */
export function addMonths(isoDate: string, months: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const first = new Date(Date.UTC(year, month - 1 + months, 1))
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  first.setUTCDate(Math.min(day, lastDay))
  return first.toISOString().slice(0, 10)
}

/** The last Accrual Date of a Mortgage started on `start` (YYYY-MM-DD) on or before
 *  `on`; null before its first. */
export function lastAccrualDate(start: string, on: string): string | null {
  let last: string | null = null
  for (let n = 1; addMonths(start, n) <= on; n++) last = addMonths(start, n)
  return last
}

/** The days from one date (YYYY-MM-DD) to a later one. */
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-04" → "Apr 2026" (or just "Apr" when `short`). */
/** Whether `text` is a calendar month, YYYY-MM. */
export const isMonth = (text: string | null) => /^\d{4}-(0[1-9]|1[0-2])$/.test(text ?? '')

export function monthName(month: string, short = false): string {
  const [year, number] = month.split('-')
  const name = MONTHS[Number(number) - 1]
  return short ? name : `${name} ${year}`
}

/** A count with its noun, e.g. "1 Call Note", "2 Call Notes". */
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** A count of days, e.g. Interest to Date's "1 day", "30 days". */
export const formatDays = (n: number) => plural(n, 'day', 'days')

/** An Aadhaar Number as shown: only its last 4 digits, e.g. "XXXX XXXX 1234". */
export const maskedAadhaar = (last4: string) => `XXXX XXXX ${last4}`
