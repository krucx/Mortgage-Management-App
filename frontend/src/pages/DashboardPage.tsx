import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { api, LEDGER_CHANGED, type Dashboard } from '../api'
import { CollectionsChart } from '../components/CollectionsChart'
import { formatPercent, monthName } from '../format'
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
  note?: string
}) {
  return (
    <Link to={to} className="tile figure">
      <span className="hint">{label}</span>
      <strong>{value}</strong>
      {note && <span className="hint">{note}</span>}
    </Link>
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

  const thisMonth = monthName(figures.as_of.slice(0, 7))
  const profitLoss = figures.forfeiture_profit_loss_this_month

  return (
    <section className="card wide dashboard">
      <h2>Dashboard</h2>

      <h3>Owed on Active Mortgages</h3>
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
          to="/customers"
          label="Customers with Active Mortgages"
          value={figures.customers_with_active_mortgages}
        />
      </div>

      <h3>Interest collected</h3>
      <div className="tiles">
        <Figure
          to="/payments"
          label={`In ${thisMonth}`}
          value={formatINR(figures.interest_collected_this_month)}
        />
        <Figure
          to="/payments"
          label={`In ${figures.as_of.slice(0, 4)}`}
          value={formatINR(figures.interest_collected_this_year)}
        />
      </div>

      <h3>Security</h3>
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
        <Figure to="/call-list" label="On today's Call List" value={figures.call_list_count} />
      </div>

      <h3>Closed in {thisMonth}</h3>
      <div className="tiles">
        <Figure
          to="/mortgages?status=redeemed"
          label="Redeemed"
          value={figures.redeemed_this_month}
        />
        <Figure
          to="/mortgages?status=forfeited"
          label="Forfeited"
          value={figures.forfeited_this_month}
          note={
            figures.forfeited_this_month
              ? `${profitLoss >= 0 ? 'Profit' : 'Loss'} ${formatINR(Math.abs(profitLoss))}`
              : undefined
          }
        />
      </div>

      <h3>Payments received each month</h3>
      <CollectionsChart months={figures.monthly_collections} />
    </section>
  )
}
