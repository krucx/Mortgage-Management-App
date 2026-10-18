import { useEffect, useState } from 'react'
import { api, type Payment, type Redemption } from '../api'
import { formatDate } from '../format'
import { formatINR } from '../money'
import { changes } from '../requests'
import { useLedgerChange } from '../serverState'
import { PART_MONTH_RULES } from '../terms'
import { Modal } from './Modal'

/**
 * Shown after a Payment clears one or more Mortgages: offer to Redeem them on the
 * Payment date. Any Part-Month Rule charge is recorded as the final Payment.
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
  const [quotes, setQuotes] = useState<Record<number, Redemption | string>>({})
  const [chosen, setChosen] = useState<Set<number>>(new Set(mortgages.map((m) => m.id)))
  const [rules, setRules] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)
  const [failures, setFailures] = useState<string[]>([])
  const ids = mortgages.map((m) => m.id).join(',')
  const changeLedger = useLedgerChange()

  useEffect(() => {
    for (const id of ids.split(',').map(Number)) {
      api
        .getRedemption(id, payment.paid_on)
        .then((quote) => setQuotes((q) => ({ ...q, [id]: quote })))
        .catch((err: Error) => setQuotes((q) => ({ ...q, [id]: err.message })))
      api
        .getMortgage(id)
        .then((m) => setRules((r) => ({ ...r, [id]: PART_MONTH_RULES[m.terms.part_month_rule] })))
        .catch(() => {})
    }
  }, [ids, payment.paid_on])

  function toggle(id: number) {
    const next = new Set(chosen)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setChosen(next)
  }

  async function redeemChosen() {
    setSaving(true)
    const failed: string[] = []
    for (const m of mortgages.filter((m) => chosen.has(m.id))) {
      try {
        await changeLedger((client) =>
          changes.redeem(client, m.id, {
            redeemed_on: payment.paid_on,
            method: payment.method,
            reference: payment.reference,
          }),
        )
      } catch (err) {
        failed.push(`${m.name}: ${(err as Error).message}`)
      }
    }
    setSaving(false)
    if (failed.length) setFailures(failed)
    else onDone()
  }

  return (
    <Modal onClose={onDone}>
      <h2>Fully paid: Redeem now?</h2>
      <p>
        This Payment cleared what {mortgages.length > 1 ? 'these Mortgages' : 'this Mortgage'}{' '}
        owed. Redeem on {formatDate(payment.paid_on)} and hand the jewellery back?
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
                ) : quote.total === 0 ? (
                  'Nothing more to pay.'
                ) : (
                  `Needs ${formatINR(quote.total)} more as the final Payment: part-month charge ` +
                  `for ${quote.part_month_days} days (${rules[m.id] ?? 'Part-Month Rule'}).`
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {failures.length > 0 && (
        <ul className="problems">
          {failures.map((failure) => (
            <li key={failure}>{failure}</li>
          ))}
        </ul>
      )}
      <div className="row end">
        <button type="button" className="secondary" autoFocus onClick={onDone}>
          Not now
        </button>
        <button type="button" disabled={saving || chosen.size === 0} onClick={redeemChosen}>
          {saving ? 'Redeeming…' : `Redeem ${chosen.size}`}
        </button>
      </div>
    </Modal>
  )
}
