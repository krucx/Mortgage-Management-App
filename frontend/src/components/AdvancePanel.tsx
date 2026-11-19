import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import type { AdvanceInstalment, Mortgage } from '../api'
import { formatDate } from '../format'
import { formatINR } from '../money'
import { advanceReceiptQuery, changes, previews } from '../requests'
import { useMortgageChange, useServerState } from '../serverState'
import { ChangePreview } from './BeforeAfter'
import { ReceiptPanel } from './ReceiptPanel'
import { useConfirm } from './useConfirm'

/** Each Advance on the Mortgage, part by part (ADR 0021); an upcoming part can be
 *  cancelled, which applies its amount today and has a Receipt of its own. */
export function AdvancePanel({
  mortgage,
  onChange,
}: {
  mortgage: Mortgage
  onChange: (updated: Mortgage) => void
}) {
  const [error, setError] = useState<string | null>(null)
  // The part being cancelled, until the write settles: no second cancel meanwhile.
  const [cancelling, setCancelling] = useState<number | null>(null)
  // The cancelled part whose Receipt is shown: the one just cancelled, or one reopened.
  const [receiptOf, setReceiptOf] = useState<AdvanceInstalment | null>(null)
  const [confirm, confirmDialog] = useConfirm()
  const changeMortgage = useMortgageChange()
  // One Advance per Payment, its parts by date.
  const advances = new Map<number, AdvanceInstalment[]>()
  for (const part of mortgage.advance_instalments) {
    advances.set(part.payment_id, [...(advances.get(part.payment_id) ?? []), part])
  }

  async function cancel(instalment: AdvanceInstalment) {
    const confirmed = await confirm({
      title: `Cancel the Advance Instalment due ${formatDate(instalment.on)}?`,
      body: (
        <>
          <p>
            Its {formatINR(instalment.amount)} is applied today, {formatDate(mortgage.as_of)}, like
            any Payment: unpaid interest, then the Interest to Date, then Principal. Nothing is
            refunded, and it stays on record as Cancelled.
          </p>
          <ChangePreview request={previews.advanceInstalmentCancel(mortgage.id, instalment.id)} />
        </>
      ),
      wide: true,
      confirmLabel: 'Cancel this Advance Instalment',
      cancelLabel: 'Keep it',
      danger: true,
    })
    if (!confirmed) return
    setCancelling(instalment.id)
    setError(null)
    try {
      onChange(
        await changeMortgage((client) =>
          changes.cancelAdvanceInstalment(client, mortgage.id, instalment.id),
        ),
      )
      setReceiptOf(instalment)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCancelling(null)
    }
  }

  return (
    <div className="stack">
      {[...advances].map(([paymentId, parts]) => (
        <div key={paymentId}>
          <p>
            <Link to={`/payments/${paymentId}`}>Received {formatDate(parts[0].received_on)}</Link> ·{' '}
            {formatINR(parts.reduce((sum, part) => sum + part.amount, 0))} over {parts[0].of}{' '}
            {parts[0].of === 1 ? 'month' : 'months'}
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Accrual Date</th>
                  <th className="num">Amount</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {parts.map((part) => (
                  <tr key={part.id} className={part.cancelled_on ? 'cancelled' : undefined}>
                    <td>{formatDate(part.on)}</td>
                    <td className="num">{formatINR(part.amount)}</td>
                    <td>
                      <span className="badge">{status(part)}</span>
                    </td>
                    <td>
                      {part.cancelled_on && (
                        <button
                          type="button"
                          className="secondary small"
                          onClick={() => setReceiptOf(part)}
                        >
                          Receipt
                        </button>
                      )}
                      {part.upcoming && mortgage.status === 'active' && (
                        <button
                          type="button"
                          className="secondary small"
                          disabled={cancelling !== null}
                          onClick={() => cancel(part)}
                        >
                          Cancel…
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {error && <p className="status error">{error}</p>}
      {receiptOf && <CancelReceipt instalment={receiptOf} />}
      {confirmDialog}
    </div>
  )
}

function status(part: AdvanceInstalment): string {
  if (part.cancelled_on) return `Cancelled on ${formatDate(part.cancelled_on)}`
  return part.upcoming ? 'Upcoming' : 'Applied'
}

/** The Receipt for a cancelled part, to send on WhatsApp or print. */
function CancelReceipt({ instalment }: { instalment: AdvanceInstalment }) {
  const { client } = useServerState()
  const { data: receipt, error } = useQuery(
    advanceReceiptQuery(client, instalment.payment_id, instalment.id),
  )

  if (error) return <p className="status error">{error.message}</p>
  if (!receipt) return null
  return (
    <div>
      <h4>Receipt for the part due {formatDate(instalment.on)}</h4>
      <ReceiptPanel
        receipt={receipt}
        printPath={`/payments/${instalment.payment_id}/advance-instalments/${instalment.id}/receipt`}
      />
    </div>
  )
}
