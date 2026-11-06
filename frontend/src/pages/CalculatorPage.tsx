import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import {
  PURITIES,
  type GoldRate,
  type Purity,
  type Simulation,
  type SimulationIn,
  type Terms,
} from '../api'
import { SimulationChart } from '../components/SimulationChart'
import { TermsFields } from '../components/TermsFields'
import { useDebounced } from '../components/useDebounced'
import { useUrlFilters } from '../components/useUrlFilters'
import {
  addMonths,
  formatDate,
  formatDayMonth,
  formatDays,
  formatPercent,
  todayIso,
} from '../format'
import { formatChange, formatINR, rupeesToPaise } from '../money'
import { settings, simulationQuery } from '../requests'
import { BackendError, useServerState } from '../serverState'
import { fromDraft, INTEREST_MODES, PART_MONTH_RULES, toDraft, type TermsDraft } from '../terms'
import { gramsToMg } from '../weight'

type Span = SimulationIn['span_months']
const SPANS: Span[] = [3, 6, 12, 24, 36]
const MAX_YEARS = 10 // how long after its start a Simulation can close, as the backend allows

/** A planned lump sum, as typed. */
interface LumpSumDraft {
  on: string
  amount: string // rupees
}

/** What the Lender has entered, as typed. */
interface Inputs {
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

/** `value` if it is one of `choices`' keys (a URL can be edited by hand), else `fallback`. */
function oneOf<Key extends string>(
  choices: Record<Key, string>,
  value: string | null,
  fallback: Key,
): Key {
  return value !== null && value in choices ? (value as Key) : fallback
}

/** Terms from the URL under `rate`, `mode` and `rule` (each followed by `suffix`). */
function termsIn(params: URLSearchParams, suffix = ''): TermsDraft | null {
  const rate = params.get(`rate${suffix}`)
  return rate === null
    ? null
    : {
        ratePercent: rate,
        interest_mode: oneOf(INTEREST_MODES, params.get(`mode${suffix}`), 'simple'),
        part_month_rule: oneOf(PART_MONTH_RULES, params.get(`rule${suffix}`), 'full_month'),
      }
}

const termsParams = (terms: TermsDraft | null, suffix = '') => ({
  [`rate${suffix}`]: terms?.ratePercent ?? null,
  [`mode${suffix}`]: terms?.interest_mode ?? null,
  [`rule${suffix}`]: terms?.part_month_rule ?? null,
})

/** The inputs, kept in the page's URL so a refresh or a bookmark keeps them; anything
 *  not there yet is a fresh Calculator's: today, a year on, the Default Terms. */
function useInputs(defaultTerms: Terms | undefined): [Inputs, (changes: Partial<Inputs>) => void] {
  const [params, setParams] = useUrlFilters()
  const today = todayIso()
  const span = Number(params.get('span')) as Span
  const purity = Number(params.get('purity')) as Purity
  const lumps = params.get('lumps')
  const inputs: Inputs = {
    amount: params.get('amount') ?? '',
    start: params.get('start') ?? today,
    closed: params.get('closed') ?? addMonths(today, 12),
    terms: termsIn(params) ?? (defaultTerms ? toDraft(defaultTerms) : null),
    span: SPANS.includes(span) ? span : 12,
    monthly: params.get('monthly') ?? '',
    // "2026-06-01:20000,2026-09-01:5000", a row not filled in yet as ":"
    lumps:
      lumps === null
        ? []
        : lumps.split(',').map((lump) => {
            const [on = '', amount = ''] = lump.split(':')
            return { on, amount }
          }),
    compared: termsIn(params, '2'),
    net: params.get('net') ?? '',
    purity: PURITIES.includes(purity) ? purity : 22,
    value: params.get('value') ?? '',
  }
  // Every input goes into the URL at once, so a bookmark keeps today's dates too; those
  // left empty are left out.
  function change(changes: Partial<Inputs>) {
    const next = { ...inputs, ...changes }
    setParams({
      amount: next.amount,
      start: next.start,
      closed: next.closed,
      span: String(next.span),
      ...(next.terms && termsParams(next.terms)),
      monthly: next.monthly || null,
      lumps: next.lumps.length
        ? next.lumps.map((lump) => `${lump.on}:${lump.amount}`).join(',')
        : null,
      ...termsParams(next.compared, '2'),
      net: next.net || null,
      purity: next.net ? String(next.purity) : null,
      value: next.value || null,
    })
  }
  return [inputs, change]
}

const OVER_NOTHING = 'Enter an amount over ₹0'
const RATE_LIMITS = 'The rate must be over 0% and at most 100% a month'

const rateProblem = (terms: TermsDraft | null) => {
  const bps = terms ? fromDraft(terms).monthly_rate_bps : 0
  return terms && !(bps > 0 && bps <= 10_000) ? RATE_LIMITS : null
}

const amountProblem = (amount: string) =>
  amount !== '' && !(Number(amount) > 0) ? OVER_NOTHING : null

/** Why each input can't be worked out, as the backend would refuse it. */
function problems({ amount, start, closed, terms, monthly, lumps, compared }: Inputs) {
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

/** Whether any of `problem`'s fields (nested ones too) has a problem. */
const anyProblem = (problem: unknown): boolean =>
  problem !== null &&
  (typeof problem === 'string' || Object.values(problem as object).some(anyProblem))

/** The lump sums worked out: those with a date and an amount, each with its row. */
const filledIn = (lumps: LumpSumDraft[]) =>
  lumps.flatMap((lump, row) => (lump.on && lump.amount ? [{ ...lump, row }] : []))

/** A lump sum refused for being more than was owed on its date: its row, and why. */
interface Refusal {
  row: number
  message: string
}

/** The refusal, if `error` is the backend's for a lump sum larger than what was owed. */
function refusalOf(error: Error | null, rows: number[]): Refusal | null {
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
function termsLabel(terms: Terms, other: Terms | null): string {
  const label = `${terms.monthly_rate_bps / 100}% ${SHORT_MODES[terms.interest_mode]}`
  const alike =
    other &&
    other.monthly_rate_bps === terms.monthly_rate_bps &&
    other.interest_mode === terms.interest_mode
  return alike ? `${label}, ${PART_MONTH_RULES[terms.part_month_rule].toLowerCase()}` : label
}

/** A Simulation, worked out, and the Terms it is under. */
interface Run {
  label: string
  simulation: Simulation
}

/** Today's Collateral Value of what was entered, in paise: a typed value, else the net
 *  weight at the Gold Rate for its purity (none if that is not set). */
function collateralOf(
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

/**
 * Size up a loan as a Simulation: an amount, dates, Terms and perhaps planned Payments,
 * worked out by the same ledger engine as a real Mortgage, closed on the chosen date;
 * perhaps alongside a second set of Terms. Nothing is stored.
 */
export function CalculatorPage() {
  const { client } = useServerState()
  const navigate = useNavigate()
  const [inputs, change] = useInputs(useQuery(settings.defaultTerms(client)).data)
  const goldRates = useQuery(settings.goldRates(client)).data
  const problem = problems(inputs)
  const { amount, start, closed, terms, span, monthly, lumps, compared } = inputs
  const valid = amount !== '' && terms !== null && !anyProblem(problem)
  const sent = filledIn(lumps)
  const ask = (under: TermsDraft): SimulationIn => ({
    amount_lent: rupeesToPaise(amount),
    start_date: start,
    closed_on: closed,
    terms: fromDraft(under),
    span_months: span,
    ...(monthly && { monthly_payment: rupeesToPaise(monthly) }),
    lump_sums: sent.map((lump) => ({ on: lump.on, amount: rupeesToPaise(lump.amount) })),
  })
  const asked = valid ? [ask(terms), ...(compared ? [ask(compared)] : [])] : null
  // Asked for once the inputs stop changing; compared by value, as typed.
  const settledText = useDebounced(asked && JSON.stringify(asked), 300)
  const settled: SimulationIn[] | null = settledText && JSON.parse(settledText)
  const [firstAsked, secondAsked] = settled ?? []
  const first = useQuery({
    ...simulationQuery(client, firstAsked!),
    enabled: !!firstAsked,
    placeholderData: keepPreviousData,
  })
  const second = useQuery({
    ...simulationQuery(client, secondAsked!),
    enabled: !!secondAsked,
    placeholderData: keepPreviousData,
  })
  const rows = sent.map((lump) => lump.row)
  const refusal = refusalOf(first.error, rows) ?? refusalOf(second.error, rows)
  const error = refusal ? null : (first.error ?? (settled?.[1] ? second.error : null))
  const runs: Run[] | null =
    settled && first.data && (!settled[1] || second.data)
      ? [first.data, ...(settled[1] ? [second.data!] : [])].map((simulation, index) => ({
          simulation,
          label: termsLabel(settled[index].terms, settled[1 - index]?.terms ?? null),
        }))
      : null
  const future = start > todayIso()

  function lend() {
    navigate(
      `/mortgages/new?${new URLSearchParams({ amount, start, ...termsParams(terms) } as Record<string, string>)}`,
    )
  }

  function setLump(row: number, changes: Partial<LumpSumDraft>) {
    change({ lumps: lumps.map((lump, i) => (i === row ? { ...lump, ...changes } : lump)) })
  }

  return (
    <section className="card wide">
      <h2>Calculator</h2>
      <p className="hint">
        A Simulation: what a loan would come to, worked out exactly as a Mortgage's Ledger
        would be. Nothing is saved.
      </p>
      <div className="stack">
        <label>
          Amount lent (₹)
          <input
            type="number"
            min="1"
            step="1"
            placeholder="e.g. 100000"
            value={amount}
            onChange={(event) => change({ amount: event.target.value })}
          />
          <FieldProblem problem={problem.amount} />
        </label>
        <label>
          Start date
          <input
            type="date"
            value={start}
            onChange={(event) => change({ start: event.target.value })}
          />
          <FieldProblem problem={problem.start} />
        </label>
        <label>
          Closed on
          <input
            type="date"
            value={closed}
            onChange={(event) => change({ closed: event.target.value })}
          />
          <FieldProblem problem={problem.closed} />
        </label>
        {terms && (
          <TermsFields
            value={terms}
            onChange={(draft) => change({ terms: draft })}
            rateProblem={problem.rate}
          />
        )}

        {compared ? (
          <fieldset>
            <legend>Compared with</legend>
            <TermsFields
              value={compared}
              onChange={(draft) => change({ compared: draft })}
              rateProblem={problem.comparedRate}
            />
            <button
              type="button"
              className="secondary small"
              onClick={() => change({ compared: null })}
            >
              Remove the compared Terms
            </button>
          </fieldset>
        ) : (
          terms && (
            <div className="row">
              <button
                type="button"
                className="secondary small"
                onClick={() => change({ compared: terms })}
              >
                Compare other Terms
              </button>
            </div>
          )
        )}

        <fieldset>
          <legend>Planned Payments</legend>
          <label>
            Monthly payment (₹)
            <input
              type="number"
              min="1"
              step="1"
              value={monthly}
              onChange={(event) => change({ monthly: event.target.value })}
            />
            <FieldProblem problem={problem.monthly} />
          </label>
          <p className="hint">
            Paid on every Accrual Date, never more than is owed, until nothing is.
          </p>
          {lumps.map((lump, row) => {
            const answered = sent.findIndex((s) => s.row === row)
            return (
              <div key={row} className="row lump-sum">
                <label>
                  Date
                  <input
                    type="date"
                    aria-label={`Lump sum ${row + 1} date`}
                    value={lump.on}
                    onChange={(event) => setLump(row, { on: event.target.value })}
                  />
                </label>
                <label>
                  Amount (₹)
                  <input
                    type="number"
                    min="1"
                    step="1"
                    aria-label={`Lump sum ${row + 1} amount (₹)`}
                    value={lump.amount}
                    onChange={(event) => setLump(row, { amount: event.target.value })}
                  />
                </label>
                <button
                  type="button"
                  className="secondary small"
                  aria-label={`Remove lump sum ${row + 1}`}
                  onClick={() => change({ lumps: lumps.filter((_, i) => i !== row) })}
                >
                  Remove
                </button>
                <FieldProblem problem={problem.lumps[row].on} />
                <FieldProblem problem={problem.lumps[row].amount} />
                <FieldProblem problem={refusal?.row === row ? refusal.message : null} />
                {runs && answered >= 0 && <Ignored runs={runs} index={answered} />}
              </div>
            )
          })}
          <div className="row">
            <button
              type="button"
              className="secondary small"
              onClick={() => change({ lumps: [...lumps, { on: '', amount: '' }] })}
            >
              Add a lump sum
            </button>
          </div>
        </fieldset>

        <Jewellery inputs={inputs} change={change} goldRates={goldRates} />
      </div>

      {!valid ? (
        <p className="hint">Enter an amount to see what it would come to.</p>
      ) : refusal ? null : error ? (
        <p className="status error">{error.message}</p>
      ) : !runs ? (
        <p>Working it out…</p>
      ) : (
        <Results
          runs={runs}
          amountLent={settled![0].amount_lent}
          closedOn={settled![0].closed_on}
          planned={!!(settled![0].monthly_payment || settled![0].lump_sums?.length)}
          collateral={collateralOf(inputs, goldRates)?.value ?? null}
          span={span}
          onSpan={(months) => change({ span: months })}
          lend={
            <div className="row">
              <button
                type="button"
                disabled={future}
                title={future ? "Can't lend before the start date" : undefined}
                onClick={lend}
              >
                Lend this
              </button>
              {future ? (
                <span className="hint">Can't lend before the start date</span>
              ) : (
                <span className="hint">
                  Opens New Mortgage with this amount, start date and Terms
                  {runs.length > 1 && ` (${runs[0].label})`}.
                </span>
              )}
            </div>
          }
        />
      )}
    </section>
  )
}

function FieldProblem({ problem }: { problem: string | null }) {
  return problem ? <span className="status error">{problem}</span> : null
}

/** Why the `index`th lump sum asked for was left out, if it was. */
function Ignored({ runs, index }: { runs: Run[]; index: number }) {
  const ignoredBy = runs.map((run) => run.simulation.lump_sums[index]?.ignored ?? null)
  const reason = ignoredBy.find(Boolean)
  if (!reason) return null
  const text = reason === 'after_closed_on' ? 'Ignored: after Closed on' : 'Ignored: paid off by then'
  // Paid off sooner under one set of Terms than the other
  const under = ignoredBy.every(Boolean) ? '' : ` under ${runs[ignoredBy.indexOf(reason)].label}`
  return <span className="hint">{text + under}</span>
}

/** The optional jewellery value, folded away unless one was entered. */
function Jewellery({
  inputs,
  change,
  goldRates,
}: {
  inputs: Inputs
  change: (changes: Partial<Inputs>) => void
  goldRates: GoldRate[] | undefined
}) {
  const [open] = useState(() => !!(inputs.net || inputs.value))
  const collateral = collateralOf(inputs, goldRates)
  const unpriced =
    gramsToMg(inputs.net) > 0 &&
    !inputs.value &&
    goldRates &&
    !goldRates.find((r) => r.purity_karat === inputs.purity)?.rate_per_gram
  return (
    <details className="tucked" open={open}>
      <summary>Jewellery value</summary>
      <p className="hint">
        What the jewellery is worth today, to measure the loan against: its net weight at
        today's Gold Rate, or a Collateral Value typed in, which counts instead.
      </p>
      <div className="grid-3">
        <label>
          Net weight, gold only (grams)
          <input
            type="number"
            min="0"
            step="0.001"
            value={inputs.net}
            onChange={(event) => change({ net: event.target.value })}
          />
        </label>
        <label>
          Purity
          <select
            value={inputs.purity}
            onChange={(event) => change({ purity: Number(event.target.value) as Purity })}
          >
            {PURITIES.map((karat) => (
              <option key={karat} value={karat}>
                {karat}K
              </option>
            ))}
          </select>
        </label>
        <label>
          Collateral Value (₹)
          <input
            type="number"
            min="1"
            step="1"
            value={inputs.value}
            onChange={(event) => change({ value: event.target.value })}
          />
          <FieldProblem problem={amountProblem(inputs.value)} />
        </label>
      </div>
      {unpriced && (
        <p className="hint">
          No Gold Rate set for {inputs.purity}K: type a Collateral Value instead
        </p>
      )}
      {collateral?.rate && (
        <p className="hint">
          Collateral Value {formatINR(collateral.value)} at {formatINR(collateral.rate)} a gram
        </p>
      )}
    </details>
  )
}

/** A figure for each Simulation, labelled with its Terms when two are compared, and how
 *  the second differs from the first. */
function Tile({
  caption,
  runs,
  figure,
  format,
  difference,
}: {
  caption: string
  runs: Run[]
  figure: (simulation: Simulation) => number | null
  format: (figure: number | null) => string
  difference: (second: number, first: number) => string
}) {
  const figures = runs.map((run) => figure(run.simulation))
  const [one, two] = figures
  return (
    <div className="tile">
      <span className="hint">{caption}</span>
      <strong>
        {runs.length === 1
          ? format(one)
          : runs.map((run, i) => `${run.label} ${format(figures[i])}`).join(' · ')}
      </strong>
      {runs.length > 1 && one !== null && two !== null && (
        <span className="hint">{difference(two, one)}</span>
      )}
    </div>
  )
}

const money = (paise: number | null) => formatINR(paise ?? 0)
const share = (decimals: number) => (ratio: number | null) => formatPercent(ratio ?? 0, decimals)
const percentagePoints = (decimals: number) => (second: number, first: number) =>
  second === first
    ? 'no change'
    : `${second > first ? '+' : '−'}${formatPercent(Math.abs(second - first), decimals).slice(0, -1)} percentage points`
const DAY = 24 * 60 * 60 * 1000

function Results({
  runs,
  amountLent,
  closedOn,
  planned,
  collateral,
  span,
  onSpan,
  lend,
}: {
  runs: Run[]
  amountLent: number // paise
  closedOn: string
  planned: boolean
  collateral: number | null // paise
  span: Span
  onSpan: (months: Span) => void
  lend: ReactNode
}) {
  return (
    <div className="stack">
      <div className="tiles">
        <Tile
          caption={`Outstanding on ${formatDate(closedOn)}`}
          runs={runs}
          figure={(s) => s.on_closure.total}
          format={money}
          difference={(two, one) => formatChange(two - one)}
        />
        <Tile
          caption="Total interest earned"
          runs={runs}
          figure={(s) => s.interest_earned}
          format={money}
          difference={(two, one) => formatChange(two - one)}
        />
        <Tile
          caption="First month's interest"
          runs={runs}
          figure={(s) => s.first_month_interest}
          format={money}
          difference={(two, one) => formatChange(two - one)}
        />
        <Tile
          caption="Effective annual rate"
          runs={runs}
          figure={(s) => s.effective_annual_rate}
          format={share(2)}
          difference={percentagePoints(2)}
        />
        {planned && (
          <Tile
            caption="Paid off"
            runs={runs}
            figure={(s) => (s.paid_off_on ? Date.parse(s.paid_off_on) : null)}
            format={(paidOff) =>
              paidOff === null
                ? `Not within ${MAX_YEARS} years`
                : formatDate(new Date(paidOff).toISOString().slice(0, 10))
            }
            difference={(two, one) => {
              const days = Math.round((two - one) / DAY)
              return days === 0
                ? 'the same day'
                : `${formatDays(Math.abs(days))} ${days > 0 ? 'later' : 'sooner'}`
            }}
          />
        )}
      </div>
      {lend}
      {collateral !== null && (
        <div className="tiles">
          <Tile
            caption="Loan-to-Value now"
            runs={runs}
            figure={() => amountLent / collateral}
            format={share(1)}
            difference={percentagePoints(1)}
          />
          <Tile
            caption={`Loan-to-Value on ${formatDate(closedOn)}`}
            runs={runs}
            figure={(s) => s.on_closure.total / collateral}
            format={share(1)}
            difference={percentagePoints(1)}
          />
        </div>
      )}

      <label className="what-if">
        Graph span
        <select value={span} onChange={(event) => onSpan(Number(event.target.value) as Span)}>
          {SPANS.map((months) => (
            <option key={months} value={months}>
              {months} months
            </option>
          ))}
        </select>
      </label>
      <SimulationChart
        lines={runs.map((run) => ({
          label: run.label,
          points: run.simulation.points,
          payments: run.simulation.payments,
        }))}
        closedOn={closedOn}
      />

      {runs.map((run, index) => (
        <MonthByMonth
          key={index}
          simulation={run.simulation}
          label={runs.length > 1 ? run.label : null}
        />
      ))}
    </div>
  )
}

/** A Simulation's Ledger, month by month, with its planned Payments; folded away. */
function MonthByMonth({ simulation, label }: { simulation: Simulation; label: string | null }) {
  return (
    <details className="tucked">
      <summary>{label ? `Month by month, ${label}` : 'Month by month'}</summary>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th className="num">Interest</th>
              <th className="num">Paid</th>
              <th className="num">Capitalised</th>
              <th className="num">Principal</th>
              <th className="num">Unpaid interest</th>
            </tr>
          </thead>
          <tbody>
            {simulation.months.map((month, index) => (
              <tr key={index}>
                <td>
                  {formatDate(month.on)}
                  {month.interest_to_date_days !== null && (
                    <span className="hint">
                      {' '}
                      · Interest to Date, {formatDays(month.interest_to_date_days)}
                    </span>
                  )}
                </td>
                <td className="num">{month.paid ? '—' : formatINR(month.interest)}</td>
                <td className="num">{month.paid ? formatINR(month.paid) : '—'}</td>
                <td className="num">{month.capitalised ? formatINR(month.capitalised) : '—'}</td>
                <td className="num">{formatINR(month.principal)}</td>
                <td className="num">{formatINR(month.unpaid_interest)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
