import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Summary } from '../../components/ConfirmDialog'
import { useConfirm } from '../../components/useConfirm'
import { useDraft } from '../../components/useDraft'
import { settings } from '../../requests'
import { STALE_AFTER, useChange, useServerState } from '../../serverState'
import { type Status, shownStatus } from './shared'

/** When a Mortgage goes on the Call List. */
export function CallListThresholds() {
  const { client, queryClient } = useServerState()
  const saved = useQuery(settings.callList(client))
  const [draft, setDraft] = useDraft(saved.data, (thresholds) => thresholds)
  const [savedStatus, setStatus] = useState<Status>(null)
  const status = shownStatus(savedStatus, saved.error)
  const [saving, setSaving] = useState(false)
  const [confirm, confirmDialog] = useConfirm()
  const relist = useChange(STALE_AFTER.callListThresholds)

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft) return
    const confirmed = await confirm({
      title: 'Change when Mortgages go on the Call List?',
      body: (
        <Summary
          rows={[
            ['Months Unpaid', `${draft.months_unpaid} or more`],
            ['Loan-to-Value', `above ${draft.loan_to_value_pct}%`],
          ]}
        />
      ),
    })
    if (!confirmed) return
    setSaving(true)
    setStatus(null)
    try {
      const thresholds = await relist((client) => settings.saveCallList(client, draft))
      queryClient.setQueryData(settings.callList(client).queryKey, thresholds)
      setStatus({ kind: 'saved', text: 'Saved.' })
    } catch (error) {
      setStatus({ kind: 'error', text: (error as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card">
      <h2>Call List</h2>
      <p className="hint">
        An Active Mortgage is listed when either is reached, or it accrues today.
      </p>
      {draft && (
        <form onSubmit={save} className="stack">
          <div className="grid-2">
            <label>
              Months Unpaid, or more
              <input
                type="number"
                required
                min="1"
                step="1"
                value={draft.months_unpaid}
                onChange={(event) =>
                  setDraft({ ...draft, months_unpaid: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Loan-to-Value above (%)
              <input
                type="number"
                required
                min="1"
                step="1"
                value={draft.loan_to_value_pct}
                onChange={(event) =>
                  setDraft({ ...draft, loan_to_value_pct: Number(event.target.value) })
                }
              />
            </label>
          </div>
          <div>
            <button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}
      {status && <p className={`status ${status.kind}`}>{status.text}</p>}
      {confirmDialog}
    </section>
  )
}
