import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { Mortgage, ProjectedPoint } from '../api'
import { formatDate, formatPercent } from '../format'
import { formatINR, rupeesToPaise } from '../money'
import { projectionQuery } from '../requests'
import { useServerState } from '../serverState'
import { ProjectionChart } from './ProjectionChart'
import { useDebounced } from './useDebounced'

const HORIZONS = [3, 6, 12]

/** Where an Active Mortgage is heading: no more Payments, or ₹X every month. */
export function ProjectionPanel({ mortgage }: { mortgage: Mortgage }) {
  const [monthly, setMonthly] = useState('')
  const typed = useDebounced(monthly, 400)
  const payment = Number(typed) > 0 ? rupeesToPaise(typed) : null
  const { client } = useServerState()
  // Stale whenever the Mortgage is (a Payment or Term Change); the last one stays while
  // the next what-if loads.
  const { data: projection, error } = useQuery({
    ...projectionQuery(client, mortgage.id, payment),
    placeholderData: keepPreviousData,
  })

  if (!projection) return error ? <p className="status error">{error.message}</p> : <p>Loading…</p>
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
      <ProjectionChart
        series={[
          { label: 'No more Payments', className: 'baseline', points: baseline.points },
          ...(whatIf
            ? [{ label: 'Paying every month', className: 'what-if', points: whatIf.points }]
            : []),
        ]}
        termChanges={baseline.term_changes}
      />
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
