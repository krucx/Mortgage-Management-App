// The calculation behind each Ledger step, in the words the Mortgage page shows.
import { expect, test } from 'vitest'
import type { AdvanceInstalment, LedgerStep } from '../src/api'
import { describeStep, instalmentName } from '../src/pages/mortgage/ledgerSteps'
import { mortgage } from './showPage'

const step = (fields: Partial<LedgerStep> & Pick<LedgerStep, 'on' | 'event'>): LedgerStep => ({
  amount: 0,
  principal: 5_000_000,
  unpaid_interest: 0,
  charged_on: 0,
  interest_to_date_days: 0,
  monthly_rate_bps: 0,
  paid_ahead: 0,
  interest_paid: 0,
  principal_paid: 0,
  discount: 0,
  discount_interest_paid: 0,
  discount_principal_paid: 0,
  payment_id: null,
  terms: null,
  ...fields,
})

const instalment: AdvanceInstalment = {
  id: 21,
  payment_id: 4,
  received_on: '2026-08-20',
  on: '2026-10-10',
  amount: 75_000,
  number: 1,
  of: 3,
  upcoming: false,
  cancelled_on: null,
}

test('a Payment says what its cash and its Discount paid', () => {
  const paid = step({
    on: '2026-08-12',
    event: 'payment',
    interest_paid: 50_000,
    principal_paid: 25_000,
    discount: 30_000,
    discount_interest_paid: 25_000,
    discount_principal_paid: 5_000,
    payment_id: 8,
  })

  expect(describeStep(paid, mortgage)).toBe(
    'Payment: ₹500 cash to interest, ₹250 cash to Principal; ₹250 Discount to interest, ₹50 Discount to Principal',
  )
})

test("an Advance Instalment's Payment is named by its part", () => {
  const paid = step({ on: '2026-10-10', event: 'payment', interest_paid: 75_000, payment_id: 4 })

  expect(describeStep(paid, mortgage, instalment)).toBe(
    'Advance Instalment 1 of 3: ₹750 cash to interest, ₹0 cash to Principal',
  )
  expect(instalmentName({ ...instalment, cancelled_on: '2026-09-01' })).toBe(
    'Advance Instalment 1 of 3, cancelled (due 10 Oct 2026)',
  )
})

test("a Closed Mortgage's Interest to Date runs to its Closure, not to date", () => {
  const toDate = step({
    on: '2026-10-18',
    event: 'interest_to_date',
    charged_on: 5_000_000,
    interest_to_date_days: 9,
    part_month_rule: 'pro_rata',
  })

  expect(describeStep(toDate, { ...mortgage, status: 'redeemed' })).toBe(
    'Interest to Date: 9 days of this month, its Closure included (Pro-rata by day) on ₹50,000',
  )
})

test('starting, capitalising, Term Changes and Closures are said in words', () => {
  const terms = { ...mortgage.terms, monthly_rate_bps: 200 }
  const said = (event: LedgerStep['event'], fields: Partial<LedgerStep> = {}) =>
    describeStep(step({ on: '2026-10-10', event, ...fields }), mortgage)

  expect(said('started')).toBe('Mortgage started: Principal lent')
  expect(said('capitalised')).toBe('Unpaid interest capitalised into Principal')
  expect(said('term_changed', { terms })).toMatch(/^Terms changed: 2%/)
  expect(said('waived')).toBe('Waived off: the Lender let off what was left')
  expect(said('forfeited')).toBe('Forfeited: the jewellery settles what was owed')
})
