import { describe, expect, it } from 'vitest'
import { addMonths, formatDays } from '../src/format'

describe('formatDays', () => {
  it.each([
    [1, '1 day'],
    [2, '2 days'],
    [30, '30 days'],
  ])('counts the days of Interest to Date: %i → %s', (count, expected) => {
    expect(formatDays(count)).toBe(expected)
  })
})

describe('addMonths', () => {
  it('keeps the day, or the last day of a shorter month', () => {
    expect(addMonths('2026-04-20', 12)).toBe('2027-04-20')
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonths('2026-01-31', 120)).toBe('2036-01-31')
  })
})
