import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { api, LEDGER_CHANGED, type Dashboard, type ProjectionHorizon } from '../api'
import { PaymentsByMonthChart } from '../components/PaymentsByMonthChart'
import { formatDate, formatPercent, monthName } from '../format'
import { formatINR } from '../money'

/** One figure, opening the list it was counted from. */
function Figure({
  to,
  label,
  value,
  note,
}: {
  to: string
  label: string
  value: ReactNode
  note?: ReactNode
}) {
  return (
    <Link to={to} className="tile figure">
      <span className="hint">{label}</span>
      <strong>{value}</strong>
      {note && <span className="hint">{note}</span>}
    </Link>
  )
}

/**
 * Where the book is heading, 3, 6 and 12 months on: the interest the Active Mortgages
 * will be charged is exact; the rest carries the last 3 full months' average forward.
 */
function Projections({ figures }: { figures: Dashboard }) {
  const horizons = figures.projections
  const [first, last] = [figures.trend_months[0], figures.trend_months.at(-1)]
  const rows: [string, boolean, (h: ProjectionHorizon) => string][] = [
    [
      'Interest the Active Mortgages will be charged',
      true,
      (h) => formatINR(h.interest_accrued),
    ],
    [
      'Payments received',
      false,
      (h) => `about ${formatINR(h.payments_estimate)}`,
    ],
    [
      'Principal lent',
      false,
      (h) => `about ${formatINR(h.principal_lent_estimate)}`,
    ],
    [
      'Mortgages Redeemed',
      false,
      (h) => `about ${h.redemptions_estimate.toLocaleString('en-IN', { maximumFractionDigits: 1 })}`,
    ],
  ]
  return (
    <>
      <div className="table-scroll">
        <table className="projections">
          <thead>
            <tr>
              <th>Over the next</th>
              {horizons.map((h) => (
                <th key={h.months} className="num">
                  {h.months} months <span className="hint">(to {formatDate(h.on)})</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, exact, value]) => (
              <tr key={label}>
                <th scope="row">
                  {label}{' '}
                  <span className={`flag ${exact ? 'exact' : 'estimate'}`}>
                    {exact ? 'exact' : 'estimate'}
                  </span>
                </th>
                {horizons.map((h) => (
                  <td key={h.months} className="num">
                    {value(h)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        Exact: the Active Mortgages as they stand, with no further Payments. Estimates: the
        monthly average of {monthName(first)} to {monthName(last ?? first)}, carried forward.
      </p>
    </>
  )
}

/** The whole lending book at a glance, worked out whenever the page opens. */
export function DashboardPage() {
  const [figures, setFigures] = useState<Dashboard | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = () => api.getDashboard().then(setFigures, (err: Error) => setError(err.message))
    load()
    window.addEventListener(LEDGER_CHANGED, load)
    return () => window.removeEventListener(LEDGER_CHANGED, load)
  }, [])

  if (error) return <p className="status error">{error}</p>
  if (!figures) return <p>Loading…</p>

  const month = figures.as_of.slice(0, 7) // YYYY-MM
  const year = figures.as_of.slice(0, 4)
  const thisMonth = monthName(month)
  const profitLoss = figures.forfeiture_profit_loss_this_month
  const owed = figures.principal_outstanding + figures.unpaid_interest
  const toCall = figures.call_list_count

  return (
    <section className="card wide dashboard">
      <h2>Dashboard</h2>
      <p className="hint as-of">As of {formatDate(figures.as_of)}</p>

      <div className="group owed">
        <Link to="/mortgages" className="headline">
          <span className="hint">Owed on Active Mortgages</span>
          <strong>{formatINR(owed)}</strong>
          <span className="hint">
            across {figures.active_mortgages} Mortgage{figures.active_mortgages === 1 ? '' : 's'}{' '}
            and {figures.customers_with_active_mortgages} Customer
            {figures.customers_with_active_mortgages === 1 ? '' : 's'}
          </span>
        </Link>
        <div className="tiles">
          <Figure
            to="/mortgages"
            label="Principal Outstanding"
            value={formatINR(figures.principal_outstanding)}
          />
          <Figure
            to="/mortgages"
            label="Unpaid interest"
            value={formatINR(figures.unpaid_interest)}
          />
          <Figure to="/mortgages" label="Active Mortgages" value={figures.active_mortgages} />
          <Figure
            to="/customers?active=true"
            label="Customers with Active Mortgages"
            value={figures.customers_with_active_mortgages}
          />
        </div>
      </div>

      <div className="group money-in">
        <h3>Interest collected</h3>
        <div className="tiles">
          <Figure
            to={`/payments?month=${month}&include_voided=false`}
            label={`In ${thisMonth}`}
            value={formatINR(figures.interest_collected_this_month)}
          />
          <Figure
            to={`/payments?year=${year}&include_voided=false`}
            label={`In ${year}`}
            value={formatINR(figures.interest_collected_this_year)}
          />
        </div>
      </div>

      <div className="group collateral">
        <h3>Collateral</h3>
        <div className="tiles">
          <Figure
            to="/mortgages"
            label="Collateral Value"
            value={formatINR(figures.collateral_value)}
            note={figures.loan_to_value === null ? 'No Gold Rate or value set yet' : undefined}
          />
          <Figure
            to="/mortgages"
            label="Loan-to-Value"
            value={figures.loan_to_value === null ? '—' : formatPercent(figures.loan_to_value)}
            note="Outstanding ÷ Collateral Value, where valued"
          />
          <Figure
            to="/call-list"
            label="On today's Call List"
            value={toCall}
            note={toCall > 0 ? <span className="flag warn">To phone today</span> : 'Nobody to call'}
          />
        </div>
      </div>

      <div className="group closed">
        <h3>Closed in {thisMonth}</h3>
        <div className="tiles">
          <Figure
            to={`/mortgages?status=redeemed&closed_in=${month}`}
            label="Redeemed"
            value={figures.redeemed_this_month}
          />
          <Figure
            to={`/mortgages?status=forfeited&closed_in=${month}`}
            label="Forfeited"
            value={figures.forfeited_this_month}
            note={
              figures.forfeited_this_month ? (
                <span className={`flag ${profitLoss >= 0 ? 'good' : 'bad'}`}>
                  {profitLoss >= 0 ? 'Profit' : 'Loss'} {formatINR(Math.abs(profitLoss))}
                </span>
              ) : undefined
            }
          />
        </div>
      </div>

      <div className="group ahead">
        <h3>Looking ahead</h3>
        <Projections figures={figures} />
      </div>

      <div className="group money-in">
        <h3>Payments received each month, and the year ahead</h3>
        <PaymentsByMonthChart months={figures.payments_by_month} coming={figures.coming_months} />
      </div>
    </section>
  )
}
