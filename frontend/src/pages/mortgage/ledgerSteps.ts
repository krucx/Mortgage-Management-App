import type { AdvanceInstalment, LedgerGrace, LedgerStep, Mortgage } from '../../api'
import { formatDate, formatDays, formatGraceDate } from '../../format'
import { formatINR } from '../../money'
import { describeTerms, formatRate, PART_MONTH_RULES } from '../../terms'

/** A Ledger step's date; a Grace Payment's with the date it was received and what it
 *  let off on this Mortgage. */
export function stepDate(step: LedgerStep, graces: Map<number, LedgerGrace>): string {
  // An Advance Instalment is dated its Accrual Date, never its Payment's (ADR 0021).
  const grace =
    step.payment_id == null || step.instalment_id ? undefined : graces.get(step.payment_id)
  return grace ? formatGraceDate(step.on, grace.received_on, grace.let_off) : formatDate(step.on)
}

/** What Payments in the month had already paid of its interest, if anything. */
function paidAhead(step: LedgerStep): string {
  return step.paid_ahead ? `, ${formatINR(step.paid_ahead)} of it paid ahead` : ''
}

export const instalmentName = (instalment: AdvanceInstalment) =>
  `Advance Instalment ${instalment.number} of ${instalment.of}` +
  (instalment.cancelled_on ? `, cancelled (due ${formatDate(instalment.on)})` : '')

/** The calculation behind a Ledger step, in words; `instalment` when the step is an
 *  Advance Instalment's. */
export function describeStep(
  step: LedgerStep,
  mortgage: Mortgage,
  instalment?: AdvanceInstalment,
): string {
  switch (step.event) {
    case 'started':
      return 'Mortgage started: Principal lent'
    case 'interest':
      return (
        `Interest: ${formatRate(step.monthly_rate_bps)} of ${formatINR(step.charged_on)}` +
        paidAhead(step)
      )
    case 'payment':
      return (
        `${instalment ? instalmentName(instalment) : 'Payment'}: ` +
        `${formatINR(step.interest_paid)} cash to interest, ` +
        `${formatINR(step.principal_paid)} cash to Principal` +
        (step.discount
          ? `; ${formatINR(step.discount_interest_paid)} Discount to interest, ` +
            `${formatINR(step.discount_principal_paid)} Discount to Principal`
          : '')
      )
    case 'interest_to_date': {
      const rule = step.part_month_rule ?? mortgage.terms.part_month_rule
      // Only while Active is it to date: a Closure fixes it.
      const toDate =
        mortgage.status !== 'active'
          ? ''
          : rule === 'pro_rata'
            ? ', to date: grows each day until the next Accrual Date'
            : ', to date: until the next Accrual Date'
      return (
        `Interest to Date: ${formatDays(step.interest_to_date_days)} of this month, ` +
        `${mortgage.status === 'active' ? 'today' : 'its Closure'} included ` +
        `(${PART_MONTH_RULES[rule]}) on ${formatINR(step.charged_on)}${toDate}` +
        paidAhead(step)
      )
    }
    case 'waived':
      return 'Waived off: the Lender let off what was left'
    case 'forfeited':
      return 'Forfeited: the jewellery settles what was owed'
    case 'capitalised':
      return 'Unpaid interest capitalised into Principal'
    case 'term_changed':
      return `Terms changed: ${step.terms ? describeTerms(step.terms) : ''}`
  }
}
