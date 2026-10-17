const dateFormat = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC', // business dates are plain dates; don't shift them
})

/** "2026-01-14" → "14 Jan 2026". */
export const formatDate = (isoDate: string) => dateFormat.format(new Date(`${isoDate}T00:00:00Z`))

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
