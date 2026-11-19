import { useId, type ReactNode } from 'react'
import { Modal } from './Modal'

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
  const titleId = useId()

  return (
    <Modal
      onClose={() => onClose(false)}
      className={wide ? 'wide-dialog' : ''}
      labelledBy={titleId}
    >
      <h2 id={titleId}>{title}</h2>
      {body && <div className="confirm-body">{body}</div>}
      <div className="row end">
        {/* Focused first, so a second accidental Enter goes back to editing, not saving. */}
        <button type="button" className="secondary" autoFocus onClick={() => onClose(false)}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={danger ? 'danger-solid' : ''}
          onClick={() => onClose(true)}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}

/** Label / value lines for a confirmation summary. */
export function Summary({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="summary">
      {rows.map(([label, value], index) => (
        <div key={`${index}:${label}`} className="summary-row">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}
