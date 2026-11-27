import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import type { Mortgage } from '../../api'
import { PreviewSection } from '../../components/BeforeAfter'
import { Summary } from '../../components/ConfirmDialog'
import { PaymentMethodSelect } from '../../components/PaymentMethodSelect'
import { RupeeInput } from '../../components/RupeeInput'
import { formatDate, formatDays } from '../../format'
import { formatINR } from '../../money'
import { outstandingOnClosureQuery } from '../../requests'
import { useServerState } from '../../serverState'
import { PART_MONTH_RULES } from '../../terms'
import { useClosingDraft, type ClosingKind } from './useClosingDraft'

type Action = ClosingKind

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
  /** Open straight into Redeem or Forfeit (e.g. from the Closures page). */
  initialAction?: Action | null
  onCancel?: () => void
}) {
  const [action, setAction] = useState<Action | null>(initialAction)
  const draft = useClosingDraft({
    kind: action,
    mortgages: [mortgage],
    onSaved: ([closed]) => onClosed(closed),
  })
  const { closing, preview, submit, canSave, error, confirmDialog, closureOf, methods } = draft
  const amount = draft.amountOf(mortgage.id)
  const { client } = useServerState()

  // The Outstanding on the chosen date: a quote, even for a future date.
  const quoted = useQuery({
    ...outstandingOnClosureQuery(client, mortgage.id, draft.on.value),
    enabled: Boolean(action && draft.on.value),
  })
  const quote = quoted.data ?? null
  const quoteError = quoted.error?.message

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
          Redeem when it is paid in full and the jewellery goes back; Waive off when a small balance
          is let off and the jewellery goes back; Forfeit if the Customer defaulted.
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
        <input type="date" required min={mortgage.start_date} {...draft.on} />
      </label>

      {quoteError && <p className="status error">{quoteError}</p>}
      {quote && (
        <Summary
          rows={[
            ['Principal', formatINR(quote.principal)],
            ['Unpaid interest', formatINR(quote.unpaid_interest)],
            [
              'Interest to Date',
              `${formatINR(quote.interest_to_date)} (${formatDays(quote.interest_to_date_days)} of ` +
                `the month, that day included; ${PART_MONTH_RULES[quote.part_month_rule]})`,
            ],
            [
              `Outstanding on ${formatDate(draft.on.value)}`,
              quote.advance_held ? (
                formatINR(quote.total)
              ) : (
                <strong key="total">{formatINR(quote.total)}</strong>
              ),
            ],
            ...(quote.advance_held
              ? ([
                  ['Advance held', `− ${formatINR(quote.advance_held)}`],
                  ['To pay', <strong key="to-pay">{formatINR(quote.to_pay)}</strong>],
                ] satisfies [string, React.ReactNode][])
              : []),
          ]}
        />
      )}

      {action === 'redeem' ? (
        <div className="grid-2">
          <label>
            Final Payment method
            <PaymentMethodSelect methods={methods} {...draft.method} />
          </label>
          <label>
            Reference (optional)
            <input {...draft.reference} />
          </label>
        </div>
      ) : action === 'waive' ? (
        <>
          <label>
            Received now (₹): the final Payment; the rest of the Outstanding is let off
            <RupeeInput required min="0" {...amount} />
            {waived !== null && (
              <span className="status warning">Waived off: {formatINR(waived)}</span>
            )}
          </label>
          {draft.paying && (
            <div className="grid-2">
              <label>
                Final Payment method
                <PaymentMethodSelect methods={methods} {...draft.method} />
              </label>
              <label>
                Reference (optional)
                <input {...draft.reference} />
              </label>
            </div>
          )}
          <label>
            Reason
            <input placeholder="e.g. small balance let off" {...draft.note} />
          </label>
        </>
      ) : (
        <>
          <label>
            Recovered Amount (₹): sale price, or value if you keep the jewellery
            <RupeeInput required min="0" {...amount} />
            {profitLoss !== null && <ProfitLoss amount={profitLoss} />}
          </label>
          <label>
            Note
            <input placeholder="e.g. sold to whom" {...draft.note} />
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
            ? `Redeem${quote ? ` for ${formatINR(quote.to_pay)}` : ''}`
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

/** The Advance held a Closure applied, as a Summary row; none if there was none. */
function advanceHeld(amount: number): [string, string][] {
  return amount ? [['Advance held', formatINR(amount)]] : []
}

/** How a closed Mortgage ended. */
export function ClosureSummary({ mortgage }: { mortgage: Mortgage }) {
  const closure = mortgage.closure
  if (!closure) return null
  if (closure.kind === 'redeemed') {
    return (
      <div className="close-panel">
        <strong>Redeemed on {formatDate(closure.on)}</strong>, paying its Outstanding of{' '}
        {formatINR(closure.outstanding)}
        {closure.advance_held > 0 && (
          <>, {formatINR(closure.advance_held)} of it from the Advance held</>
        )}
        .{' '}
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
            ['Outstanding on the Closure date', formatINR(closure.outstanding)],
            ...advanceHeld(closure.advance_held),
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
          ['Outstanding on the Closure date', formatINR(closure.outstanding)],
          ...advanceHeld(closure.advance_held),
          ['Recovered Amount', formatINR(closure.recovered_amount ?? 0)],
          ['Result', <ProfitLoss key="result" amount={closure.profit_loss ?? 0} />],
          ['Note', closure.note ?? '—'],
        ]}
      />
    </div>
  )
}
