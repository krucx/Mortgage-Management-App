import type { ClosingQuote } from '../api'
import { formatINR } from '../money'
import { ReasonTip } from './ReasonTip'

/** A closing quote: the Outstanding on the Closure date, why there is none, or still
 *  loading. */
export type Quote = ClosingQuote | string | undefined

/** The Outstanding cell: the amount, still loading, or (kept compact, so the table stays
 *  tidy) a marker whose tooltip says why it can't be closed then. */
export function Owed({ quote }: { quote: Quote }) {
  if (typeof quote === 'string')
    return (
      <ReasonTip reason={quote}>Can't redeem</ReasonTip>
    )
  return quote ? formatINR(quote.total) : '…'
}
