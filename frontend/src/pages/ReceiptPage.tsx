import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api, type Receipt } from '../api'
import { formatDate } from '../format'
import { formatINR } from '../money'

/** A Receipt to print or save as PDF: the same content as the WhatsApp message. */
export function ReceiptPage() {
  const id = Number(useParams().id)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getReceipt(id).then(setReceipt, (err: Error) => setError(err.message))
  }, [id])

  if (error) return <p className="status error">{error}</p>
  if (!receipt) return <p>Loading…</p>

  return (
    <section className="card wide receipt">
      <div className="row spread no-print">
        <Link to={`/payments/${receipt.payment_id}`}>← Back to the Payment</Link>
        <button type="button" onClick={() => window.print()}>
          Print or save as PDF
        </button>
      </div>
      <h2>Payment receipt</h2>
      <dl className="summary">
        <div className="summary-row">
          <dt>Received from</dt>
          <dd>{receipt.customer.name}</dd>
        </div>
        <div className="summary-row">
          <dt>Date</dt>
          <dd>{formatDate(receipt.paid_on)}</dd>
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
            <th className="num">Paid</th>
            <th className="num">Interest</th>
            <th className="num">Principal</th>
            <th className="num">Still owed</th>
          </tr>
        </thead>
        <tbody>
          {receipt.lines.map((line) => (
            <tr key={line.mortgage_id}>
              <td>{line.description}</td>
              <td className="num">{formatINR(line.paid)}</td>
              <td className="num">{formatINR(line.interest_paid)}</td>
              <td className="num">{formatINR(line.principal_paid)}</td>
              <td className="num">{formatINR(line.owed_after)}</td>
            </tr>
          ))}
        </tbody>
        {receipt.lines.length > 1 && (
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td className="num">{formatINR(receipt.amount)}</td>
              <td />
              <td />
              <td className="num">{formatINR(receipt.total_owed)}</td>
            </tr>
          </tfoot>
        )}
      </table>
      <p className="hint">Each payment pays interest first, then Principal.</p>
    </section>
  )
}
