import { useState } from 'react'
import type { PaymentMethod } from '../../api'
import { PreviewSection } from '../../components/BeforeAfter'
import { Summary } from '../../components/ConfirmDialog'
import { Owed } from '../../components/Owed'
import { PaymentMethodSelect } from '../../components/PaymentMethodSelect'
import { RupeeInput } from '../../components/RupeeInput'
import { useClosing, type Closing } from '../../components/useClosing'
import { usePaymentMethods } from '../../components/usePaymentMethods'
import { useQuotes } from '../../components/useQuotes'
import { formatDate, todayIso } from '../../format'
import { formatINR, rupeesToPaise } from '../../money'
import type { Chosen } from './types'

export /** Waive off several Mortgages on one date: each takes its own final Payment (or none),
 *  and the rest of its Outstanding is let off; all of them, or none if the
 *  backend refuses any. */
function WaiveChosen({ chosen, onDone }: { chosen: Chosen[]; onDone: () => void }) {
  const [on, setOn] = useState(todayIso())
  const [received, setReceived] = useState<Record<number, string>>({})
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [reference, setReference] = useState('')
  const methods = usePaymentMethods()
  const [note, setNote] = useState('')
  const quoteOf = useQuotes(chosen, on)

  const entered = chosen.every((m) => received[m.id])
  const closing: Closing | null = entered
    ? {
        kind: 'waive',
        waive: {
          waived_on: on,
          method,
          reference: reference.trim() || null,
          note,
          mortgages: chosen.map((m) => ({
            mortgage_id: m.id,
            amount_paid: rupeesToPaise(received[m.id]),
          })),
        },
      }
    : null
  const { preview, submit, saving, canSave, error, confirmDialog, closureOf } = useClosing({
    closing,
    confirm: () => ({
      title: `Waive off ${chosen.length} Mortgage${chosen.length > 1 ? 's' : ''}?`,
      body: (
        <>
          <Summary
            rows={[
              ['Waived on', formatDate(on)],
              ...chosen.map((m): [string, string] => {
                const closure = closureOf(m.id)
                return [
                  m.name,
                  `Received ${formatINR(closure?.payment_amount ?? 0)}, waived ${formatINR(closure?.waived_amount ?? 0)}`,
                ]
              }),
              ['Total waived off', formatINR(totalWaived)],
              ['Reason', note.trim() || '—'],
            ]}
          />
          <p className="hint">Return the jewellery for each.</p>
        </>
      ),
      confirmLabel: 'Confirm Waiver',
    }),
    saved: onDone,
  })
  // What each one lets off, as the Preview works it out.
  const waivedAmounts = chosen.map((m) => closureOf(m.id)?.waived_amount ?? null)
  const previewed = closing !== null && !preview.error && waivedAmounts.every((w) => w !== null)
  const totalWaived = waivedAmounts.reduce<number>((sum, w) => sum + (w ?? 0), 0)
  const anyPaid = chosen.some((m) => rupeesToPaise(received[m.id]) > 0)

  return (
    <form onSubmit={submit} className="stack close-panel">
      <strong>Waive off the {chosen.length} chosen</strong>
      <div className="grid-2">
        <label>
          Waived on
          <input type="date" required value={on} onChange={(event) => setOn(event.target.value)} />
        </label>
        <label>
          Reason (for all)
          <input
            placeholder="e.g. small balance let off"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Mortgage</th>
              <th className="num">Outstanding on {formatDate(on)}</th>
              <th className="num">Received now (₹)</th>
              <th className="num">Waived off</th>
            </tr>
          </thead>
          <tbody>
            {chosen.map((m, i) => (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td className="num">
                  <Owed quote={quoteOf(m.id)} />
                </td>
                <td className="num">
                  <RupeeInput
                    className="small-input"
                    aria-label={`Received now for ${m.name}`}
                    required
                    min="0"
                    value={received[m.id] ?? ''}
                    onChange={(event) => setReceived({ ...received, [m.id]: event.target.value })}
                  />
                </td>
                <td className="num">
                  {!previewed || waivedAmounts[i] === null ? (
                    '—'
                  ) : (
                    <span className="status warning">{formatINR(waivedAmounts[i])}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {anyPaid && (
        <div className="grid-2">
          <label>
            Final Payments made by
            <PaymentMethodSelect methods={methods} value={method} onChange={setMethod} />
          </label>
          <label>
            Reference (for all)
            <input
              placeholder="e.g. UPI transaction id"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          </label>
        </div>
      )}
      {closing && <PreviewSection preview={preview} />}
      <div className="row">
        <button type="submit" disabled={!canSave || !previewed}>
          {saving ? 'Waiving off…' : `Waive off ${chosen.length}`}
        </button>
        {previewed && (
          <span className="status warning">Total waived off {formatINR(totalWaived)}</span>
        )}
      </div>
      {error && <p className="status error">{error}</p>}
      {confirmDialog}
    </form>
  )
}
