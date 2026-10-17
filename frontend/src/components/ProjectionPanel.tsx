import { useEffect, useState } from 'react'
import { api, type Mortgage, type ProjectedPoint, type Projection } from '../api'
import { formatDate, formatPercent } from '../format'
import { formatINR, rupeesToPaise } from '../money'
import { useDebounced } from './useDebounced'

const HORIZONS = [3, 6, 12]

/** Where an Active Mortgage is heading: no more Payments, or ₹X every month. */
export function ProjectionPanel({ mortgage }: { mortgage: Mortgage }) {
  const [monthly, setMonthly] = useState('')
  const [projection, setProjection] = useState<Projection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const typed = useDebounced(monthly, 400)
  const payment = Number(typed) > 0 ? rupeesToPaise(typed) : null

  useEffect(() => {
    let cancelled = false
    api.getProjection(mortgage.id, payment).then(
      (loaded) => {
        if (cancelled) return
        setProjection(loaded)
        setError(null)
      },
      (err: Error) => !cancelled && setError(err.message),
    )
    return () => {
      cancelled = true
    }
    // Reload when the Mortgage changes too (a Payment or Term Change).
  }, [mortgage, payment])

  if (error) return <p className="status error">{error}</p>
  if (!projection) return <p>Loading…</p>
  const { baseline, what_if: whatIf } = projection
  const at = (points: ProjectedPoint[], months: number) => points.find((p) => p.months === months)

  return (
    <div className="stack">
      <label className="what-if">
        What if they pay every month (₹), on each Accrual Date
        <input
          type="number"
          min="0"
          step="1"
          placeholder="e.g. 5000"
          value={monthly}
          onChange={(event) => setMonthly(event.target.value)}
        />
      </label>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th />
              {HORIZONS.map((months) => (
                <th key={months} className="num">
                  In {months} months
                  <br />
                  <span className="hint">{formatDate(at(baseline.points, months)!.on)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <Rows label="No more Payments" points={baseline.points} />
            {whatIf && (
              <Rows
                label={`Paying ${formatINR(projection.monthly_payment ?? 0)} a month`}
                points={whatIf.points}
              />
            )}
          </tbody>
        </table>
      </div>
      {whatIf && (
        <p className={whatIf.paid_off_on ? 'status saved' : 'hint'}>
          {whatIf.paid_off_on
            ? `Paying ${formatINR(projection.monthly_payment ?? 0)} a month, it would be paid off on ${formatDate(whatIf.paid_off_on)}.`
            : 'At that amount it would not be paid off within ten years.'}
        </p>
      )}
      {projection.collateral_value === null && (
        <p className="hint">Loan-to-Value appears once there is a Collateral Value.</p>
      )}
      <Chart baseline={baseline.points} whatIf={whatIf?.points ?? null} />
    </div>
  )
}

function Rows({ label, points }: { label: string; points: ProjectedPoint[] }) {
  const cells = (pick: (point: ProjectedPoint) => string) =>
    HORIZONS.map((months) => {
      const point = points.find((p) => p.months === months)
      return (
        <td key={months} className="num">
          {point ? pick(point) : '—'}
        </td>
      )
    })
  return (
    <>
      <tr className="projection-group">
        <th colSpan={HORIZONS.length + 1}>{label}</th>
      </tr>
      <tr>
        <td>Principal</td>
        {cells((p) => formatINR(p.principal))}
      </tr>
      <tr>
        <td>Unpaid interest</td>
        {cells((p) => formatINR(p.unpaid_interest))}
      </tr>
      <tr>
        <td>Redemption Amount</td>
        {cells((p) => formatINR(p.redemption_amount))}
      </tr>
      <tr>
        <td>Loan-to-Value</td>
        {cells((p) => (p.loan_to_value === null ? '—' : formatPercent(p.loan_to_value)))}
      </tr>
    </>
  )
}

/** The Redemption Amount month by month, as lines. */
function Chart({
  baseline,
  whatIf,
}: {
  baseline: ProjectedPoint[]
  whatIf: ProjectedPoint[] | null
}) {
  const width = 640
  const height = 220
  const pad = { left: 70, right: 24, top: 12, bottom: 28 }
  const all = [...baseline, ...(whatIf ?? [])].map((p) => p.redemption_amount)
  const max = Math.max(...all, 1)
  const x = (months: number) => pad.left + (months / 12) * (width - pad.left - pad.right)
  const y = (paise: number) => pad.top + (1 - paise / max) * (height - pad.top - pad.bottom)
  const line = (points: ProjectedPoint[]) =>
    points.map((p) => `${x(p.months)},${y(p.redemption_amount)}`).join(' ')
  const ticks = [0, 0.5, 1].map((share) => Math.round(max * share))

  return (
    <figure className="chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Redemption Amount over the next 12 months"
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} className="grid" />
            <text x={pad.left - 6} y={y(tick) + 4} textAnchor="end">
              {formatINR(tick)}
            </text>
          </g>
        ))}
        {[0, 3, 6, 9, 12].map((months) => (
          <text
            key={months}
            x={x(months)}
            y={height - 8}
            textAnchor={months === 12 ? 'end' : 'middle'}
          >
            {months === 0 ? 'Today' : `+${months}m`}
          </text>
        ))}
        <polyline points={line(baseline)} className="series baseline" />
        {whatIf && <polyline points={line(whatIf)} className="series what-if" />}
      </svg>
      <figcaption className="row">
        <span className="key baseline">No more Payments</span>
        {whatIf && <span className="key what-if">Paying every month</span>}
        <span className="hint">Redemption Amount by month</span>
      </figcaption>
    </figure>
  )
}
