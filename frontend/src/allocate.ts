// How a lump-sum Payment is divided into Allocations. All amounts are paise.

const RUPEE = 100

/**
 * Hand out `leftover` in whole-rupee steps to the first entries that still have room.
 * Returns whatever could not be placed (0 unless everyone is full).
 */
function giveLeftover(
  amounts: number[],
  room: (i: number) => number,
  order: number[],
  leftover: number,
): number {
  while (leftover > 0) {
    let given = false
    for (const i of order) {
      const step = Math.min(RUPEE, leftover, room(i))
      if (step <= 0) continue
      amounts[i] += step
      leftover -= step
      given = true
      if (leftover === 0) break
    }
    if (!given) break
  }
  return leftover
}

/**
 * The default Allocations: equal whole-rupee shares, each Mortgage taking at most its cap
 * (its Redemption Amount, or Outstanding). One whose cap is less than its share gets
 * exactly its cap and the excess is shared among the rest, repeating until stable.
 * Leftover rupees (and any paise) go to the first Mortgages. Null if the total is more
 * than all the caps.
 */
export function allocateEqually(total: number, caps: number[]): number[] | null {
  if (total > caps.reduce((a, b) => a + b, 0)) return null
  const amounts = caps.map(() => 0)
  let open = caps.map((_, i) => i).filter((i) => caps[i] > 0)
  let remaining = total

  for (;;) {
    const share = Math.floor(remaining / open.length / RUPEE) * RUPEE
    const paidOff = open.filter((i) => caps[i] <= share)
    if (paidOff.length === 0) {
      for (const i of open) amounts[i] = share
      giveLeftover(amounts, (i) => caps[i] - amounts[i], open, remaining - share * open.length)
      return amounts
    }
    for (const i of paidOff) {
      amounts[i] = caps[i]
      remaining -= caps[i]
    }
    open = open.filter((i) => !paidOff.includes(i))
    if (open.length === 0) return amounts
  }
}

/**
 * Amounts from percentages of the total, in whole rupees, with the rounding leftover
 * going to the first Mortgages. With `caps`, no Mortgage gets more than its cap and the
 * excess goes to the other chosen Mortgages with room (a percentage can't always hit an
 * exact amount).
 * Null unless the percentages add up to 100.
 */
export function amountsFromPercentages(
  total: number,
  percentages: number[],
  caps: number[] = percentages.map(() => Infinity),
): number[] | null {
  const sum = percentages.reduce((a, b) => a + b, 0)
  if (Math.abs(sum - 100) > 1e-9) return null
  const amounts = percentages.map(
    // The epsilon keeps e.g. 29% of ₹1,00,000 from flooring to ₹28,999 through float error.
    (percent, i) =>
      Math.min(caps[i], Math.floor((total * percent) / 100 / RUPEE + 1e-9) * RUPEE),
  )
  const order = percentages.map((_, i) => i).filter((i) => percentages[i] > 0)
  // Anything that can't be placed is left over, so the Allocations visibly fall short.
  const room = (i: number) => caps[i] - amounts[i]
  giveLeftover(amounts, room, order, total - amounts.reduce((a, b) => a + b, 0))
  return amounts
}

/**
 * Amounts as percentages of the total (2 decimals) that add up to exactly 100, with the
 * rounding remainder going to the first Mortgages that have a share.
 */
export function percentagesOf(amounts: number[], total: number): number[] {
  const hundredths = amounts.map((amount) => Math.floor((amount * 10_000) / total))
  let leftover = 10_000 - hundredths.reduce((a, b) => a + b, 0)
  for (let i = 0; leftover > 0 && i < amounts.length; i++) {
    if (amounts[i] > 0) {
      hundredths[i] += 1
      leftover -= 1
    }
  }
  return hundredths.map((h) => h / 100)
}
