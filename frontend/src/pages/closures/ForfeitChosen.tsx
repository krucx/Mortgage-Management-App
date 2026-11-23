import { useState } from 'react'
import { PreviewSection } from '../../components/BeforeAfter'
import { Summary } from '../../components/ConfirmDialog'
import { Owed } from '../../components/Owed'
import { RupeeInput } from '../../components/RupeeInput'
import { useClosing, type Closing } from '../../components/useClosing'
import { useQuotes } from '../../components/useQuotes'
import { formatDate, todayIso } from '../../format'
import { formatINR, rupeesToPaise } from '../../money'
import type { Chosen } from './types'

export /** Forfeit several Mortgages on one date, each with its own Recovered Amount: all of
 *  them, or none if the backend refuses any. */
function ForfeitChosen({ chosen, onDone }: { chosen: Chosen[]; onDone: () => void }) {
  const [on, setOn] = useState(todayIso())
  const [recovered, setRecovered] = useState<Record<number, string>>({})
  const [note, setNote] = useState('')
  const quoteOf = useQuotes(chosen, on)

  const entered = chosen.every((m) => recovered[m.id])
  const closing: Closing | null = entered
    ? {
        kind: 'forfeit',
        forfeit: {
          forfeited_on: on,
          note,
          mortgages: chosen.map((m) => ({
            mortgage_id: m.id,
            recovered_amount: rupeesToPaise(recovered[m.id]),
          })),
        },
      }
    : null
  const { preview, submit, saving, canSave, error, confirmDialog, closureOf } = useClosing({
    closing,
    confirm: () => ({
      title: `Forfeit ${chosen.length} Mortgage${chosen.length > 1 ? 's' : ''}?`,
      body: (
        <Summary
          rows={[
            ['Forfeited on', formatDate(on)],
            ...chosen.map((m): [string, string] => {
              const closure = closureOf(m.id)
              return [
                m.name,
                `Recovered ${formatINR(closure?.recovered_amount ?? 0)} of ${formatINR(closure?.outstanding ?? 0)}`,
              ]
            }),
            [total >= 0 ? 'Total profit' : 'Total loss', formatINR(Math.abs(total))],
          ]}
        />
      ),
      confirmLabel: 'Confirm Forfeiture',
      danger: true,
    }),
    saved: onDone,
  })
  // Each one's profit or loss, as the Preview works it out.
  const profitLosses = chosen.map((m) => closureOf(m.id)?.profit_loss ?? null)
  const previewed = closing !== null && !preview.error && profitLosses.every((r) => r !== null)
  const total = profitLosses.reduce<number>((sum, r) => sum + (r ?? 0), 0)

  return (
    <form onSubmit={submit} className="stack close-panel">
      <strong>Forfeit the {chosen.length} chosen</strong>
      <div className="grid-2">
        <label>
          Forfeited on
          <input type="date" required value={on} onChange={(event) => setOn(event.target.value)} />
        </label>
        <label>
          Note (for all)
          <input
            placeholder="e.g. auctioned on…"
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
                    value={recovered[m.id] ?? ''}
                    onChange={(event) => setRecovered({ ...recovered, [m.id]: event.target.value })}
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
      {closing && <PreviewSection preview={preview} />}
      <div className="row">
        <button type="submit" className="danger-solid" disabled={!canSave || !previewed}>
          {saving ? 'Forfeiting…' : `Forfeit ${chosen.length}`}
        </button>
        {previewed && (
          <span className={`status ${total >= 0 ? 'saved' : 'error'}`}>
            {total >= 0 ? 'Total profit' : 'Total loss'} {formatINR(Math.abs(total))}
          </span>
        )}
      </div>
      {error && <p className="status error">{error}</p>}
      {confirmDialog}
    </form>
  )
}
