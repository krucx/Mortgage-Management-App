import type { MortgagePreview, PreviewOfChange } from '../src/api'

export interface FakeServer {
  /** For the typed client. */
  fetch: (request: Request) => Promise<Response>
  /** "METHOD /api/path" of every request, in order. */
  requests: string[]
}

/** A change's Preview as the backend answers it: each Mortgage it touches, and the sums
 *  it would write in cash (none, unless given). */
export const changePreview = (
  mortgages: (Omit<MortgagePreview, 'discount_room' | 'over_threshold' | 'advance'> &
    Partial<Pick<MortgagePreview, 'discount_room' | 'over_threshold' | 'advance'>>)[],
  cash: number[] = [],
): PreviewOfChange => ({
  mortgages: mortgages.map((mortgage) => ({
    discount_room: 0,
    over_threshold: false,
    ...mortgage,
  })),
  cash,
})
