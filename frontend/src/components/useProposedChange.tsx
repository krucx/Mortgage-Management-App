import { useState, type FormEvent, type ReactNode } from 'react'
import type { PreviewRequest } from '../requests'
import type { ConfirmOptions } from './ConfirmDialog'
import { useConfirm } from './useConfirm'
import { usePreview, type Preview } from './usePreview'

/**
 * A change the Lender drafts in a form, seeing its Preview as they go. `change` is what
 * saving would send, or null while the draft can't be saved; Save stays disabled then,
 * and while the Preview says the backend would refuse it. Save asks to `confirm`
 * (unless that is null: the change's own dialog has asked already), then saves
 * (through useLedgerChange or useMortgageChange, which make stale what it changes)
 * and hands what was saved to `saved`. A refused save shows the
 * backend's reason and can be tried again; after a save, Save stays disabled.
 */
export function useProposedChange<Change, Saved>({
  change,
  preview: previewOf,
  confirm: confirmationOf,
  save,
  saved,
}: {
  change: Change | null
  /** The Preview of `change`; null for a change that changes nothing to preview. */
  preview: (change: Change) => PreviewRequest | null
  /** The confirmation asked for when Save is pressed; null to save straight away. */
  confirm: ((change: Change) => ConfirmOptions) | null
  save: (change: Change) => Promise<Saved>
  /** What happens once it is saved: usually going to what changed. */
  saved: (result: Saved) => void
}): {
  preview: Preview
  /** The form's onSubmit. */
  submit: (event: FormEvent) => Promise<void>
  saving: boolean
  canSave: boolean
  /** Why the last save was refused. */
  error: string | null
  /** Render it somewhere in the page. */
  confirmDialog: ReactNode
} {
  const preview = usePreview(change === null ? null : previewOf(change))
  const [confirm, confirmDialog] = useConfirm()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canSave = change !== null && !saving && !preview.error

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (change === null || !canSave) return
    if (confirmationOf && !(await confirm(confirmationOf(change)))) return
    setSaving(true)
    setError(null)
    let result: Saved
    try {
      result = await save(change)
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
      return
    }
    saved(result)
  }

  return { preview, submit, saving, canSave, error, confirmDialog }
}
