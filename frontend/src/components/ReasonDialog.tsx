import { useState, type FormEvent, type ReactNode } from 'react'
import { Modal } from './Modal'

/** An in-app confirmation that needs a reason, e.g. for a Void; it is kept on record. */
export function ReasonDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string
  body?: ReactNode
  confirmLabel: string
  /** Does the work; an error it throws is shown and the dialog stays open. */
  onConfirm: (reason: string) => Promise<void>
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onConfirm(reason.trim())
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <h2>{title}</h2>
        {body}
        <label>
          Reason (kept on record)
          <textarea
            required
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        {error && <p className="status error">{error}</p>}
        <div className="row end">
          <button type="button" className="secondary" autoFocus onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="danger-solid" disabled={saving || !reason.trim()}>
            {saving ? 'Saving…' : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  )
}
