import { useEffect, useRef, type ReactNode } from 'react'

export interface ConfirmOptions {
  title: string
  /** What is about to happen, e.g. a summary of what will be saved. */
  body?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  /** Room for a larger body, such as a before/after preview. */
  wide?: boolean
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Confirm and save',
  cancelLabel = 'Keep editing',
  danger = false,
  wide = false,
  onClose,
}: ConfirmOptions & { onClose: (confirmed: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  return (
    <dialog
      ref={dialog}
      className={`confirm${wide ? ' wide-dialog' : ''}`}
      aria-labelledby="confirm-title"
      onCancel={(event) => {
        event.preventDefault() // Esc
        onClose(false)
      }}
    >
      <h2 id="confirm-title">{title}</h2>
      {body && <div className="confirm-body">{body}</div>}
      <div className="row end">
        {/* Focused first, so a second accidental Enter goes back to editing, not saving. */}
        <button type="button" className="secondary" autoFocus onClick={() => onClose(false)}>
          {cancelLabel}
        </button>
        <button type="button" className={danger ? 'danger-solid' : ''} onClick={() => onClose(true)}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  )
}

/** Label / value lines for a confirmation summary. */
export function Summary({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="summary">
      {rows.map(([label, value]) => (
        <div key={label} className="summary-row">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}
