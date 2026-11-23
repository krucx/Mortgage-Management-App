import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Modal } from './Modal'
import styles from './ScrollPopup.module.css'

/** A popup with a long list that scrolls inside it; opens scrolled to `start`, and closes
 *  on Close, Esc or a click outside it. */
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
  const titleId = useId()

  useEffect(() => {
    if (start === 'bottom' && scroller.current) {
      scroller.current.scrollTop = scroller.current.scrollHeight
    }
  }, [start])

  return (
    <Modal onClose={onClose} className={styles.popup} labelledBy={titleId}>
      <h2 id={titleId}>{title}</h2>
      <div ref={scroller} className={styles.body}>
        {children}
      </div>
    </Modal>
  )
}
