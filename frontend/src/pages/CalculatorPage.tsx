import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { Simulation, SimulationIn, Terms } from '../api'
import { SimulationChart } from '../components/SimulationChart'
import { TermsFields } from '../components/TermsFields'
import { useDebounced } from '../components/useDebounced'
import { useUrlFilters } from '../components/useUrlFilters'
import { addMonths, formatDate, formatDays, formatPercent, todayIso } from '../format'
import { formatINR, rupeesToPaise } from '../money'
import { settings, simulationQuery } from '../requests'
import { useServerState } from '../serverState'
import { fromDraft, INTEREST_MODES, PART_MONTH_RULES, toDraft, type TermsDraft } from '../terms'

type Span = SimulationIn['span_months']
const SPANS: Span[] = [3, 6, 12, 24, 36]
const MAX_YEARS = 10 // how long after its start a Simulation can close, as the backend allows

/** What the Lender has entered, as typed. */
interface Inputs {
  amount: string // rupees
  start: string
  closed: string
  terms: TermsDraft | null // null until the Default Terms arrive
  span: Span
}

/** `value` if it is one of `choices`' keys (a URL can be edited by hand), else `fallback`. */
function oneOf<Key extends string>(
  choices: Record<Key, string>,
  value: string | null,
  fallback: Key,
): Key {
  return value !== null && value in choices ? (value as Key) : fallback
}

/** The inputs, kept in the page's URL so a refresh or a bookmark keeps them; anything
 *  not there yet is a fresh Calculator's: today, a year on, the Default Terms. */
function useInputs(defaultTerms: Terms | undefined): [Inputs, (changes: Partial<Inputs>) => void] {
  const [params, setParams] = useUrlFilters()
  const today = todayIso()
  const rate = params.get('rate')
  const span = Number(params.get('span')) as Span
  const inputs: Inputs = {
    amount: params.get('amount') ?? '',
    start: params.get('start') ?? today,
    closed: params.get('closed') ?? addMonths(today, 12),
    terms:
      rate !== null
        ? {
            ratePercent: rate,
            interest_mode: oneOf(INTEREST_MODES, params.get('mode'), 'simple'),
            part_month_rule: oneOf(PART_MONTH_RULES, params.get('rule'), 'full_month'),
          }
        : defaultTerms ? toDraft(defaultTerms) : null,
    span: SPANS.includes(span) ? span : 12,
  }
  // Every input goes into the URL at once, so a bookmark keeps today's dates too.
  function change(changes: Partial<Inputs>) {
    const next = { ...inputs, ...changes }
    setParams({
      amount: next.amount,
      start: next.start,
      closed: next.closed,
      span: String(next.span),
      ...(next.terms && {
        rate: next.terms.ratePercent,
        mode: next.terms.interest_mode,
        rule: next.terms.part_month_rule,
      }),
    })
  }
  return [inputs, change]
}

/** Why each input can't be worked out, as the backend would refuse it. */
function problems({ amount, start, closed, terms }: Inputs) {
  const bps = terms ? fromDraft(terms).monthly_rate_bps : 0
  return {
    amount: amount !== '' && !(Number(amount) > 0) ? 'Enter an amount over ₹0' : null,
    rate:
      terms && !(bps > 0 && bps <= 10_000)
        ? 'The rate must be over 0% and at most 100% a month'
        : null,
    start: start ? null : 'Enter the start date',
    closed: !closed
      ? 'Enter the date it is closed on'
      : start && closed <= start
        ? 'Closed on must be after the start date'
        : start && closed > addMonths(start, 12 * MAX_YEARS)
          ? `Closed on must be at most ${MAX_YEARS} years after the start date`
          : null,
  }
}

/**
 * Size up a loan as a Simulation: an amount, dates and Terms, worked out by the same
 * ledger engine as a real Mortgage, closed on the chosen date. Nothing is stored.
 */
export function CalculatorPage() {
  const { client } = useServerState()
  const [inputs, change] = useInputs(useQuery(settings.defaultTerms(client)).data)
  const problem = problems(inputs)
  const { amount, start, closed, terms, span } = inputs
  const valid = amount !== '' && terms && !Object.values(problem).some(Boolean)
  const asked: SimulationIn | null = valid
    ? {
        amount_lent: rupeesToPaise(amount),
        start_date: start,
        closed_on: closed,
        terms: fromDraft(terms),
        span_months: span,
      }
    : null
  // Asked for once the inputs stop changing; compared by value, as typed.
  const settledText = useDebounced(asked && JSON.stringify(asked), 300)
  const settled: SimulationIn | null = settledText && JSON.parse(settledText)
  const { data: simulation, error } = useQuery({
    ...simulationQuery(client, settled!),
    enabled: settled !== null,
    placeholderData: keepPreviousData,
  })

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
      </div>

      {!valid ? (
        <p className="hint">Enter an amount to see what it would come to.</p>
      ) : error ? (
        <p className="status error">{error.message}</p>
      ) : !simulation ? (
        <p>Working it out…</p>
      ) : (
        <Results
          simulation={simulation}
          span={span}
          onSpan={(months) => change({ span: months })}
        />
      )}
    </section>
  )
}

function FieldProblem({ problem }: { problem: string | null }) {
  return problem ? <span className="status error">{problem}</span> : null
}

function Results({
  simulation,
  span,
  onSpan,
}: {
  simulation: Simulation
  span: Span
  onSpan: (months: Span) => void
}) {
  const closure = simulation.on_closure
  return (
    <div className="stack">
      <div className="tiles">
        <div className="tile">
          <span className="hint">Outstanding on {formatDate(closure.on)}</span>
          <strong>{formatINR(closure.total)}</strong>
        </div>
        <div className="tile">
          <span className="hint">Total interest earned</span>
          <strong>{formatINR(simulation.interest_earned)}</strong>
        </div>
        <div className="tile">
          <span className="hint">First month's interest</span>
          <strong>{formatINR(simulation.first_month_interest)}</strong>
        </div>
        <div className="tile">
          <span className="hint">Effective annual rate</span>
          <strong>{formatPercent(simulation.effective_annual_rate, 2)}</strong>
        </div>
      </div>

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
      <SimulationChart points={simulation.points} closedOn={closure.on} />

      <details className="tucked">
        <summary>Month by month</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th className="num">Interest</th>
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
                  <td className="num">{formatINR(month.interest)}</td>
                  <td className="num">{month.capitalised ? formatINR(month.capitalised) : '—'}</td>
                  <td className="num">{formatINR(month.principal)}</td>
                  <td className="num">{formatINR(month.unpaid_interest)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
