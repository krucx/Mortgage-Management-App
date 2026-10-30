import { useEffect, useId, useState, type ReactNode } from 'react'

const WIDEST = 300 // the bubble's widest, in px
const EDGE = 8 // kept this far inside the window
const GAP = 8 // between the marker and the bubble, room for its arrow

/** Where the bubble sits: its right edge under the marker's, above it near the bottom. */
type Place = { right: number; maxWidth: number; top?: number; bottom?: number; above: boolean }

/**
 * A compact red marker (its label and an ⓘ) whose `reason` shows in a bubble on hover,
 * focus or tap, so a long refusal doesn't stretch a table or a form. The bubble is
 * fixed to the window (a scrolling table can't clip it), kept on screen, points at the
 * marker, and closes on Escape or scrolling.
 */
export function ReasonTip({ reason, children }: { reason: string; children: ReactNode }) {
  const id = useId()
  const [place, setPlace] = useState<Place | null>(null)
  const show = (event: { currentTarget: HTMLElement }) => {
    const box = event.currentTarget.getBoundingClientRect()
    const right = Math.max(EDGE, window.innerWidth - box.right)
    const maxWidth = Math.min(WIDEST, window.innerWidth - right - EDGE)
    const above = box.bottom + 96 > window.innerHeight
    setPlace(
      above
        ? { right, maxWidth, above, bottom: window.innerHeight - box.top + GAP }
        : { right, maxWidth, above, top: box.bottom + GAP },
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
      className="reason-tip"
      tabIndex={0}
      aria-describedby={id}
      onMouseEnter={show}
      onFocus={show}
      onClick={(event) => (place ? hide() : show(event))}
      onMouseLeave={hide}
      onBlur={hide}
    >
      {children}
      <span className="reason-tip-icon" aria-hidden="true">
        i
      </span>
      <span
        id={id}
        role="tooltip"
        className={`reason-bubble${place?.above ? ' above' : ''}`}
        hidden={!place}
        style={place ? { right: place.right, maxWidth: place.maxWidth, top: place.top, bottom: place.bottom } : undefined}
      >
        {reason}
      </span>
    </span>
  )
}
