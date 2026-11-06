// The Calculator's inputs, as the Lender types them, and the rules on them; worked out
// as a Simulation by the backend.
import type { GoldRate, Purity, Simulation, SimulationIn, Terms } from './api'
import { addMonths, formatDayMonth } from './format'
import { formatINR, rupeesToPaise } from './money'
import { BackendError } from './serverState'
import { fromDraft, PART_MONTH_RULES, type TermsDraft } from './terms'
import { gramsToMg } from './weight'

export type Span = SimulationIn['span_months']
export const SPANS: Span[] = [3, 6, 12, 24, 36]
export const MAX_YEARS = 10 // how long after its start a Simulation can close, as the backend allows

/** A planned Lump Sum, as typed. */
export interface LumpSumDraft {
  on: string
  amount: string // rupees
}

/** What the Lender has entered, as typed. */
export interface Inputs {
  amount: string // rupees
  start: string
  closed: string
  terms: TermsDraft | null // null until the Default Terms arrive
  span: Span
  monthly: string // rupees, paid on every Accrual Date
  lumps: LumpSumDraft[]
  compared: TermsDraft | null // a second set of Terms, run alongside
  net: string // grams, valued at today's Gold Rate for `purity`
  purity: Purity
  value: string // rupees: a Collateral Value typed by hand, overriding the weight
}

const OVER_NOTHING = 'Enter an amount over ₹0'
const RATE_LIMITS = 'The rate must be over 0% and at most 100% a month'

const rateProblem = (terms: TermsDraft | null) => {
  const bps = terms ? fromDraft(terms).monthly_rate_bps : 0
  return terms && !(bps > 0 && bps <= 10_000) ? RATE_LIMITS : null
}

export const amountProblem = (amount: string) =>
  amount !== '' && !(Number(amount) > 0) ? OVER_NOTHING : null

/** Why each input can't be worked out, as the backend would refuse it. */
export function problems({ amount, start, closed, terms, monthly, lumps, compared }: Inputs) {
  return {
    amount: amountProblem(amount),
    rate: rateProblem(terms),
    start: start ? null : 'Enter the start date',
    closed: !closed
      ? 'Enter the date it is closed on'
      : start && closed <= start
        ? 'Closed on must be after the start date'
        : start && closed > addMonths(start, 12 * MAX_YEARS)
          ? `Closed on must be at most ${MAX_YEARS} years after the start date`
          : null,
    monthly: amountProblem(monthly),
    lumps: lumps.map((lump) => ({
      amount: amountProblem(lump.amount),
      on: lump.on && start && lump.on < start ? 'Must be on or after the start date' : null,
    })),
    comparedRate: rateProblem(compared),
  }
}

export type Problems = ReturnType<typeof problems>

/** Whether any of `problem`'s fields (nested ones too) has a problem. */
export const anyProblem = (problem: unknown): boolean =>
  problem !== null &&
  (typeof problem === 'string' || Object.values(problem as object).some(anyProblem))

/** The Lump Sums worked out: those with a date and an amount, each with its row. */
export const filledIn = (lumps: LumpSumDraft[]) =>
  lumps.flatMap((lump, row) => (lump.on && lump.amount ? [{ ...lump, row }] : []))

/** A Lump Sum refused for being more than was owed on its date: its row, and why. */
export interface Refusal {
  row: number
  message: string
}

/** The refusal, if `error` is the backend's for a Lump Sum larger than what was owed. */
export function refusalOf(error: Error | null, rows: number[]): Refusal | null {
  const detail = error instanceof BackendError ? error.detail : null
  const refused = detail as { lump_sum?: unknown; owed?: number; on?: string } | null
  if (typeof refused?.lump_sum !== 'number') return null
  return {
    row: rows[refused.lump_sum],
    message: `Only ${formatINR(refused.owed!)} owed on ${formatDayMonth(refused.on!)}`,
  }
}

const SHORT_MODES: Record<Terms['interest_mode'], string> = {
  simple: 'Simple',
  compounded_yearly: 'Yearly',
  compounded_monthly: 'Monthly',
}

/** Terms as a tile names them, e.g. "2% Simple", with the Part-Month Rule only when that
 *  is all that tells it from `other`. */
export function termsLabel(terms: Terms, other: Terms | null): string {
  const label = `${terms.monthly_rate_bps / 100}% ${SHORT_MODES[terms.interest_mode]}`
  const alike =
    other &&
    other.monthly_rate_bps === terms.monthly_rate_bps &&
    other.interest_mode === terms.interest_mode
  return alike ? `${label}, ${PART_MONTH_RULES[terms.part_month_rule].toLowerCase()}` : label
}

/** A Simulation, worked out, and the Terms it is under. */
export interface Run {
  label: string
  simulation: Simulation
}

/** Today's Collateral Value of what was entered, in paise: a typed value, else the net
 *  weight at the Gold Rate for its purity (none if that is not set). */
export function collateralOf(
  { net, purity, value }: Inputs,
  rates: GoldRate[] | undefined,
): { value: number; rate: number | null } | null {
  if (Number(value) > 0) return { value: rupeesToPaise(value), rate: null }
  const rate = rates?.find((r) => r.purity_karat === purity)?.rate_per_gram
  const mg = gramsToMg(net)
  if (!mg || !rate) return null
  // rounded half-up to the paisa, as a Mortgage's is
  return { value: Math.floor((2 * mg * rate + 1000) / 2000), rate }
}
