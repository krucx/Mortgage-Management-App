import { PreviewSection } from '../../components/BeforeAfter'
import { Owed } from '../../components/Owed'
import { PaymentMethodSelect } from '../../components/PaymentMethodSelect'
import { RupeeInput } from '../../components/RupeeInput'
import { useQuotes } from '../../components/useQuotes'
import { formatDate } from '../../format'
import { formatINR } from '../../money'
import { useClosingDraft } from '../mortgage/useClosingDraft'
import type { Chosen } from './types'

/** Render the fields for waiving several Mortgages; the draft owns the Closing. */
export function WaiveChosen({ chosen, onDone }: { chosen: Chosen[]; onDone: () => void }) {
  const draft = useClosingDraft({ kind: 'waive', mortgages: chosen, onSaved: onDone })
  const quoteOf = useQuotes(chosen, draft.on.value)
  const waived = chosen.map((m) => draft.closureOf(m.id)?.waived_amount ?? null)
  const previewed =
    draft.closing !== null && !draft.preview.error && waived.every((w) => w !== null)
  const totalWaived = waived.reduce<number>((sum, amount) => sum + (amount ?? 0), 0)

  return (
    <form onSubmit={draft.submit} className="stack close-panel">
      <strong>Waive off the {chosen.length} chosen</strong>
      <div className="grid-2">
        <label>
          Waived on
          <input type="date" required value={draft.on.value} onChange={draft.on.onChange} />
        </label>
        <label>
          Reason (for all)
          <input
            placeholder="e.g. small balance let off"
            value={draft.note.value}
            onChange={draft.note.onChange}
          />
        </label>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Mortgage</th>
              <th className="num">Outstanding on {formatDate(draft.on.value)}</th>
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
                    {...draft.amountOf(m.id)}
                  />
                </td>
                <td className="num">
                  {!previewed || waived[i] === null ? (
                    '—'
                  ) : (
                    <span className="status warning">{formatINR(waived[i])}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {draft.paying && (
        <div className="grid-2">
          <label>
            Final Payments made by
            <PaymentMethodSelect methods={draft.methods} {...draft.method} />
          </label>
          <label>
            Reference (for all)
            <input
              placeholder="e.g. UPI transaction id"
              value={draft.reference.value}
              onChange={draft.reference.onChange}
            />
          </label>
        </div>
      )}
      {draft.closing && <PreviewSection preview={draft.preview} />}
      <div className="row">
        <button type="submit" disabled={!draft.canSave || !previewed}>
          {draft.saving ? `Waiving off…` : `Waive off ${chosen.length}`}
        </button>
        {previewed && (
          <span className="status warning">Total waived off {formatINR(totalWaived)}</span>
        )}
      </div>
      {draft.error && <p className="status error">{draft.error}</p>}
      {draft.confirmDialog}
    </form>
  )
}
