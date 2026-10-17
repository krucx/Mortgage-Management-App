import type { InterestMode, PartMonthRule, Terms } from './api'

export const INTEREST_MODES: Record<InterestMode, string> = {
  simple: 'Simple',
  compounded_yearly: 'Compounded Yearly (simple monthly, capitalised every year)',
  compounded_monthly: 'Compounded Monthly',
}

export const PART_MONTH_RULES: Record<PartMonthRule, string> = {
  full_month: 'Full month',
  pro_rata: 'Pro-rata by day',
  nothing: 'Nothing',
}

/** Terms while being edited: the rate stays as typed text until saved. */
export interface TermsDraft {
  ratePercent: string
  interest_mode: InterestMode
  part_month_rule: PartMonthRule
}

export const toDraft = (terms: Terms): TermsDraft => ({
  ratePercent: (terms.monthly_rate_bps / 100).toString(),
  interest_mode: terms.interest_mode,
  part_month_rule: terms.part_month_rule,
})

export const fromDraft = (draft: TermsDraft): Terms => ({
  monthly_rate_bps: Math.round(Number(draft.ratePercent) * 100),
  interest_mode: draft.interest_mode,
  part_month_rule: draft.part_month_rule,
})

/** Basis points per month → "3%". */
export const formatRate = (bps: number) => `${bps / 100}%`

/** "3% a month · Simple · Part-Month Rule: Full month". */
export const describeTerms = (terms: Terms) =>
  `${formatRate(terms.monthly_rate_bps)} a month · ${INTEREST_MODES[terms.interest_mode]} · ` +
  `Part-Month Rule: ${PART_MONTH_RULES[terms.part_month_rule]}`
