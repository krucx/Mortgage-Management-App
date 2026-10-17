import { useState, type FormEvent } from 'react'
import { api, type Mortgage } from '../api'
import { formatDate, todayIso } from '../format'
import { describeTerms, fromDraft, toDraft } from '../terms'
import { Summary } from './ConfirmDialog'
import { TermsFields } from './TermsFields'
import { useConfirm } from './useConfirm'

/** The Terms in force, Term Changes past and coming, and a form to add one. */
export function TermsPanel({
  mortgage,
  onChange,
}: {
  mortgage: Mortgage
  onChange: (updated: Mortgage) => void
}) {
  const [adding, setAdding] = useState(false)
  const [effectiveOn, setEffectiveOn] = useState('')
  const [draft, setDraft] = useState(toDraft(mortgage.terms))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirm, confirmDialog] = useConfirm()
  const today = todayIso()
  // A Term Change can start on any of these that has none yet.
  const free = mortgage.upcoming_accrual_dates.filter(
    (day) => !mortgage.term_changes.some((change) => change.effective_on === day),
  )

  function open() {
    setDraft(toDraft(mortgage.terms))
    setEffectiveOn(free.find((day) => day > today) ?? free[0] ?? '')
    setError(null)
    setAdding(true)
  }

  async function add(event: FormEvent) {
    event.preventDefault()
    const terms = fromDraft(draft)
    // In force on that date: today's Terms, or a coming Term Change before it.
    const before =
      mortgage.term_changes.filter((change) => change.effective_on < effectiveOn).at(-1)
        ?.terms ?? mortgage.terms
    const confirmed = await confirm({
      title: 'Change the Terms?',
      body: (
        <>
          <Summary
            rows={[
              ['From', formatDate(effectiveOn)],
              ['Before', describeTerms(before)],
              ['After', describeTerms(terms)],
            ]}
          />
          <p className="hint">
            Months starting on or after {formatDate(effectiveOn)} use the new Terms; interest
            already charged does not change.
          </p>
        </>
      ),
    })
    if (!confirmed) return
    setSaving(true)
    setError(null)
    try {
      onChange(await api.addTermChange(mortgage.id, { effective_on: effectiveOn, ...terms }))
      setAdding(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function remove(changeId: number, from: string) {
    const confirmed = await confirm({
      title: `Remove the Term Change from ${formatDate(from)}?`,
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
      danger: true,
    })
    if (!confirmed) return
    try {
      onChange(await api.removeTermChange(mortgage.id, changeId))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="stack">
      <p>
        {describeTerms(mortgage.terms)}
        {mortgage.term_changes.length > 0 && <span className="hint"> (in force today)</span>}
      </p>
      {mortgage.term_changes.length > 0 && (
        <ul className="term-changes">
          {mortgage.term_changes.map((change) => (
            <li key={change.id}>
              <strong>From {formatDate(change.effective_on)}:</strong> {describeTerms(change.terms)}
              {change.removable ? (
                <>
                  {' '}
                  <span className="badge">coming</span>{' '}
                  <button
                    type="button"
                    className="danger small"
                    onClick={() => remove(change.id, change.effective_on)}
                  >
                    Remove
                  </button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {mortgage.status === 'active' &&
        (adding ? (
          <form onSubmit={add} className="stack close-panel">
            <strong>Change the Terms</strong>
            <label>
              From the Accrual Date
              <select value={effectiveOn} onChange={(e) => setEffectiveOn(e.target.value)}>
                {free.map((day) => (
                  <option key={day} value={day}>
                    {formatDate(day)}
                    {day === today ? ' (today)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <TermsFields value={draft} onChange={setDraft} />
            <div className="row">
              <button type="submit" disabled={saving || !effectiveOn}>
                {saving ? 'Saving…' : 'Save Term Change'}
              </button>
              <button type="button" className="secondary" onClick={() => setAdding(false)}>
                Cancel
              </button>
            </div>
            {error && <p className="status error">{error}</p>}
          </form>
        ) : (
          <div>
            <button type="button" className="secondary small" onClick={open}>
              Change Terms…
            </button>
          </div>
        ))}
      {!adding && error && <p className="status error">{error}</p>}
      {confirmDialog}
    </div>
  )
}
