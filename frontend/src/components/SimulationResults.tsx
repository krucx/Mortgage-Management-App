import type { ReactNode } from 'react'
import type { Simulation } from '../api'
import { MAX_YEARS, SPANS, type Run, type Span } from '../calculator'
import { formatDate, formatDays, formatPercent } from '../format'
import { formatChange, formatINR } from '../money'
import { SimulationChart } from './SimulationChart'

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

export function SimulationResults({
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

