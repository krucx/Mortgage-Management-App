import { useEffect, useRef, type ReactNode } from 'react'
import { Modal } from './Modal'

/** A popup with a long list that scrolls inside it; opens scrolled to `start`. */
export function ScrollPopup({
  title,
  start = 'top',
  onClose,
  children,
}: {
  title: string
  start?: 'top' | 'bottom'
  onClose: () => void
  children: ReactNode
}) {
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (start === 'bottom' && scroller.current) {
      scroller.current.scrollTop = scroller.current.scrollHeight
    }
  }, [start])

  return (
    <Modal onClose={onClose} className="scroll-popup">
      <div className="row spread">
        <h2>{title}</h2>
        <button type="button" className="secondary small" autoFocus onClick={onClose}>
          Close
        </button>
      </div>
      <div ref={scroller} className="scroll-popup-body">
        {children}
      </div>
    </Modal>
  )
}
