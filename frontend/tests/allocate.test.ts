import { describe, expect, it } from 'vitest'
import { allocateEqually, amountsFromPercentages, percentagesOf, tickedFirst } from '../src/allocate'

const r = (rupees: number) => Math.round(rupees * 100) // rupees → paise
const rupees = (paise: number[] | null) => paise?.map((p) => p / 100) ?? null

describe('allocateEqually', () => {
  it('splits in whole rupees, leftover rupees to the first Mortgages', () => {
    expect(rupees(allocateEqually(r(100_000), [r(90_000), r(90_000), r(90_000)]))).toEqual([
      33_334, 33_333, 33_333,
    ])
  })

  it('pays off a Mortgage that owes less than its share and shares the excess', () => {
    expect(rupees(allocateEqually(r(100_000), [r(10_000), r(80_000), r(80_000)]))).toEqual([
      10_000, 45_000, 45_000,
    ])
  })

  it('keeps redistributing until no share is more than its Mortgage owes', () => {
    // Share 33,333 caps the first; then 45,000 each caps the second; the rest goes to the third.
    expect(rupees(allocateEqually(r(100_000), [r(10_000), r(20_000), r(100_000)]))).toEqual([
      10_000, 20_000, 70_000,
    ])
  })

  it('pays a capped Mortgage to the paisa', () => {
    expect(rupees(allocateEqually(r(20_000), [r(5_000.5), r(100_000)]))).toEqual([5_000.5, 14_999.5])
  })

  it('puts leftover paise of the total on the first Mortgage', () => {
    expect(rupees(allocateEqually(r(1_000.5), [r(5_000), r(5_000)]))).toEqual([500.5, 500])
  })

  it('pays everything when the total equals what is owed', () => {
    expect(rupees(allocateEqually(r(30_000.25), [r(10_000), r(20_000.25)]))).toEqual([
      10_000, 20_000.25,
    ])
  })

  it('returns null when the total is more than everything owed', () => {
    expect(allocateEqually(r(30_001), [r(10_000), r(20_000)])).toBeNull()
  })

  it('always adds up exactly to the total', () => {
    const owed = [r(1_234.56), r(98_765.43), r(5_555.55), r(10)]
    for (const total of [r(1), r(99.99), r(10_000), r(50_000.07), r(105_565.54)]) {
      const split = allocateEqually(total, owed)!
      expect(split.reduce((a, b) => a + b, 0)).toBe(total)
      split.forEach((amount, i) => expect(amount).toBeLessThanOrEqual(owed[i]))
    }
  })
})

describe('amountsFromPercentages', () => {
  it('turns percentages of the total into whole-rupee amounts', () => {
    expect(rupees(amountsFromPercentages(r(100_000), [50, 25, 25]))).toEqual([50_000, 25_000, 25_000])
  })

  it('gives rounding leftovers to the first Mortgage so the amounts add up', () => {
    expect(rupees(amountsFromPercentages(r(1_000), [33.33, 33.33, 33.34]))).toEqual([
      334, 333, 333,
    ])
  })

  it('returns null unless the percentages add up to 100', () => {
    expect(amountsFromPercentages(r(1_000), [50, 40])).toBeNull()
  })
})

describe('amountsFromPercentages with a 0% Mortgage', () => {
  it('never gives leftovers to a Mortgage set to 0%', () => {
    expect(rupees(amountsFromPercentages(r(1_000), [0, 33.33, 66.67]))).toEqual([0, 334, 666])
  })
})

describe('percentagesOf', () => {
  it('turns amounts into percentages that add up to exactly 100', () => {
    const percentages = percentagesOf([r(33_334), r(33_333), r(33_333)], r(100_000))

    expect(percentages).toEqual([33.34, 33.33, 33.33])
    expect(amountsFromPercentages(r(100_000), percentages)).not.toBeNull()
  })

  it('gives the rounding remainder only to Mortgages with a share', () => {
    expect(percentagesOf([0, r(1), r(2)], r(3))).toEqual([0, 33.34, 66.66])
  })
})

describe('amountsFromPercentages with Outstanding limits', () => {
  it('never allocates more than a Mortgage owes; the excess goes to Mortgages with room', () => {
    // 18.59% of ₹60,001 is ₹11,154, but that Mortgage owes only ₹11,150.
    const amounts = amountsFromPercentages(r(60_001), [18.59, 81.41], [r(11_150), r(82_150)])

    expect(rupees(amounts)).toEqual([11_150, 48_851])
  })

  it('leaves the excess unallocated when no Mortgage has room', () => {
    const amounts = amountsFromPercentages(r(1_000), [50, 50], [r(100), r(100)])!

    expect(rupees(amounts)).toEqual([100, 100])
  })
})

describe('tickedFirst', () => {
  it('moves the ticked Mortgages to the top, each group keeping its order', () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]
    expect(tickedFirst(rows, new Set([4, 2])).map((m) => m.id)).toEqual([2, 4, 1, 3])
  })
})
