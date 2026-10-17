import { useState, type ReactNode } from 'react'
import { ConfirmDialog, type ConfirmOptions } from './ConfirmDialog'

/**
 * An in-app confirmation (never a browser popup).
 *
 *     const [confirm, confirmDialog] = useConfirm()
 *     if (!(await confirm({ title: 'Save this Customer?' }))) return
 *     …and render {confirmDialog} somewhere in the page.
 */
export function useConfirm(): [(options: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [request, setRequest] = useState<{
    options: ConfirmOptions
    resolve: (confirmed: boolean) => void
  } | null>(null)

  const confirm = (options: ConfirmOptions) =>
    new Promise<boolean>((resolve) => setRequest({ options, resolve }))

  const dialog = request && (
    <ConfirmDialog
      {...request.options}
      onClose={(confirmed) => {
        request.resolve(confirmed)
        setRequest(null)
      }}
    />
  )
  return [confirm, dialog]
}
