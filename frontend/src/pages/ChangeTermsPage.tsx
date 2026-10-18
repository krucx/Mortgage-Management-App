import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import type { Mortgage } from '../api'
import { PreviewSection } from '../components/BeforeAfter'
import { Summary } from '../components/ConfirmDialog'
import { TermsFields } from '../components/TermsFields'
import { useProposedChange } from '../components/useProposedChange'
import { formatDate, todayIso } from '../format'
import { changes, mortgageQuery, previews } from '../requests'
import { useMortgageChange, useServerState } from '../serverState'
import { describeTerms, fromDraft, sameTerms, toDraft, type TermsDraft } from '../terms'

/** Change a running Mortgage's Terms from an Accrual Date, seeing the effect first. */
export function ChangeTermsPage() {
  const id = Number(useParams().id)
  const { client } = useServerState()
  const loaded = useQuery(mortgageQuery(client, id))
  if (!loaded.data) {
    return loaded.error ? <p className="status error">{loaded.error.message}</p> : <p>Loading…</p>
  }
  // Keyed so the form starts again from another Mortgage's Terms.
  return <ChangeTermsForm key={id} mortgage={loaded.data} />
}

/** The Accrual Dates that have no Term Change yet. */
function freeDates(mortgage: Mortgage): string[] {
  const taken = new Set(mortgage.term_changes.map((change) => change.effective_on))
  return mortgage.upcoming_accrual_dates.filter((day) => !taken.has(day))
}

function ChangeTermsForm({ mortgage }: { mortgage: Mortgage }) {
  const id = mortgage.id
  const navigate = useNavigate()
  const today = todayIso()
  const [effectiveOn, setEffectiveOn] = useState(() => {
    const free = freeDates(mortgage)
    return free.find((day) => day > today) ?? free[0] ?? ''
  })
  const [draft, setDraft] = useState<TermsDraft>(() => toDraft(mortgage.terms))
  const changeMortgage = useMortgageChange()

  // The Terms in force on the chosen date: a coming Term Change before it, or today's.
  const before =
    mortgage.term_changes.filter((change) => change.effective_on < effectiveOn).at(-1)?.terms ??
    mortgage.terms
  const after = Number(draft.ratePercent) > 0 ? fromDraft(draft) : null
  const changed = Boolean(after && effectiveOn && !sameTerms(before, after))

  const change = changed && after ? { effective_on: effectiveOn, ...after } : null
  const free = freeDates(mortgage)

  // Re-previewed whenever the date or the new Terms change.
  const { preview, submit, saving, canSave, error, confirmDialog } = useProposedChange({
    preview: change && previews.termChange(id, change),
    ready: change !== null,
    confirm: () => ({
      title: 'Change the Terms?',
      body: (
        <Summary
          rows={[
            ['From', formatDate(effectiveOn)],
            ['Before', describeTerms(before)],
            ['After', after ? describeTerms(after) : ''],
          ]}
        />
      ),
    }),
    save: () => changeMortgage((client) => changes.addTermChange(client, id, change!)),
    saved: () => navigate(`/mortgages/${id}`),
  })

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
        <form onSubmit={submit} className="stack">
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
          {changed ? (
            <PreviewSection preview={preview} />
          ) : (
            <p className="hint">Change the rate, Interest Mode or Part-Month Rule to see the effect.</p>
          )}

          <div className="row">
            <button type="submit" disabled={!canSave}>
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
