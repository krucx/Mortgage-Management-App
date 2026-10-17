import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api, PAYMENT_METHODS, type Payment } from '../api'
import { PersonLink } from '../components/PersonLink'
import { ChangePreview } from '../components/BeforeAfter'
import { ReasonDialog } from '../components/ReasonDialog'
import { formatDate, formatDateTime } from '../format'
import { formatINR } from '../money'

/** One Payment and how it was allocated across Mortgages. */
export function PaymentPage() {
  const id = Number(useParams().id)
  const [payment, setPayment] = useState<Payment | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [voiding, setVoiding] = useState(false)

  useEffect(() => {
    api
      .getPayment(id)
      .then(setPayment)
      .catch((err: Error) => setError(err.message))
  }, [id])

  if (!payment) return error ? <p className="status error">{error}</p> : <p>Loading…</p>

  return (
    <section className="card wide">
      <div className="row spread">
        <h2>
          Payment of {formatINR(payment.amount)}{' '}
          {payment.voided_at && <span className="badge status-forfeited">voided</span>}
        </h2>
        {!payment.voided_at && (
          <button type="button" className="danger small" onClick={() => setVoiding(true)}>
            Void…
          </button>
        )}
      </div>
      {payment.voided_at && (
        <p className="status error">
          Voided {formatDateTime(payment.voided_at)}: {payment.void_reason}. It is kept on
          record but counts towards no Mortgage.
        </p>
      )}
      <dl>
        <dt>From</dt>
        <dd>
          <PersonLink person={payment.customer} />
        </dd>
        <dt>Received</dt>
        <dd>{formatDate(payment.paid_on)}</dd>
        <dt>Method</dt>
        <dd>{PAYMENT_METHODS[payment.method]}</dd>
        <dt>Reference</dt>
        <dd>{payment.reference ?? '—'}</dd>
      </dl>

      <h3>Allocations</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Mortgage</th>
              <th className="num">Allocation</th>
              <th className="num">To interest</th>
              <th className="num">To Principal</th>
            </tr>
          </thead>
          <tbody>
            {payment.allocations.map((allocation) => (
              <tr key={allocation.mortgage_id}>
                <td>
                  <Link to={`/mortgages/${allocation.mortgage_id}`}>
                    {allocation.mortgage_name}
                  </Link>
                </td>
                <td className="num">{formatINR(allocation.amount)}</td>
                <td className="num">
                  {allocation.interest_paid === null ? '—' : formatINR(allocation.interest_paid)}
                </td>
                <td className="num">
                  {allocation.principal_paid === null ? '—' : formatINR(allocation.principal_paid)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {voiding && (
        <ReasonDialog
          title={`Void this Payment of ${formatINR(payment.amount)}?`}
          wide
          body={
            <>
              <p>
                It stays on record but is taken out of every Ledger. Enter a corrected Payment
                afterwards if needed.
              </p>
              <ChangePreview load={() => api.previewVoid(payment.id)} />
            </>
          }
          confirmLabel="Void Payment"
          onConfirm={async (reason) => setPayment(await api.voidPayment(payment.id, reason))}
          onClose={() => setVoiding(false)}
        />
      )}
    </section>
  )
}
