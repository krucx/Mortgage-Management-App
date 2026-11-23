import { Link } from 'react-router'
import type { Mortgage } from '../../api'
import { PersonLink } from '../../components/PersonLink'
import { lentThroughName, usePaymentMethods } from '../../components/usePaymentMethods'
import { formatDate, formatGrams } from '../../format'
import { formatINR } from '../../money'

/** The Mortgage's name, status and Customer, what it owes today, and how it was lent. */
export function MortgageOverview({ mortgage }: { mortgage: Mortgage }) {
  const methods = usePaymentMethods()
  const { outstanding } = mortgage
  return (
    <>
      <div className="row spread">
        <h2>
          {mortgage.name}{' '}
          <span className={`badge status-${mortgage.status}`}>{mortgage.status}</span>
        </h2>
        <div className="row">
          <span>
            Customer: <PersonLink person={mortgage.customer} />
          </span>
          <Link className="button secondary small" to={`/mortgages/${mortgage.id}/edit`}>
            Edit
          </Link>
          {mortgage.status === 'active' && (
            <Link
              className="button small"
              to={`/payments/new?customer=${mortgage.customer.id}&mortgage=${mortgage.id}`}
            >
              Record a Payment
            </Link>
          )}
        </div>
      </div>

      <div className="tiles">
        <div className="tile">
          <span className="hint">Outstanding on {formatDate(mortgage.as_of)}</span>
          <strong>{formatINR(outstanding.total)}</strong>
        </div>
        <div className="tile">
          <span className="hint">Principal</span>
          <strong>{formatINR(outstanding.principal)}</strong>
        </div>
        <div className="tile">
          <span className="hint">Unpaid interest</span>
          <strong>{formatINR(outstanding.unpaid_interest)}</strong>
        </div>
        {mortgage.advance_instalments.length > 0 && (
          <div className="tile">
            <span className="hint">Advance held</span>
            <strong>{formatINR(mortgage.advance_held)}</strong>
          </div>
        )}
      </div>

      <dl>
        <dt>Started</dt>
        <dd>{formatDate(mortgage.start_date)}</dd>
        <dt>Principal lent</dt>
        <dd>{formatINR(mortgage.amount_lent)}</dd>
        <dt>Lent Through</dt>
        <dd>{lentThroughName(methods, mortgage.lent_through)}</dd>
        <dt>Jewellery</dt>
        <dd>{mortgage.description}</dd>
        <dt>Weight</dt>
        <dd>
          {formatGrams(mortgage.gross_weight_mg)} gross, {formatGrams(mortgage.net_weight_mg)} net,{' '}
          {mortgage.purity_karat}K
        </dd>
      </dl>
    </>
  )
}
