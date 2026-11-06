// "Lend this": a Simulation on the Calculator carried into New Mortgage, through the URL.
import type { Terms } from './api'
import { todayIso } from './format'
import { draftFromParams, draftParams, fromDraft, type TermsDraft } from './terms'

/** What a Simulation carries into a new Mortgage, to start its form from: not its plan
 *  or Closed on, which aren't facts about a new Mortgage. */
export interface Carried {
  amount: string // rupees
  start: string
  terms: Terms | null // the Default Terms, if none
}

/** New Mortgage, at choosing a Customer, carrying a Simulation's amount, start and Terms. */
export const lendThisLink = (amount: string, start: string, terms: TermsDraft) =>
  `/mortgages/new?${new URLSearchParams({ amount, start, ...draftParams(terms) })}`

/** What New Mortgage was opened carrying: blank, today and no Terms if nothing. */
export function carriedIn(params: URLSearchParams): Carried {
  const terms = draftFromParams(params)
  return {
    amount: params.get('amount') ?? '',
    start: params.get('start') ?? todayIso(),
    terms: terms && fromDraft(terms),
  }
}
