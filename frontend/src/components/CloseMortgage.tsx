import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import type { Mortgage, PaymentMethod } from '../api'
import { formatDate, todayIso } from '../format'
import { formatINR, rupeesToPaise } from '../money'
import { redemptionQuery } from '../requests'
import { useServerState } from '../serverState'
import { PART_MONTH_RULES } from '../terms'
import { PreviewSection } from './BeforeAfter'
import { Summary } from './ConfirmDialog'
import { useClosing, type Closing } from './useClosing'
import { PaymentMethodSelect } from './PaymentMethodSelect'
import { usePaymentMethods } from './usePaymentMethods'

type Action = 'redeem' | 'waive' | 'forfeit'

const ACTION_NAMES: Record<Action, string> = {
  redeem: 'Redeem',
  waive: 'Waive off',
  forfeit: 'Forfeit',
}
const CLOSED_ON: Record<Action, string> = {
  redeem: 'Redeemed on',
  waive: 'Waived on',
  forfeit: 'Forfeited on',
}

/** A profit (green) or loss (red) in rupees. */
function ProfitLoss({ amount }: { amount: number }) {
  return (
    <span className={`status ${amount >= 0 ? 'saved' : 'error'}`}>
      {amount >= 0 ? 'Profit' : 'Loss'} of {formatINR(Math.abs(amount))}
    </span>
  )
}

/** The Closure of an Active Mortgage: Redeem it (paid in full), Waive off what is left
 *  (paid in part, the rest let off) or Forfeit it (defaulted). */
export function CloseMortgage({
  mortgage,
  onClosed,
  initialAction = null,
  onCancel,
}: {
  mortgage: Mortgage
  onClosed: (updated: Mortgage) => void
  /** Open straight into Redeem or Forfeit (e.g. from the Redeem / Forfeit page). */
  initialAction?: Action | null
  onCancel?: () => void
}) {
  const [action, setAction] = useState<Action | null>(initialAction)
  const [on, setOn] = useState(todayIso())
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const methods = usePaymentMethods()
  const [reference, setReference] = useState('')
  const [recovered, setRecovered] = useState('')
  const [received, setReceived] = useState('')
  const [note, setNote] = useState('')
  const { client } = useServerState()

  // The Redemption Amount on the chosen date: a quote, even for a future date.
  const quote = useQuery({
    ...redemptionQuery(client, mortgage.id, on),
    enabled: Boolean(action && on),
  })
  const redemption = quote.data ?? null
  const quoteError = quote.error?.message
  const receivedPaise = rupeesToPaise(received || '0')
  const paymentReference = reference.trim() || null

  // What saving would send, as a closing of this one Mortgage; re-previewed as it changes.
  const closing: Closing | null =
    !action || !on
      ? null
      : action === 'redeem'
        ? {
            kind: 'redeem',
            redeem: { redeemed_on: on, method, reference: paymentReference, mortgage_ids: [mortgage.id] },
          }
        : action === 'waive'
          ? received === ''
            ? null
            : {
                kind: 'waive',
                waive: {
                  waived_on: on,
                  method,
                  reference: paymentReference,
                  note,
                  mortgages: [{ mortgage_id: mortgage.id, amount_paid: receivedPaise }],
                },
              }
          : recovered === ''
            ? null
            : {
                kind: 'forfeit',
                forfeit: {
                  forfeited_on: on,
                  note,
                  mortgages: [
                    { mortgage_id: mortgage.id, recovered_amount: rupeesToPaise(recovered) },
                  ],
                },
              }
  const { preview, submit, canSave, error, confirmDialog, closureOf } = useClosing({
    closing,
    confirm: () => {
      const closure = closureOf(mortgage.id)
      return action === 'waive'
        ? {
            title: `Waive off ${mortgage.name}?`,
            body: (
              <>
                <Summary
                  rows={[
                    ['Waived on', formatDate(on)],
                    ['Redemption Amount', formatINR(closure?.redemption_amount ?? 0)],
                    [
                      'Final Payment',
                      closure?.payment_amount
                        ? `${formatINR(closure.payment_amount)} · ${methods?.[method] ?? ''}` +
                          (paymentReference ? ` · ${paymentReference}` : '')
                        : 'None',
                    ],
                    [
                      'Waived off',
                      <strong key="waived">{formatINR(closure?.waived_amount ?? 0)}</strong>,
                    ],
                    ['Reason', note.trim() || '—'],
                  ]}
                />
                <p className="hint">Return the jewellery to {mortgage.customer.name}.</p>
              </>
            ),
            confirmLabel: 'Confirm Waiver',
          }
        : action === 'redeem'
          ? {
              title: `Redeem ${mortgage.name}?`,
              body: (
                <>
                  <Summary
                    rows={[
                      ['Redeemed on', formatDate(on)],
                      ['Final Payment', formatINR(closure?.payment_amount ?? 0)],
                      ['Method', (methods?.[method] ?? '') + (paymentReference ? ` · ${paymentReference}` : '')],
                    ]}
                  />
                  <p className="hint">Return the jewellery to {mortgage.customer.name}.</p>
                </>
              ),
              confirmLabel: 'Confirm Redemption',
            }
          : {
              title: `Forfeit ${mortgage.name}?`,
              body: (
                <Summary
                  rows={[
                    ['Forfeited on', formatDate(on)],
                    ['Redemption Amount', formatINR(closure?.redemption_amount ?? 0)],
                    ['Recovered Amount', formatINR(closure?.recovered_amount ?? 0)],
                    ['Profit / loss', formatINR(closure?.profit_loss ?? 0)],
                    ['Note', note.trim() || '—'],
                  ]}
                />
              ),
              confirmLabel: 'Confirm Forfeiture',
              danger: true,
            }
    },
    saved: ([closed]) => onClosed(closed),
  })
  // The Closure as the Preview has it; nothing while the backend would refuse it.
  const proposedClosure = preview.error ? null : closureOf(mortgage.id)
  const waived = proposedClosure?.waived_amount ?? null
  const profitLoss = proposedClosure?.profit_loss ?? null

  if (!action) {
    return (
      <div className="row">
        <button type="button" onClick={() => setAction('redeem')}>
          Redeem…
        </button>
        <button type="button" className="secondary" onClick={() => setAction('waive')}>
          Waive off…
        </button>
        <button type="button" className="danger" onClick={() => setAction('forfeit')}>
          Forfeit…
        </button>
        <span className="hint">
          Redeem when it is paid in full and the jewellery goes back; Waive off when a small
          balance is let off and the jewellery goes back; Forfeit if the Customer defaulted.
        </span>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="stack close-panel">
      <div className="row spread">
        <strong>{ACTION_NAMES[action]} this Mortgage</strong>
        <button
          type="button"
          className="secondary small"
          onClick={() => (onCancel ? onCancel() : setAction(null))}
        >
          Cancel
        </button>
      </div>
      <label>
        {CLOSED_ON[action]}
        <input
          type="date"
          required
          min={mortgage.start_date}
          value={on}
          onChange={(event) => setOn(event.target.value)}
        />
      </label>

      {quoteError && <p className="status error">{quoteError}</p>}
      {redemption && (
        <Summary
          rows={[
            ['Principal', formatINR(redemption.principal)],
            ['Unpaid interest', formatINR(redemption.unpaid_interest)],
            [
              'Part-month',
              `${formatINR(redemption.part_month_charge)} (${redemption.part_month_days} days since ` +
                `the last Accrual Date; ${PART_MONTH_RULES[mortgage.terms.part_month_rule]})`,
            ],
            ['Redemption Amount', <strong key="total">{formatINR(redemption.total)}</strong>],
          ]}
        />
      )}

      {action === 'redeem' ? (
        <div className="grid-2">
          <label>
            Final Payment method
            <PaymentMethodSelect methods={methods} value={method} onChange={setMethod} />
          </label>
          <label>
            Reference (optional)
            <input value={reference} onChange={(event) => setReference(event.target.value)} />
          </label>
        </div>
      ) : action === 'waive' ? (
        <>
          <label>
            Received now (₹): the final Payment; the rest of the Redemption Amount is let off
            <input
              type="number"
              required
              min="0"
              step="0.01"
              value={received}
              onChange={(event) => setReceived(event.target.value)}
            />
            {waived !== null && (
              <span className="status warning">Waived off: {formatINR(waived)}</span>
            )}
          </label>
          {receivedPaise > 0 && (
            <div className="grid-2">
              <label>
                Final Payment method
                <PaymentMethodSelect methods={methods} value={method} onChange={setMethod} />
              </label>
              <label>
                Reference (optional)
                <input value={reference} onChange={(event) => setReference(event.target.value)} />
              </label>
            </div>
          )}
          <label>
            Reason
            <input
              placeholder="e.g. small balance let off"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
        </>
      ) : (
        <>
          <label>
            Recovered Amount (₹): sale price, or value if you keep the jewellery
            <input
              type="number"
              required
              min="0"
              step="0.01"
              value={recovered}
              onChange={(event) => setRecovered(event.target.value)}
            />
            {profitLoss !== null && <ProfitLoss amount={profitLoss} />}
          </label>
          <label>
            Note
            <input
              placeholder="e.g. sold to whom"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
        </>
      )}

      {closing && (
        <>
          <h3>What changes</h3>
          <PreviewSection preview={preview} />
        </>
      )}

      <div className="row">
        <button
          type="submit"
          className={action === 'forfeit' ? 'danger-solid' : ''}
          disabled={!canSave || !proposedClosure}
        >
          {action === 'redeem'
            ? `Redeem${redemption ? ` for ${formatINR(redemption.total)}` : ''}`
            : action === 'waive'
              ? `Waive off${waived !== null && waived > 0 ? ` ${formatINR(waived)}` : ''}`
              : 'Forfeit'}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => (onCancel ? onCancel() : setAction(null))}
        >
          Cancel
        </button>
      </div>
      {error && <p className="status error">{error}</p>}
      {confirmDialog}
    </form>
  )
}

/** How a closed Mortgage ended. */
export function ClosureSummary({ mortgage }: { mortgage: Mortgage }) {
  const closure = mortgage.closure
  if (!closure) return null
  if (closure.kind === 'redeemed') {
    return (
      <div className="close-panel">
        <strong>Redeemed on {formatDate(closure.on)}</strong>, Redemption Amount{' '}
        {formatINR(closure.redemption_amount)}.{' '}
        {closure.payment_id && (
          <Link to={`/payments/${closure.payment_id}`}>Final Payment (receipt)</Link>
        )}
      </div>
    )
  }
  if (closure.kind === 'waived') {
    return (
      <div className="close-panel">
        <strong>Waived off on {formatDate(closure.on)}</strong>
        <Summary
          rows={[
            ['Redemption Amount', formatINR(closure.redemption_amount)],
            [
              'Final Payment',
              closure.payment_id ? (
                <Link key="paid" to={`/payments/${closure.payment_id}`}>
                  {formatINR(closure.payment_amount ?? 0)} (receipt)
                </Link>
              ) : (
                'None'
              ),
            ],
            ['Waived off', formatINR(closure.waived_amount ?? 0)],
            ['Reason', closure.note ?? '—'],
          ]}
        />
      </div>
    )
  }
  return (
    <div className="close-panel">
      <strong>Forfeited on {formatDate(closure.on)}</strong>
      <Summary
        rows={[
          ['Redemption Amount', formatINR(closure.redemption_amount)],
          ['Recovered Amount', formatINR(closure.recovered_amount ?? 0)],
          ['Result', <ProfitLoss key="result" amount={closure.profit_loss ?? 0} />],
          ['Note', closure.note ?? '—'],
        ]}
      />
    </div>
  )
}
