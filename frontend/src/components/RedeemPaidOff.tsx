import { useQueries } from '@tanstack/react-query'
import { useState } from 'react'
import type { Payment } from '../api'
import { formatDate } from '../format'
import { formatINR } from '../money'
import { mortgageQuery, redemptionQuery } from '../requests'
import { useServerState } from '../serverState'
import { PART_MONTH_RULES } from '../terms'
import { PreviewSection } from './BeforeAfter'
import { Modal } from './Modal'
import { useClosing } from './useClosing'

/**
 * Shown after a Payment leaves one or more Mortgages Ready to Redeem: offer to Redeem
 * them on the Payment date, all of them or (if the backend refuses any) none. Any
 * Part-Month Rule charge is recorded as the final Payment, made as the Payment was.
 */
export function RedeemPaidOff({
  payment,
  mortgages,
  onDone,
}: {
  payment: Payment
  mortgages: { id: number; name: string }[]
  onDone: () => void
}) {
  const [chosen, setChosen] = useState<Set<number>>(new Set(mortgages.map((m) => m.id)))
  const { client } = useServerState()
  const { preview, submit, saving, canSave, error } = useClosing({
    closing:
      chosen.size === 0
        ? null
        : {
            kind: 'redeem',
            redeem: {
              redeemed_on: payment.paid_on,
              method: payment.method,
              reference: payment.reference,
              mortgage_ids: mortgages.filter((m) => chosen.has(m.id)).map((m) => m.id),
              received_with: payment.id,
            },
          },
    confirm: null, // this dialog is the confirmation
    saved: onDone,
  })
  // Each one's Redemption Amount on the Payment date (or why there is none), and the
  // Part-Month Rule behind any charge.
  const quoted = useQueries({
    queries: mortgages.map((m) => redemptionQuery(client, m.id, payment.paid_on)),
  })
  const terms = useQueries({ queries: mortgages.map((m) => mortgageQuery(client, m.id)) })
  const quotes = Object.fromEntries(
    mortgages.map((m, i) => [m.id, quoted[i].data ?? quoted[i].error?.message]),
  )
  const rules = Object.fromEntries(
    mortgages.map((m, i) => {
      const rule = terms[i].data?.terms.part_month_rule
      return [m.id, rule && PART_MONTH_RULES[rule]]
    }),
  )

  // Paid up to their last Accrual Dates: one date for the title when they share it.
  const lastAccrualDates = new Set(
    Object.values(quotes).flatMap((quote) => (typeof quote === 'object' ? [quote.last_accrual_on] : [])),
  )
  const sharedLastAccrual = lastAccrualDates.size === 1 ? [...lastAccrualDates][0] : null

  function toggle(id: number) {
    const next = new Set(chosen)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setChosen(next)
  }

  return (
    <Modal onClose={onDone} className="wide-dialog">
      <form onSubmit={submit}>
        <h2>{sharedLastAccrual ? `Paid up to ${formatDate(sharedLastAccrual)}` : 'Paid up'}: Redeem now?</h2>
        <p>
          Principal and interest are fully paid on{' '}
          {mortgages.length > 1 ? 'these Mortgages' : 'this Mortgage'}. Redeem on{' '}
          {formatDate(payment.paid_on)} and hand the jewellery back?
        </p>
        <ul className="plain stack">
          {mortgages.map((m) => {
            const quote = quotes[m.id]
            return (
              <li key={m.id}>
                <label className="inline">
                  <input type="checkbox" checked={chosen.has(m.id)} onChange={() => toggle(m.id)} />
                  <strong>{m.name}</strong>
                </label>
                <div className="hint">
                  {typeof quote === 'string' ? (
                    <span className="status error">{quote}</span>
                  ) : !quote ? (
                    'Working out the Redemption Amount…'
                  ) : (
                    (sharedLastAccrual ? '' : `Paid up to ${formatDate(quote.last_accrual_on)}. `) +
                    (quote.total === 0
                      ? 'Nothing more to pay.'
                      : `The final Payment is ${formatINR(quote.total)}: the part-month charge ` +
                        `for ${quote.part_month_days} days (${rules[m.id] ?? 'Part-Month Rule'}).`)
                  )}
                </div>
              </li>
            )
          })}
        </ul>
        {chosen.size > 0 && <PreviewSection preview={preview} />}
        {error && <p className="status error">{error}</p>}
        <div className="row end">
          <button type="button" className="secondary" autoFocus onClick={onDone}>
            Not now
          </button>
          <button type="submit" disabled={!canSave || !preview.previews}>
            {saving ? 'Redeeming…' : `Redeem ${chosen.size}`}
          </button>
        </div>
      </form>
    </Modal>
  )
}
