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

/** Milligrams → grams with up to 3 decimals, e.g. 25400 → "25.4 g". */
export const formatGrams = (mg: number) => `${(mg / 1000).toLocaleString('en-IN')} g`

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
export function monthName(month: string, short = false): string {
  const [year, number] = month.split('-')
  const name = MONTHS[Number(number) - 1]
  return short ? name : `${name} ${year}`
}
