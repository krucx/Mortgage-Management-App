import { PreviewSection } from '../../components/BeforeAfter'
import { Owed } from '../../components/Owed'
import { RupeeInput } from '../../components/RupeeInput'
import { useQuotes } from '../../components/useQuotes'
import { formatDate } from '../../format'
import { formatINR } from '../../money'
import { useClosingDraft } from '../mortgage/useClosingDraft'
import type { Chosen } from './types'

/** Render the fields for forfeiting several Mortgages; the draft owns the Closing. */
export function ForfeitChosen({ chosen, onDone }: { chosen: Chosen[]; onDone: () => void }) {
  const draft = useClosingDraft({ kind: 'forfeit', mortgages: chosen, onSaved: onDone })
  const quoteOf = useQuotes(chosen, draft.on.value)
  const profitLosses = chosen.map((m) => draft.closureOf(m.id)?.profit_loss ?? null)
  const previewed =
    draft.closing !== null && !draft.preview.error && profitLosses.every((r) => r !== null)
  const total = profitLosses.reduce<number>((sum, amount) => sum + (amount ?? 0), 0)

  return (
    <form onSubmit={draft.submit} className="stack close-panel">
      <strong>Forfeit the {chosen.length} chosen</strong>
      <div className="grid-2">
        <label>
          Forfeited on
          <input type="date" required value={draft.on.value} onChange={draft.on.onChange} />
        </label>
        <label>
          Note (for all)
          <input
            placeholder="e.g. auctioned on…"
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
              <th className="num">Recovered Amount (₹)</th>
              <th className="num">Profit / loss</th>
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
                    aria-label={`Recovered Amount for ${m.name}`}
                    required
                    min="0"
                    {...draft.amountOf(m.id)}
                  />
                </td>
                <td className="num">
                  {!previewed || profitLosses[i] === null ? (
                    '—'
                  ) : (
                    <span className={`status ${profitLosses[i] >= 0 ? 'saved' : 'error'}`}>
                      {formatINR(profitLosses[i])}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {draft.closing && <PreviewSection preview={draft.preview} />}
      <div className="row">
        <button type="submit" className="danger-solid" disabled={!draft.canSave || !previewed}>
          {draft.saving ? 'Forfeiting…' : `Forfeit ${chosen.length}`}
        </button>
        {previewed && (
          <span className={`status ${total >= 0 ? 'saved' : 'error'}`}>
            {total >= 0 ? 'Total profit' : 'Total loss'} {formatINR(Math.abs(total))}
          </span>
        )}
      </div>
      {draft.error && <p className="status error">{draft.error}</p>}
      {draft.confirmDialog}
    </form>
  )
}
