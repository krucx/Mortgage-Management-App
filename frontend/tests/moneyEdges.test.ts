import { describe, expect, it } from 'vitest'
import { allocateEqually, amountsFromPercentages, percentagesOf } from '../src/allocate'
import { formatChange, formatINR, paiseToRupees, rupeesToPaise } from '../src/money'

const r = (rupees: number) => Math.round(rupees * 100) // rupees → paise

/** A small seeded generator, so the random cases below are the same on every run. */
function random(seed: number) {
  let state = seed
  return (below: number) => {
    state = (state * 1_664_525 + 1_013_904_223) % 2 ** 32
    return state % below
  }
}

describe('formatINR edges', () => {
  it.each([
    [1, '₹0.01'],
    [99, '₹0.99'],
    [-150, '-₹1.50'],
    [10_000_000_000, '₹10,00,00,000'], // ₹10 crore
    [-1, '-₹0.01'],
  ])('%i paise → %s', (paise, expected) => {
    expect(formatINR(paise)).toBe(expected)
  })

  it('formats ₹1,000 crore and a paisa exactly', () => {
    expect(formatINR(10_000_000_000_001)).toBe('₹1,00,00,00,00,000.01')
  })

  it('shows -₹0 never: zero has no sign', () => {
    expect(formatINR(0)).toBe('₹0')
    expect(formatINR(-0)).toBe('₹0')
  })

  it('names a one-paisa change', () => {
    expect(formatChange(1)).toBe('+₹0.01')
    expect(formatChange(-1)).toBe('−₹0.01')
  })
})

describe('rupees typed in forms, edges', () => {
  it.each([
    ['0.01', 1],
    ['0.07', 7], // 0.07 × 100 is 7.000000000000001 in floating point
    ['19.99', 1999],
    ['  12 ', 1200],
    ['1,000', 0], // a thousands separator is not a number
  ])('%j → %i paise', (text, paise) => {
    expect(rupeesToPaise(text)).toBe(paise)
  })

  it('round-trips every whole paisa from 0 to 9999', () => {
    for (let paise = 0; paise < 10_000; paise++) {
      expect(rupeesToPaise(paiseToRupees(paise))).toBe(paise)
    }
  })

  // AMBIGUOUS, documented for the owner: current behaviour, not necessarily the intended one.
  it('CURRENT BEHAVIOUR: a half-paisa typed as 1.005 rounds down through float error', () => {
    expect(rupeesToPaise('1.005')).toBe(100)
    expect(rupeesToPaise('10.005')).toBe(1001) // while this one rounds up
  })

  it('CURRENT BEHAVIOUR: a negative or infinite amount is passed through, for the forms to refuse', () => {
    expect(rupeesToPaise('-5')).toBe(-500)
    expect(rupeesToPaise('Infinity')).toBe(Infinity)
  })
})

describe('allocateEqually edges', () => {
  it('allocates nothing for a zero total', () => {
    expect(allocateEqually(0, [r(100), r(200)])).toEqual([0, 0])
  })

  it('allocates nothing when there is nothing owed and nothing paid', () => {
    expect(allocateEqually(0, [0, 0])).toEqual([0, 0])
  })

  it('never gives a Mortgage that owes nothing a share', () => {
    expect(allocateEqually(r(100), [0, r(500)])).toEqual([0, r(100)])
  })

  it('puts a total of less than one rupee per Mortgage on the first one, paise and all', () => {
    expect(allocateEqually(50, [r(100), r(100), r(100)])).toEqual([50, 0, 0])
  })

  it('handles one paisa', () => {
    expect(allocateEqually(1, [r(100), r(100)])).toEqual([1, 0])
  })

  it('handles a single Mortgage taking everything', () => {
    expect(allocateEqually(r(1234.56), [r(1234.56)])).toEqual([r(1234.56)])
  })

  it('splits ₹100 crore across three Mortgages exactly', () => {
    const total = r(1_000_000_000)
    const split = allocateEqually(total, [total, total, total])!

    expect(split.reduce((a, b) => a + b, 0)).toBe(total)
    expect(split.map((p) => p % 100)).toEqual([0, 0, 0])
  })

  it('always adds up, and stays within each cap', () => {
    const next = random(2026)
    for (let round = 0; round < 500; round++) {
      const caps = Array.from({ length: 1 + next(6) }, () => (next(5) === 0 ? 0 : next(5_000_000)))
      const owed = caps.reduce((a, b) => a + b, 0)
      const total = owed === 0 ? 0 : next(owed + 1)

      const split = allocateEqually(total, caps)!

      expect(split.reduce((a, b) => a + b, 0)).toBe(total)
      split.forEach((amount, i) => {
        expect(amount).toBeGreaterThanOrEqual(0)
        expect(amount).toBeLessThanOrEqual(caps[i])
      })
    }
  })
})

describe('amountsFromPercentages and percentagesOf edges', () => {
  it('gives 100% to one Mortgage the whole total, paise included', () => {
    expect(amountsFromPercentages(r(1_234.56), [100])).toEqual([r(1_234.56)])
  })

  it('does not lose a rupee to float error on awkward percentages', () => {
    for (const percent of [29, 58, 7, 14, 57, 0.29, 33.33]) {
      const amounts = amountsFromPercentages(r(100_000), [percent, 100 - percent])!
      expect(amounts.reduce((a, b) => a + b, 0)).toBe(r(100_000))
    }
  })

  it('accepts percentages that add up to 100 within float tolerance', () => {
    expect(amountsFromPercentages(r(100), [0.1 + 0.2, 99.7])).not.toBeNull()
  })

  it('percentages of equal shares of an odd total still add up to exactly 100', () => {
    const next = random(7)
    for (let round = 0; round < 300; round++) {
      const parts = Array.from({ length: 1 + next(5) }, () => 1 + next(9_999_999))
      const total = parts.reduce((a, b) => a + b, 0)
      const sum = percentagesOf(parts, total).reduce((a, b) => a + b * 100, 0)

      expect(Math.round(sum)).toBe(10_000)
    }
  })
})
