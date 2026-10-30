import type { Redemption } from '../api'
import { formatINR } from '../money'

/** A Redemption Amount quote: the Redemption, why there is none, or still loading. */
export type Quote = Redemption | string | undefined

/** The Redemption Amount cell: the amount, still loading, or why there is none. */
export function Owed({ quote }: { quote: Quote }) {
  if (typeof quote === 'string') return <span className="status error">{quote}</span>
  return quote ? formatINR(quote.total) : '…'
}
