import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import type { ForfeitIn, Mortgage, PaymentMethod, RedeemIn, Redemption, WaiveIn } from '../api'
import { formatDate, todayIso } from '../format'
import { formatINR, rupeesToPaise } from '../money'
import { changes, previews, redemptionQuery } from '../requests'
import { useMortgageChange, useServerState } from '../serverState'
import { PART_MONTH_RULES } from '../terms'
import { PreviewSection } from './BeforeAfter'
import { Summary } from './ConfirmDialog'
import { useProposedChange } from './useProposedChange'
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
  const changeMortgage = useMortgageChange()

  // The Redemption Amount on the chosen date.
  const quote = useQuery({
    ...redemptionQuery(client, mortgage.id, on),
    enabled: Boolean(action && on),
  })
  const redemption = quote.data ?? null
  const quoteError = quote.error?.message
  const recoveredPaise = rupeesToPaise(recovered || '0')
  const profitLoss = redemption && recovered ? recoveredPaise - redemption.total : null
  const receivedPaise = rupeesToPaise(received || '0')
  // What the Lender lets off: the Redemption Amount less what the Customer pays now.
  const waived = redemption && received ? redemption.total - receivedPaise : null
  // Only something short of the Redemption Amount can be waived; all of it is a Redemption.
  const waiveProblem =
    redemption && action === 'waive'
      ? redemption.total === 0
        ? 'Nothing is owed on this date: Redeem it instead.'
        : waived !== null && waived <= 0
          ? `That covers the ${formatINR(redemption.total)} owed: Redeem it instead.`
          : null
      : null
  const future = on > todayIso() // a quote only: nothing can be recorded for a future date

  // What saving would send for each; re-previewed whenever it changes.
  const redeem: RedeemIn = { redeemed_on: on, method, reference: reference.trim() || null }
  const waive: WaiveIn = {
    waived_on: on,
    amount_paid: receivedPaise,
    method,
    reference: reference.trim() || null,
    note,
  }
  const forfeit: ForfeitIn = { forfeited_on: on, recovered_amount: recoveredPaise, note }
  // The Closure as it would be made: any kind, with what it takes on that date.
  type Proposed =
    | { action: 'redeem'; redemption: Redemption; body: RedeemIn }
    | { action: 'waive'; redemption: Redemption; body: WaiveIn }
    | { action: 'forfeit'; redemption: Redemption; body: ForfeitIn }
  const proposed: Proposed | null =
    !action || !redemption || future
      ? null
      : action === 'redeem'
        ? { action, redemption, body: redeem }
        : action === 'waive'
          ? waived === null || waiveProblem
            ? null
            : { action, redemption, body: waive }
          : { action, redemption, body: forfeit }
  const { preview, submit, canSave, error, confirmDialog } = useProposedChange({
    change: proposed,
    preview: (closure) =>
      closure.action === 'redeem'
        ? previews.redeem(mortgage.id, closure.body)
        : closure.action === 'waive'
          ? previews.waive(mortgage.id, closure.body)
          : previews.forfeit(mortgage.id, closure.body),
    confirm: ({ action, redemption }) =>
      action === 'waive'
        ? {
            title: `Waive off ${mortgage.name}?`,
            body: (
              <>
                <Summary
                  rows={[
                    ['Waived on', formatDate(on)],
                    ['Redemption Amount', formatINR(redemption.total)],
                    [
                      'Final Payment',
                      receivedPaise > 0
                        ? `${formatINR(receivedPaise)} · ${methods?.[method] ?? ''}` +
                          (reference.trim() ? ` · ${reference}` : '')
                        : 'None',
                    ],
                    ['Waived off', <strong key="waived">{formatINR(waived ?? 0)}</strong>],
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
                    ['Final Payment', formatINR(redemption.total)],
                    ['Method', (methods?.[method] ?? '') + (reference.trim() ? ` · ${reference}` : '')],
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
                  ['Redemption Amount', formatINR(redemption.total)],
                  ['Recovered Amount', formatINR(recoveredPaise)],
                  ['Profit / loss', profitLoss === null ? '—' : formatINR(profitLoss)],
                  ['Note', note.trim() || '—'],
                ]}
              />
            ),
            confirmLabel: 'Confirm Forfeiture',
            danger: true,
          },
    save: (closure) =>
      changeMortgage((client) =>
        closure.action === 'redeem'
          ? changes.redeem(client, mortgage.id, closure.body)
          : closure.action === 'waive'
            ? changes.waive(client, mortgage.id, closure.body)
            : changes.forfeit(client, mortgage.id, closure.body),
      ),
    saved: onClosed,
  })

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
            {waiveProblem ? (
              <span className="status error">{waiveProblem}</span>
            ) : (
              waived !== null && (
                <span className="status warning">Waived off: {formatINR(waived)}</span>
              )
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

      {redemption && !future && (
        <>
          <h3>What changes</h3>
          <PreviewSection preview={preview} />
        </>
      )}

      <div className="row">
        <button
          type="submit"
          className={action === 'forfeit' ? 'danger-solid' : ''}
          disabled={!canSave}
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
      {future && (
        <p className="hint">
          A quote for a future date; it can only be recorded on or before today.
        </p>
      )}
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
