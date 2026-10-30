import { useEffect, useId, useState, type ReactNode } from 'react'

const WIDTH = 260 // the bubble's widest, as in index.css
const GAP = 4

type Place = { left: number; top?: number; bottom?: number }

/**
 * A compact red marker whose `reason` shows in a bubble on hover, focus or tap, so a
 * long refusal doesn't stretch a table. The bubble is fixed to the window (a scrolling
 * table can't clip it), kept on screen, and closed by Escape or scrolling.
 */
export function ReasonTip({ reason, children }: { reason: string; children: ReactNode }) {
  const id = useId()
  const [place, setPlace] = useState<Place | null>(null)
  const show = (event: { currentTarget: HTMLElement }) => {
    const box = event.currentTarget.getBoundingClientRect()
    const left = Math.max(8, Math.min(box.left, window.innerWidth - WIDTH - 8))
    // Above the marker when there's no room for it below.
    setPlace(
      box.bottom + 80 > window.innerHeight
        ? { left, bottom: window.innerHeight - box.top + GAP }
        : { left, top: box.bottom + GAP },
    )
  }
  const hide = () => setPlace(null)

  useEffect(() => {
    if (!place) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && hide()
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', hide, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', hide, true)
    }
  }, [place])

  return (
    <span
      className="status error reason-tip"
      tabIndex={0}
      aria-describedby={id}
      onMouseEnter={show}
      onFocus={show}
      onClick={(event) => (place ? hide() : show(event))}
      onMouseLeave={hide}
      onBlur={hide}
    >
      {children}
      <span id={id} className="reason-bubble" role="tooltip" hidden={!place} style={place ?? undefined}>
        {reason}
      </span>
    </span>
  )
}
