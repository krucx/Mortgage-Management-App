import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import type { ForfeitIn, Mortgage, PaymentMethod, RedeemIn } from '../api'
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

type Action = 'redeem' | 'forfeit'

/** A profit (green) or loss (red) in rupees. */
function ProfitLoss({ amount }: { amount: number }) {
  return (
    <span className={`status ${amount >= 0 ? 'saved' : 'error'}`}>
      {amount >= 0 ? 'Profit' : 'Loss'} of {formatINR(Math.abs(amount))}
    </span>
  )
}

/** The Closure of an Active Mortgage: Redeem it (paid in full) or Forfeit it (defaulted). */
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
  const future = on > todayIso() // a quote only: nothing can be recorded for a future date

  // What saving would send; re-previewed whenever it changes.
  const redeem: RedeemIn = { redeemed_on: on, method, reference: reference.trim() || null }
  const forfeit: ForfeitIn = { forfeited_on: on, recovered_amount: recoveredPaise, note }
  const { preview, submit, canSave, error, confirmDialog } = useProposedChange({
    preview:
      !redemption || future
        ? null
        : action === 'redeem'
          ? previews.redeem(mortgage.id, redeem)
          : action === 'forfeit'
            ? previews.forfeit(mortgage.id, forfeit)
            : null,
    ready: Boolean(action && redemption && !future),
    confirm: () =>
      !redemption
        ? null
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
    save: () =>
      changeMortgage((client) =>
        action === 'redeem'
          ? changes.redeem(client, mortgage.id, redeem)
          : changes.forfeit(client, mortgage.id, forfeit),
      ),
    saved: onClosed,
  })

  if (!action) {
    return (
      <div className="row">
        <button type="button" onClick={() => setAction('redeem')}>
          Redeem…
        </button>
        <button type="button" className="danger" onClick={() => setAction('forfeit')}>
          Forfeit…
        </button>
        <span className="hint">
          Redeem when it is paid in full and the jewellery goes back; Forfeit if the Customer
          defaulted.
        </span>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="stack close-panel">
      <div className="row spread">
        <strong>{action === 'redeem' ? 'Redeem' : 'Forfeit'} this Mortgage</strong>
        <button
          type="button"
          className="secondary small"
          onClick={() => (onCancel ? onCancel() : setAction(null))}
        >
          Cancel
        </button>
      </div>
      <label>
        {action === 'redeem' ? 'Redeemed on' : 'Forfeited on'}
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
