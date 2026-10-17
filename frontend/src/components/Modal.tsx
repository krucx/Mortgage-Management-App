import { useEffect, useRef, type ReactNode } from 'react'

/** An in-app modal window (never a browser popup); Esc or the backdrop closes it. */
export function Modal({
  onClose,
  children,
  className = '',
}: {
  onClose: () => void
  children: ReactNode
  className?: string
}) {
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  return (
    <dialog
      ref={dialog}
      className={`confirm modal ${className}`}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      {children}
    </dialog>
  )
}
