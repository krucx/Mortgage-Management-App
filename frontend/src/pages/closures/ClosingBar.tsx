import { useState } from 'react'
import { ForfeitChosen } from './ForfeitChosen'
import type { Chosen } from './types'
import { WaiveChosen } from './WaiveChosen'

/** Close the chosen Mortgages: pick Forfeit or Waive off, then fill in and confirm that form. */
export function ClosingBar({ chosen, onDone }: { chosen: Chosen[]; onDone: () => void }) {
  const [closing, setClosing] = useState<'forfeit' | 'waive'>('forfeit')
  if (chosen.length === 0) return null
  const Form = closing === 'forfeit' ? ForfeitChosen : WaiveChosen
  return (
    <>
      <div className="row" role="radiogroup" aria-label="Close the chosen by">
        <span>With the {chosen.length} chosen:</span>
        <label className="inline">
          <input
            type="radio"
            name="closing"
            checked={closing === 'forfeit'}
            onChange={() => setClosing('forfeit')}
          />
          Forfeit
        </label>
        <label className="inline">
          <input
            type="radio"
            name="closing"
            checked={closing === 'waive'}
            onChange={() => setClosing('waive')}
          />
          Waive off
        </label>
      </div>
      {/* The closures made both lists stale. */}
      <Form chosen={chosen} onDone={onDone} />
    </>
  )
}
