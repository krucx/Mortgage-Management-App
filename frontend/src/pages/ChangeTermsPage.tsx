import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { api, type Mortgage } from '../api'
import { PreviewSection } from '../components/BeforeAfter'
import { Summary } from '../components/ConfirmDialog'
import { TermsFields } from '../components/TermsFields'
import { useConfirm } from '../components/useConfirm'
import { usePreview } from '../components/usePreview'
import { formatDate, todayIso } from '../format'
import { describeTerms, fromDraft, sameTerms, toDraft, type TermsDraft } from '../terms'

/** Change a running Mortgage's Terms from an Accrual Date, seeing the effect first. */
export function ChangeTermsPage() {
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const [mortgage, setMortgage] = useState<Mortgage | null>(null)
  const [effectiveOn, setEffectiveOn] = useState('')
  const [draft, setDraft] = useState<TermsDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirm, confirmDialog] = useConfirm()
  const today = todayIso()

  useEffect(() => {
    api.getMortgage(id).then(
      (loaded) => {
        setMortgage(loaded)
        setDraft(toDraft(loaded.terms))
        const taken = new Set(loaded.term_changes.map((change) => change.effective_on))
        const free = loaded.upcoming_accrual_dates.filter((day) => !taken.has(day))
        setEffectiveOn(free.find((day) => day > today) ?? free[0] ?? '')
      },
      (err: Error) => setError(err.message),
    )
  }, [id, today])

  // The Terms in force on the chosen date: a coming Term Change before it, or today's.
  const before =
    mortgage &&
    (mortgage.term_changes.filter((change) => change.effective_on < effectiveOn).at(-1)
      ?.terms ??
      mortgage.terms)
  const after = draft && Number(draft.ratePercent) > 0 ? fromDraft(draft) : null
  const changes = Boolean(before && after && effectiveOn && !sameTerms(before, after))

  // Re-previewed whenever the date or the new Terms change.
  const proposed = after ? JSON.stringify({ effective_on: effectiveOn, ...after }) : ''
  const load = useCallback(() => api.previewTermChange(id, JSON.parse(proposed)), [id, proposed])
  const preview = usePreview(changes ? load : null)

  if (!mortgage || !draft || !before) {
    return error ? <p className="status error">{error}</p> : <p>Loading…</p>
  }
  const taken = new Set(mortgage.term_changes.map((change) => change.effective_on))
  const free = mortgage.upcoming_accrual_dates.filter((day) => !taken.has(day))

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!after || !changes) return
    const confirmed = await confirm({
      title: 'Change the Terms?',
      body: (
        <Summary
          rows={[
            ['From', formatDate(effectiveOn)],
            ['Before', describeTerms(before!)],
            ['After', describeTerms(after)],
          ]}
        />
      ),
    })
    if (!confirmed) return
    setSaving(true)
    setError(null)
    try {
      await api.addTermChange(id, { effective_on: effectiveOn, ...after })
      navigate(`/mortgages/${id}`)
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <section className="card wide">
      <h2>Change the Terms of {mortgage.name}</h2>
      <p className="hint">
        Months starting on or after the chosen Accrual Date use the new Terms; interest already
        charged never changes.
      </p>
      {mortgage.status !== 'active' ? (
        <p className="hint">This Mortgage is {mortgage.status}.</p>
      ) : (
        <form onSubmit={save} className="stack">
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
          <p>
            <span className="hint">In force then:</span> {describeTerms(before)}
          </p>
          <TermsFields value={draft} onChange={setDraft} />

          <h3>What changes</h3>
          {changes ? (
            <PreviewSection preview={preview} />
          ) : (
            <p className="hint">Change the rate, Interest Mode or Part-Month Rule to see the effect.</p>
          )}

          <div className="row">
            <button type="submit" disabled={saving || !changes || !!preview.error}>
              {saving ? 'Saving…' : 'Save Term Change'}
            </button>
            <button type="button" className="secondary" onClick={() => navigate(-1)}>
              Cancel
            </button>
          </div>
          {error && <p className="status error">{error}</p>}
        </form>
      )}
      {confirmDialog}
    </section>
  )
}
