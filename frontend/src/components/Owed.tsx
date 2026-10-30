import type { Redemption } from '../api'
import { formatINR } from '../money'
import { ReasonTip } from './ReasonTip'

/** A Redemption Amount quote: the Redemption, why there is none, or still loading. */
export type Quote = Redemption | string | undefined

/** The Redemption Amount cell: the amount, still loading, or (kept compact, so the table
 *  stays tidy) a marker whose tooltip says why there is none. */
export function Owed({ quote }: { quote: Quote }) {
  if (typeof quote === 'string')
    return (
      <ReasonTip reason={quote}>Can't redeem</ReasonTip>
    )
  return quote ? formatINR(quote.total) : '…'
}
