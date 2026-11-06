import type { ReactNode } from 'react'
import type { Simulation } from '../api'
import { MAX_YEARS, SPANS, type Run, type Span } from '../calculator'
import { formatDate, formatDays, formatPercent } from '../format'
import { formatChange, formatINR } from '../money'
import { SimulationChart } from './SimulationChart'

/** A figure for each Simulation, labelled with its Terms when two are compared, and how
 *  the second differs from the first; with none worked out yet, `blank`. */
function Tile({
  caption,
  runs,
  figure,
  format,
  difference,
  blank = format(null),
}: {
  caption: string
  runs: Run[]
  figure: (simulation: Simulation) => number | null
  format: (figure: number | null) => string
  difference: (second: number, first: number) => string
  blank?: string
}) {
  const figures = runs.map((run) => figure(run.simulation))
  const [one, two] = figures
  return (
    <div className="tile">
      <span className="hint">{caption}</span>
      <strong>
        {runs.length === 0
          ? blank
          : runs.length === 1
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

/** What a Simulation comes to, its tiles always in place so nothing moves as the inputs are
 *  typed: at nothing until one is worked out, `runs` then empty. */
export function SimulationResults({
  runs,
  amountLent,
  closedOn,
  planned,
  collateral,
  span,
  onSpan,
  graphOpen,
  onGraphOpen,
  lend,
}: {
  runs: Run[]
  amountLent: number // paise
  closedOn: string | null // as entered, for before anything is worked out; none if it's wrong
  planned: boolean
  collateral: number | null // paise
  span: Span
  onSpan: (months: Span) => void
  /** Whether the graph is open, kept by the page so it stays as left while worked out again. */
  graphOpen: boolean
  onGraphOpen: (open: boolean) => void
  lend: ReactNode
}) {
  // Once worked out, the day it closed on is the Simulation's own.
  const closing = runs[0]?.simulation.on_closure.on ?? closedOn
  return (
    <div className="stack">
      <div className="tiles">
        <Tile
          caption={closing ? `Outstanding on ${formatDate(closing)}` : 'Outstanding when closed'}
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
            blank="—"
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
            caption={
              closing ? `Loan-to-Value on ${formatDate(closing)}` : 'Loan-to-Value when closed'
            }
            runs={runs}
            figure={(s) => s.on_closure.total / collateral}
            format={share(1)}
            difference={percentagePoints(1)}
          />
        </div>
      )}

      <details
        className="tucked"
        open={graphOpen}
        onToggle={(event) => onGraphOpen(event.currentTarget.open)}
      >
        <summary>Graph</summary>
        {runs.length === 0 ? (
          <p className="hint">Nothing to draw yet.</p>
        ) : (
          <div className="stack">
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
              closedOn={runs[0].simulation.on_closure.on}
            />
          </div>
        )}
      </details>
    </div>
  )
}

/** A Simulation's Ledger, month by month, with its planned Payments; folded away. */
export function MonthByMonth({
  simulation,
  label,
}: {
  simulation: Simulation
  label: string | null
}) {
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
