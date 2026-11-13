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

export const sameTerms = (a: Terms, b: Terms) =>
  a.monthly_rate_bps === b.monthly_rate_bps &&
  a.interest_mode === b.interest_mode &&
  a.part_month_rule === b.part_month_rule

/** Basis points per month → "3%". */
export const formatRate = (bps: number) => `${bps / 100}%`

/** "3% a month · Simple · Part-Month Rule: Full month". */
export const describeTerms = (terms: Terms) =>
  `${formatRate(terms.monthly_rate_bps)} a month · ${INTEREST_MODES[terms.interest_mode]} · ` +
  `Part-Month Rule: ${PART_MONTH_RULES[terms.part_month_rule]}`

/** `value` if it is one of `choices`' keys (a URL can be edited by hand), else `fallback`. */
export function oneOf<Key extends string>(
  choices: Record<Key, string>,
  value: string | null,
  fallback: Key,
): Key {
  return value !== null && value in choices ? (value as Key) : fallback
}

/** Terms kept in a URL under `rate`, `mode` and `rule` (each followed by `suffix`); none
 *  without a rate. */
export function draftFromParams(params: URLSearchParams, suffix = ''): TermsDraft | null {
  const rate = params.get(`rate${suffix}`)
  return rate === null
    ? null
    : {
        ratePercent: rate,
        interest_mode: oneOf(INTEREST_MODES, params.get(`mode${suffix}`), 'simple'),
        part_month_rule: oneOf(PART_MONTH_RULES, params.get(`rule${suffix}`), 'full_month'),
      }
}

/** Terms as a URL keeps them (see draftFromParams); with none, each is removed. */
export function draftParams(draft: TermsDraft, suffix?: string): Record<string, string>
export function draftParams(
  draft: TermsDraft | null,
  suffix?: string,
): Record<string, string | null>
export function draftParams(draft: TermsDraft | null, suffix = '') {
  return {
    [`rate${suffix}`]: draft?.ratePercent ?? null,
    [`mode${suffix}`]: draft?.interest_mode ?? null,
    [`rule${suffix}`]: draft?.part_month_rule ?? null,
  }
}
