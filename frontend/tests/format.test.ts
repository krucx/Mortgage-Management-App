import { describe, expect, it } from 'vitest'
import { formatDays } from '../src/format'

describe('formatDays', () => {
  it.each([
    [1, '1 day'],
    [2, '2 days'],
    [30, '30 days'],
  ])('counts the days of Interest to Date: %i → %s', (count, expected) => {
    expect(formatDays(count)).toBe(expected)
  })
})
