import type { Closure } from '../../api'
import { formatDays } from '../../format'
import { formatINR } from '../../money'

/** What paying a Mortgage's whole Outstanding does, for the Redeem question. */
export function RedeemedInFull({ name, closure }: { name: string; closure: Closure }) {
  const charge =
    closure.interest_to_date > 0
      ? `, including ${formatDays(closure.interest_to_date_days)} of Interest to Date`
      : ''
  return `This pays the full Outstanding of ${name} (${formatINR(closure.outstanding)}${charge}).`
}
