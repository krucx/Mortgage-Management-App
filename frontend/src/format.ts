const dateFormat = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC', // business dates are plain dates; don't shift them
})

/** "2026-01-14" → "14 Jan 2026". */
export const formatDate = (isoDate: string) => dateFormat.format(new Date(`${isoDate}T00:00:00Z`))

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

/** A ratio as a percentage with one decimal, e.g. 0.9561 → "95.6%". */
export const formatPercent = (ratio: number) =>
  `${(ratio * 100).toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`

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
