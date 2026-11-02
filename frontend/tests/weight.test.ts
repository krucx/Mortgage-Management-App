import { describe, expect, it } from 'vitest'
import { gramsToMg, mgToGrams } from '../src/weight'

describe('grams in forms', () => {
  it.each([
    ['25.4', 25_400],
    ['0.001', 1],
    ['12', 12_000],
  ])('round-trips typed grams and milligrams: %s ↔ %i', (text, mg) => {
    expect(gramsToMg(text)).toBe(mg)
    expect(mgToGrams(mg)).toBe(text)
  })

  it.each([[''], ['abc']])('reads blank or invalid text %j as no weight', (text) => {
    expect(gramsToMg(text)).toBe(0)
  })
})
