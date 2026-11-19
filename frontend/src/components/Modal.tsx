import { useEffect, useRef, type ReactNode } from 'react'

/** An in-app modal window (never a browser popup); its × button and Esc close it, and so
 *  does a click on the dimmed page around it unless `closeOnOutsideClick` is off (for one
 *  holding typed input, which a stray click would lose). Named by the element with id
 *  `labelledBy`. */
export function Modal({
  onClose,
  children,
  className = '',
  labelledBy,
  closeOnOutsideClick = true,
}: {
  onClose: () => void
  children: ReactNode
  className?: string
  labelledBy?: string
  closeOnOutsideClick?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  return (
    <dialog
      ref={dialog}
      className={`confirm modal ${className}`}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        // The backdrop counts as the dialog itself: close only outside its box.
        if (!closeOnOutsideClick || event.target !== dialog.current) return
        const box = dialog.current.getBoundingClientRect()
        const inside =
          event.clientX >= box.left &&
          event.clientX <= box.right &&
          event.clientY >= box.top &&
          event.clientY <= box.bottom
        if (!inside) onClose()
      }}
    >
      {children}
      {/* Last in the tab order; it sits in the top corner. */}
      <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
        ×
      </button>
    </dialog>
  )
}
