import { fireEvent } from '@testing-library/react'
import { expect } from 'vitest'

/**
 * A rupee amount field steps by whole rupees: its step is "any", which browsers step by ₹1
 * keeping the paise (jsdom can't press the arrows; qa/features/rupee-fields.feature does).
 * An amount with paise is valid as typed, and the field's minimum still applies. The field
 * is left holding `afterwards`.
 */
export function expectWholeRupeeSteps(field: HTMLElement, min: string, afterwards = '') {
  const input = field as HTMLInputElement
  expect(input.step).toBe('any')
  expect(input.min).toBe(min)
  fireEvent.change(input, { target: { value: '1500.50' } })
  expect(input.validity.valid).toBe(true)
  fireEvent.change(input, { target: { value: String(Number(min) - 0.01) } })
  expect(input.validity.rangeUnderflow).toBe(true)
  fireEvent.change(input, { target: { value: afterwards } })
}
