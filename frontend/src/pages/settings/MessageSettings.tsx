import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useDraft } from '../../components/useDraft'
import { WhatsAppPreview } from '../../components/WhatsApp'
import { settings } from '../../requests'
import { STALE_AFTER, useChange, useServerState } from '../../serverState'
import { type Status, shownStatus } from './shared'

/** One editable WhatsApp template, with how its formatting will look. */
function TemplateField({
  label,
  placeholders,
  note,
  value,
  onChange,
}: {
  label: string
  /** The placeholders the backend can fill in this template, once they arrive. */
  placeholders?: string[]
  /** What this template's own placeholders mean. */
  note?: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="receipt-panel">
      <label>
        {label}
        <textarea
          rows={10}
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="hint">
          {placeholders && (
            <>
              Placeholders: <code>{placeholders.map((name) => `{${name}}`).join(' ')}</code>.{' '}
            </>
          )}
          {'{mortgages}'} is a small table per Mortgage, showing its description, never the Mortgage
          Name. *bold*, _italic_ as in WhatsApp.
          {note && ` ${note}`}
        </span>
      </label>
      <WhatsAppPreview text={value} />
    </div>
  )
}

/** The wording of Receipts and Reminders, and when Reminders are queued. */
export function MessageSettingsForm() {
  const { client, queryClient } = useServerState()
  const saved = useQuery(settings.messages(client))
  const placeholders = useQuery(settings.placeholders(client)).data ?? null
  const [draft, setDraft] = useDraft(saved.data, (messages) => messages)
  const [savedStatus, setStatus] = useState<Status>(null)
  const status = shownStatus(savedStatus, saved.error)
  const [saving, setSaving] = useState(false)
  const requeue = useChange(STALE_AFTER.messageSettings)

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft) return
    setSaving(true)
    setStatus(null)
    try {
      const messages = await requeue((client) => settings.saveMessages(client, draft))
      queryClient.setQueryData(settings.messages(client).queryKey, messages)
      setStatus({ kind: 'saved', text: 'Saved.' })
    } catch (error) {
      setStatus({ kind: 'error', text: (error as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card wide">
      <h2>WhatsApp messages</h2>
      <p className="hint">Receipts and Reminders open in WhatsApp ready to send; you press Send.</p>
      {draft && (
        <form onSubmit={save} className="stack">
          <TemplateField
            label="Receipt"
            placeholders={placeholders?.receipt}
            note={
              'On a Grace Payment, {date} is when it was received and {grace} adds ' +
              '“, counted as paid on 13 Apr 2026 (Grace)”; otherwise {grace} is empty.'
            }
            value={draft.receipt_template}
            onChange={(receipt_template) => setDraft({ ...draft, receipt_template })}
          />
          <TemplateField
            label="Reminder"
            placeholders={placeholders?.reminder}
            value={draft.reminder_template}
            onChange={(reminder_template) => setDraft({ ...draft, reminder_template })}
          />
          <div className="grid-2">
            <label>
              Queue Reminders this many days before an Accrual Date
              <input
                type="number"
                required
                min="1"
                max="28"
                step="1"
                value={draft.reminder_days_before}
                onChange={(event) =>
                  setDraft({ ...draft, reminder_days_before: Number(event.target.value) })
                }
              />
            </label>
            <label className="inline">
              <input
                type="checkbox"
                checked={draft.reminder_approve_first}
                onChange={(event) =>
                  setDraft({ ...draft, reminder_approve_first: event.target.checked })
                }
              />
              Approve each Reminder before it can be sent
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
    </section>
  )
}
