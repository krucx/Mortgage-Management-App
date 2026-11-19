import type { OutstandingOnClosure } from '../api'
import { formatINR } from '../money'
import { ReasonTip } from './ReasonTip'

/** A quote of the Outstanding on a Closure date, why there is none, or still
 *  loading. */
export type Quote = OutstandingOnClosure | string | undefined

/** The Outstanding cell: the amount (and what is left to pay after any Advance held),
 *  still loading, or (kept compact, so the table stays tidy) a marker whose tooltip says
 *  why it can't be closed then. */
export function Owed({ quote }: { quote: Quote }) {
  if (typeof quote === 'string') return <ReasonTip reason={quote}>Can't redeem</ReasonTip>
  if (!quote) return '…'
  if (!quote.advance_held) return formatINR(quote.total)
  return (
    <>
      {formatINR(quote.total)}
      <div className="hint">
        Advance held {formatINR(quote.advance_held)}, to pay {formatINR(quote.to_pay)}
      </div>
    </>
  )
}
