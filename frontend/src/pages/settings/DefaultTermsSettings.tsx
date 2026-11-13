import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Summary } from '../../components/ConfirmDialog'
import { TermsFields } from '../../components/TermsFields'
import { useConfirm } from '../../components/useConfirm'
import { useDraft } from '../../components/useDraft'
import { settings } from '../../requests'
import { useServerState } from '../../serverState'
import { fromDraft, INTEREST_MODES, PART_MONTH_RULES, toDraft } from '../../terms'
import { type Status, shownStatus } from './shared'

export function DefaultTermsSettings() {
  const { client, queryClient } = useServerState()
  const saved = useQuery(settings.defaultTerms(client))
  const [draft, setDraft] = useDraft(saved.data, toDraft)
  const [savedStatus, setStatus] = useState<Status>(null)
  const status = shownStatus(savedStatus, saved.error)
  const [saving, setSaving] = useState(false)
  const [confirm, confirmDialog] = useConfirm()

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft) return
    const confirmed = await confirm({
      title: 'Change the Default Terms?',
      body: (
        <>
          <Summary
            rows={[
              ['Monthly rate', `${draft.ratePercent}%`],
              ['Interest Mode', INTEREST_MODES[draft.interest_mode]],
              ['Part-Month Rule', PART_MONTH_RULES[draft.part_month_rule]],
            ]}
          />
          <p className="hint">Only new Mortgages use these; existing ones keep their Terms.</p>
        </>
      ),
    })
    if (!confirmed) return
    setSaving(true)
    setStatus(null)
    try {
      const terms = await settings.saveDefaultTerms(client, fromDraft(draft))
      queryClient.setQueryData(settings.defaultTerms(client).queryKey, terms)
      setStatus({ kind: 'saved', text: 'Saved. New Mortgages will start with these Terms.' })
    } catch (error) {
      setStatus({ kind: 'error', text: (error as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card">
      <h2>Default Terms</h2>
      <p className="hint">
        Copied into every new Mortgage when it is created. Changing them never affects existing
        Mortgages.
      </p>

      {draft === null && status === null && <p>Loading…</p>}

      {draft && (
        <form onSubmit={save}>
          <TermsFields value={draft} onChange={setDraft} />
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </form>
      )}

      {status && <p className={`status ${status.kind}`}>{status.text}</p>}
      {confirmDialog}
    </section>
  )
}
