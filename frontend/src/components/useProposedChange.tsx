import { useState, type FormEvent, type ReactNode } from 'react'
import type { PreviewRequest } from '../requests'
import type { ConfirmOptions } from './ConfirmDialog'
import { useConfirm } from './useConfirm'
import { usePreview, type Preview } from './usePreview'

/**
 * A change the Lender drafts in a form, seeing its Preview as they go: Save stays
 * disabled while the draft isn't `ready` or its Preview says the backend would refuse
 * it; Save asks to `confirm`, then saves (through useLedgerChange or useMortgageChange,
 * which make stale what it changes) and hands what was saved to `saved`. A refused save
 * shows the backend's reason and can be tried again; after a save, Save stays disabled.
 */
export function useProposedChange<Saved>({
  preview: request,
  ready,
  confirm: confirmation,
  save,
  saved,
}: {
  /** The Preview of the change as drafted; null while there is nothing to preview. */
  preview: PreviewRequest | null
  /** Whether the draft could be saved at all, by the page's own checks. */
  ready: boolean
  /** The confirmation to ask for when Save is pressed; null saves without asking. */
  confirm: () => ConfirmOptions | null
  save: () => Promise<Saved>
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
  const preview = usePreview(request)
  const [confirm, confirmDialog] = useConfirm()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canSave = ready && !saving && !preview.error

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSave) return
    const asked = confirmation()
    if (asked && !(await confirm(asked))) return
    setSaving(true)
    setError(null)
    let result: Saved
    try {
      result = await save()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
      return
    }
    saved(result)
  }

  return { preview, submit, saving, canSave, error, confirmDialog }
}
