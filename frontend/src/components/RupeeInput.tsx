import type { InputHTMLAttributes } from 'react'

/**
 * A rupee amount field. Its arrows and scrolling move by whole rupees, and an amount with
 * paise (1500.50) can still be typed. `step="1"` would flag 1500.50 as invalid and step it
 * onto whole rupees; with `step="any"` browsers step by ₹1 and keep the paise.
 */
export function RupeeInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'step'>) {
  return <input {...props} type="number" step="any" />
}
