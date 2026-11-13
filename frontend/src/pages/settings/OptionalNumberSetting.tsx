import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Summary } from '../../components/ConfirmDialog'
import { useConfirm } from '../../components/useConfirm'
import { useDraft } from '../../components/useDraft'
import { type ApiClient, useServerState } from '../../serverState'
import { type SettingQuery, type Status, shownStatus } from './shared'
import type { Unit } from './units'

/** One optional number; cleared (or 0), off. The Cash Limit and the Discount confirmation
 * threshold are this in rupees, the Grace Period in days, each with their own heading,
 * copy, labels and wording for "off" — only what each drives is theirs to know, not this
 * section. */
export function OptionalNumberSetting<T extends Record<string, number | null | undefined>>({
  unit,
  heading,
  hint,
  inputLabel,
  dialogTitle,
  summaryLabel,
  neverText,
  confirmedSuffix,
  field,
  query,
  save,
}: {
  unit: Unit
  heading: string
  hint: ReactNode
  inputLabel: string
  dialogTitle: string
  summaryLabel: string
  neverText: string
  confirmedSuffix: string
  field: keyof T
  query: SettingQuery<T>
  save: (client: ApiClient, value: number | null) => Promise<T>
}) {
  const { client, queryClient } = useServerState()
  const saved = useQuery(query)
  const [draft, setDraft] = useDraft(saved.data, (data) => unit.toDraft(data[field] ?? null))
  const [savedStatus, setStatus] = useState<Status>(null)
  const status = shownStatus(savedStatus, saved.error)
  const [saving, setSaving] = useState(false)
  const [confirm, confirmDialog] = useConfirm()

  async function handleSave(event: FormEvent) {
    event.preventDefault()
    if (draft === null) return
    const value = unit.fromDraft(draft)
    const confirmed = await confirm({
      title: dialogTitle,
      body: (
        <Summary
          rows={[[summaryLabel, value ? `${unit.show(value)}${confirmedSuffix}` : neverText]]}
        />
      ),
    })
    if (!confirmed) return
    setSaving(true)
    setStatus(null)
    try {
      const stored = await save(client, value)
      queryClient.setQueryData(query.queryKey, stored)
      setStatus({ kind: 'saved', text: 'Saved.' })
    } catch (error) {
      setStatus({ kind: 'error', text: (error as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card">
      <h2>{heading}</h2>
      <p className="hint">{hint}</p>
      {draft !== null && (
        <form onSubmit={handleSave} className="stack">
          <label>
            {inputLabel}
            <input
              type="number"
              min={unit.min}
              step="1"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
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
