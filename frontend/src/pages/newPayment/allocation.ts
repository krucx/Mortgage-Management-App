import { allocateEqually, amountsFromPercentages } from '../../allocate'
import type { MortgageRow, PaymentIn } from '../../api'
import { formatINR, rupeesToPaise } from '../../money'

export type AllocationMode = 'equal' | 'amount' | 'percent'

/** Owing nothing (Dormant, ADR 0012), a Mortgage can't take a Payment, only be Redeemed. */
export const owesSomething = (m: MortgageRow) => m.outstanding_total > 0

/**
 * Equal shares as a suggestion only, each up to its cap. More than all of them can take
 * is still split equally: whether a Payment is too large is for the preview to say, as
 * saving would.
 */
export function suggestEqually(total: number, caps: number[]): number[] | null {
  return (
    allocateEqually(total, caps) ??
    allocateEqually(
      total,
      caps.map(() => Infinity),
    )
  )
}

/** What the form has entered: the cash and Discount totals, and the chosen Mortgages with
 *  what each owes and the amounts or percentages typed against them. */
interface Draft {
  mode: AllocationMode
  total: number
  discountTotal: number
  chosen: MortgageRow[]
  outstanding: number[]
  amountText: Record<number, string>
  percentText: Record<number, string>
}

/** The cash for each chosen Mortgage by the mode; null if the percentages don't add up. */
export function allocationAmounts({
  mode,
  total,
  chosen,
  outstanding,
  amountText,
  percentText,
}: Draft): number[] | null {
  if (total === 0) return chosen.map(() => 0)
  if (mode === 'equal') return suggestEqually(total, outstanding)
  if (mode === 'amount') return chosen.map((m) => rupeesToPaise(amountText[m.id]))
  return amountsFromPercentages(
    total,
    chosen.map((m) => Number(percentText[m.id] || '0')),
    outstanding,
  )
}

/** Why the draft can't be previewed yet, if so. */
export function allocationProblems(draft: Draft, amounts: number[] | null): string[] {
  const { mode, total, discountTotal, chosen, percentText } = draft
  const allocated = amounts?.reduce((a, b) => a + b, 0) ?? 0
  const problems: string[] = []
  if (chosen.length === 0) problems.push('Choose at least one Mortgage.')
  if (total < 0 || discountTotal < 0) problems.push('Amounts cannot be negative.')
  if (total === 0 && discountTotal === 0) problems.push('Enter cash received or a Discount.')
  if (mode === 'percent' && chosen.some((m) => Number(percentText[m.id] || '0') < 0))
    problems.push('Percentages cannot be negative.')
  if (amounts?.some((amount) => amount < 0)) problems.push('Allocations cannot be negative.')
  if (total > 0 && mode === 'percent' && amounts === null)
    problems.push('The percentages must add up to 100.')
  if (amounts && total > 0 && allocated !== total)
    problems.push(`The Allocations add up to ${formatINR(allocated)}, not ${formatINR(total)}.`)
  return problems
}

/** Each Discount held to the room its Mortgage has left, and the Allocations that were
 *  over it. */
export function discountCaps(
  payment: PaymentIn,
  previewed: { mortgage_id: number; discount_room: number }[],
) {
  const rooms = new Map(previewed.map((m) => [m.mortgage_id, m]))
  const capped = new Map(
    payment.allocations.map((allocation) => [
      allocation.mortgage_id,
      Math.min(allocation.discount, rooms.get(allocation.mortgage_id)?.discount_room ?? 0),
    ]),
  )
  const over = payment.allocations.filter(
    (allocation) => (capped.get(allocation.mortgage_id) ?? 0) < allocation.discount,
  )
  return { capped, over }
}
