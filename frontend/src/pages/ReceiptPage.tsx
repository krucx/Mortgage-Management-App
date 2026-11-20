import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { NotLoaded } from '../components/NotLoaded'
import { formatDate } from '../format'
import { formatINR } from '../money'
import { advanceReceiptQuery, receiptQuery } from '../requests'
import { useServerState } from '../serverState'

/** A Receipt to print or save as PDF: the same content as the WhatsApp message. With
 *  an `instalment`, the Receipt for that cancelled Advance Instalment of the Payment. */
export function ReceiptPage() {
  const params = useParams()
  const id = Number(params.id)
  const instalment = params.instalment ? Number(params.instalment) : null
  const { client } = useServerState()
  // Spread: the two queries' keys differ in type.
  const { data: receipt, error } = useQuery({
    ...(instalment === null
      ? receiptQuery(client, id)
      : advanceReceiptQuery(client, id, instalment)),
  })

  if (!receipt) {
    const payment = `Payment ${id}`
    const missing =
      instalment === null ? payment : `cancelled Advance Instalment ${instalment} of ${payment}`
    return <NotLoaded error={error} missing={missing} />
  }
  // A Grace Payment's: dated before it was received (ADR 0020).
  const grace = receipt.received_on !== null
  // Any Mortgage with an Advance in it: its parts, each with its date (ADR 0021).
  const advanced = receipt.lines.some((line) => line.advance_parts.length > 0)

  return (
    <section className="card wide receipt">
      <div className="row spread no-print">
        <Link to={`/payments/${receipt.payment_id}`}>← Back to the Payment</Link>
        <div className="row">
          <Link className="button secondary" to={`/payments/new?customer=${receipt.customer.id}`}>
            Record another Payment for same customer
          </Link>
          <button type="button" onClick={() => window.print()}>
            Print or save as PDF
          </button>
        </div>
      </div>
      <h2>{receipt.advance_due_on ? 'Advance applied' : 'Payment receipt'}</h2>
      <dl className="summary">
        <div className="summary-row">
          <dt>Received from</dt>
          <dd>{receipt.customer.name}</dd>
        </div>
        <div className="summary-row">
          <dt>Date</dt>
          <dd>
            {receipt.advance_due_on
              ? `Applied ${formatDate(receipt.paid_on)}, from the Advance part due ${formatDate(receipt.advance_due_on)}`
              : receipt.received_on
                ? `Received ${formatDate(receipt.received_on)}, counted as paid on ${formatDate(receipt.paid_on)} (Grace)`
                : formatDate(receipt.paid_on)}
          </dd>
        </div>
        <div className="summary-row">
          <dt>Amount</dt>
          <dd>
            <strong>{formatINR(receipt.amount)}</strong>
          </dd>
        </div>
        <div className="summary-row">
          <dt>Method</dt>
          <dd>
            {receipt.method}
            {receipt.reference && ` · ${receipt.reference}`}
          </dd>
        </div>
      </dl>
      <table>
        <thead>
          <tr>
            <th>Jewellery</th>
            <th className="num">{advanced ? 'Paid now' : 'Paid'}</th>
            <th className="num">Interest</th>
            <th className="num">Principal</th>
            <th className="num">Discount</th>
            <th className="num">Discount to interest</th>
            <th className="num">Discount to Principal</th>
            {grace && <th className="num">Let off (Grace)</th>}
            {advanced && <th>Advance</th>}
            <th className="num">Still owed</th>
          </tr>
        </thead>
        <tbody>
          {receipt.lines.map((line) => (
            <tr key={line.mortgage_id}>
              <td>
                {line.description}
                {line.redeemed && ' (Redeemed)'}
              </td>
              <td className="num">{formatINR(line.paid)}</td>
              <td className="num">{formatINR(line.interest_paid)}</td>
              <td className="num">{formatINR(line.principal_paid)}</td>
              <td className="num">{formatINR(line.discount)}</td>
              <td className="num">{formatINR(line.discount_interest_paid)}</td>
              <td className="num">{formatINR(line.discount_principal_paid)}</td>
              {grace && <td className="num">{formatINR(line.let_off)}</td>}
              {advanced && (
                <td>
                  {line.advance_parts.map((part) => (
                    <div key={part.on}>
                      {formatINR(part.amount)} on {formatDate(part.on)}
                    </div>
                  ))}
                </td>
              )}
              <td className="num">{formatINR(line.owed_after)}</td>
            </tr>
          ))}
        </tbody>
        {receipt.lines.length > 1 && (
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td className="num">
                {formatINR(receipt.lines.reduce((total, line) => total + line.paid, 0))}
              </td>
              <td />
              <td />
              <td className="num">
                {formatINR(receipt.lines.reduce((total, line) => total + line.discount, 0))}
              </td>
              <td />
              <td />
              {grace && (
                <td className="num">
                  {formatINR(receipt.lines.reduce((total, line) => total + line.let_off, 0))}
                </td>
              )}
              {advanced && <td />}
              <td className="num">{formatINR(receipt.total_owed)}</td>
            </tr>
          </tfoot>
        )}
      </table>
      <p className="hint">
        Cash is applied first; any Discount is applied afterwards, each to interest first and then
        Principal.
      </p>
    </section>
  )
}
