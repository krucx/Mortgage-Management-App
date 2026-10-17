import { useEffect, useState, type FormEvent } from 'react'
import { api, type CallNote } from '../api'
import { formatDate } from '../format'
import { Summary } from './ConfirmDialog'
import { useConfirm } from './useConfirm'

/** Mark a Mortgage as called today, with a note of what was said. */
export function MarkCalled({
  mortgageId,
  mortgageName,
  onSaved,
  onCancel,
}: {
  mortgageId: number
  mortgageName: string
  onSaved: (note: CallNote) => void
  onCancel?: () => void
}) {
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, confirmDialog] = useConfirm()

  async function submit(event: FormEvent) {
    event.preventDefault()
    const confirmed = await confirm({
      title: `Mark ${mortgageName} as called?`,
      body: <Summary rows={[['Note', note.trim() || '—']]} />,
      confirmLabel: 'Save Call Note',
    })
    if (!confirmed) return
    setSaving(true)
    setError(null)
    try {
      onSaved(await api.addCallNote(mortgageId, note))
      setNote('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="call-form">
      <input
        aria-label={`Call Note for ${mortgageName}`}
        placeholder="What was said, e.g. will pay Friday"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <button type="submit" className="small" disabled={saving}>
        {saving ? 'Saving…' : 'Called'}
      </button>
      {onCancel && (
        <button type="button" className="secondary small" onClick={onCancel}>
          Cancel
        </button>
      )}
      {error && <span className="status error">{error}</span>}
      {confirmDialog}
    </form>
  )
}

/** A Mortgage's Call Notes, newest first, with a form to add one. */
export function CallNotes({ mortgageId, mortgageName }: { mortgageId: number; mortgageName: string }) {
  const [notes, setNotes] = useState<CallNote[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.listCallNotes(mortgageId).then(setNotes, (err: Error) => setError(err.message))
  }, [mortgageId])

  return (
    <div className="stack">
      {error && <p className="status error">{error}</p>}
      {notes === null ? null : notes.length === 0 ? (
        <p className="hint">Not called yet.</p>
      ) : (
        <ul className="call-notes">
          {notes.map((note) => (
            <li key={note.id}>
              <strong>{formatDate(note.called_on)}</strong> {note.note || <em>no note</em>}
            </li>
          ))}
        </ul>
      )}
      <MarkCalled
        mortgageId={mortgageId}
        mortgageName={mortgageName}
        onSaved={(note) => setNotes([note, ...(notes ?? [])])}
      />
    </div>
  )
}
