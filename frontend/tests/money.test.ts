import { describe, expect, it } from 'vitest'
import { formatChange, formatINR, paiseToRupees, rupeesToPaise } from '../src/money'

describe('formatINR', () => {
  it.each([
    [0, '₹0'],
    [99_900, '₹999'],
    [100_000, '₹1,000'],
    [13_600_000, '₹1,36,000'],
    [1_234_567_800, '₹1,23,45,678'],
  ])('shows whole rupees with Indian grouping: %i paise → %s', (paise, expected) => {
    expect(formatINR(paise)).toBe(expected)
  })

  it.each([
    [150, '₹1.50'],
    [1_234_567_805, '₹1,23,45,678.05'],
  ])('shows paise only when there are some: %i paise → %s', (paise, expected) => {
    expect(formatINR(paise)).toBe(expected)
  })

  it('puts the minus sign before the rupee symbol', () => {
    expect(formatINR(-500_000)).toBe('-₹5,000')
  })
})

describe('formatChange', () => {
  it.each([
    [420_000, '+₹4,200'],
    [-420_000, '−₹4,200'],
    [0, 'no change'],
  ])('shows a difference with its sign: %i paise → %s', (paise, expected) => {
    expect(formatChange(paise)).toBe(expected)
  })
})

describe('rupees in forms', () => {
  it.each([
    ['0.5', 50],
    ['1234.5', 123_450],
    ['51500', 5_150_000],
  ])('round-trips typed rupees and paise: %s ↔ %i', (text, paise) => {
    expect(rupeesToPaise(text)).toBe(paise)
    expect(paiseToRupees(paise)).toBe(text)
  })

  it('rounds typed rupees to the nearest paisa', () => {
    expect(rupeesToPaise('10.005')).toBe(1001)
  })

  it.each([[''], ['abc']])('reads blank or invalid text %j as no paise', (text) => {
    expect(rupeesToPaise(text)).toBe(0)
  })

  it('shows no amount as blank', () => {
    expect(paiseToRupees(null)).toBe('')
  })
})
