import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import type { Payment } from '../api'
import { usePaymentMethods } from '../components/usePaymentMethods'
import { PersonLink } from '../components/PersonLink'
import { ChangePreview } from '../components/BeforeAfter'
import { ReasonDialog } from '../components/ReasonDialog'
import { SendOnWhatsApp, WhatsAppPreview } from '../components/WhatsApp'
import { formatDate, formatDateTime } from '../format'
import { formatINR } from '../money'
import { changes, paymentQuery, previews, receiptQuery } from '../requests'
import { keys, useLedgerChange, useServerState } from '../serverState'

/** One Payment and how it was allocated across Mortgages. */
export function PaymentPage() {
  const id = Number(useParams().id)
  const { client, queryClient } = useServerState()
  const { data: payment, error } = useQuery(paymentQuery(client, id))
  const setPayment = (voided: Payment) => queryClient.setQueryData(keys.payment(id), voided)
  const [voiding, setVoiding] = useState(false)
  const methods = usePaymentMethods()
  const changeLedger = useLedgerChange()

  if (!payment) return error ? <p className="status error">{error.message}</p> : <p>Loading…</p>
  // A Grace Payment's: dated before it was received (ADR 0020).
  const grace = payment.received_on !== null
  const letOff = payment.allocations.reduce((sum, a) => sum + (a.let_off ?? 0), 0)

  return (
    <section className="card wide">
      <div className="row spread">
        <h2>
          Payment of {formatINR(payment.amount)}{' '}
          {payment.voided_at && <span className="badge status-forfeited">voided</span>}
        </h2>
        {!payment.voided_at && (
          <div className="row">
            <Link
              className="button secondary small"
              to={`/payments/new?customer=${payment.customer.id}`}
            >
              Record another Payment for same customer
            </Link>
            <button type="button" className="danger small" onClick={() => setVoiding(true)}>
              Void…
            </button>
          </div>
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
        <dt>{grace ? 'Date' : 'Received'}</dt>
        <dd>
          {formatDate(payment.paid_on)}
          {payment.received_on &&
            ` · received ${formatDate(payment.received_on)} · Grace, ${formatINR(letOff)} let off`}
        </dd>
        <dt>Method</dt>
        <dd>{methods?.[payment.method]}</dd>
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
              <th className="num">Discount</th>
              <th className="num">Discount to interest</th>
              <th className="num">Discount to Principal</th>
              {grace && <th className="num">Let off</th>}
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
                <td className="num">{formatINR(allocation.discount)}</td>
                <td className="num">
                  {allocation.discount_interest_paid === null
                    ? '—'
                    : formatINR(allocation.discount_interest_paid)}
                </td>
                <td className="num">
                  {allocation.discount_principal_paid === null
                    ? '—'
                    : formatINR(allocation.discount_principal_paid)}
                </td>
                {grace && <td className="num">{formatINR(allocation.let_off ?? 0)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!payment.voided_at && <ReceiptPanel paymentId={payment.id} />}
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
              <ChangePreview request={previews.void(payment.id)} />
            </>
          }
          confirmLabel="Void Payment"
          onConfirm={async (reason) => {
            await changeLedger(
              (client) => changes.voidPayment(client, payment.id, reason),
              setPayment,
            )
          }}
          onClose={() => setVoiding(false)}
        />
      )}
    </section>
  )
}

/** The Receipt for the Customer: sent on WhatsApp, or printed. Reopen it any time. */
function ReceiptPanel({ paymentId }: { paymentId: number }) {
  const { client } = useServerState()
  const { data: receipt, error } = useQuery(receiptQuery(client, paymentId))
  const [sent, setSent] = useState(false)

  if (error) return <p className="status error">{error.message}</p>
  if (!receipt) return null
  return (
    <>
      <h3>Receipt</h3>
      <div className="receipt-panel">
        <WhatsAppPreview text={receipt.text} />
        <div className="stack">
          <SendOnWhatsApp phones={receipt.phones} text={receipt.text} onSent={() => setSent(true)} />
          {sent && <p className="hint">WhatsApp opened: press Send there.</p>}
          <Link to={`/payments/${paymentId}/receipt`}>Print or save as PDF</Link>
          <p className="hint">The wording comes from the Receipt template in Settings.</p>
        </div>
      </div>
    </>
  )
}
