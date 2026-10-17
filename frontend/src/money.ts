// Money is always held as integer paise (1 rupee = 100 paise) to avoid float drift.

const rupees = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const rupeesAndPaise = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Formats paise as INR with Indian digit grouping, e.g. 13600000 → "₹1,36,000". */
export function formatINR(paise: number): string {
  const sign = paise < 0 ? '-' : ''
  const absolute = Math.abs(paise)
  const formatter = absolute % 100 === 0 ? rupees : rupeesAndPaise
  return `${sign}₹${formatter.format(absolute / 100)}`
}

/** What the Lender types in rupees (e.g. "1234.5") → paise. */
export const rupeesToPaise = (rupees: string) => Math.round(Number(rupees) * 100)
