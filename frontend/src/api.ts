export type InterestMode = 'simple' | 'compounded_yearly' | 'compounded_monthly'
export type PartMonthRule = 'pro_rata' | 'full_month' | 'nothing'

export interface DefaultTerms {
  /** Basis points per month: 300 = 3% a month. */
  monthly_rate_bps: number
  interest_mode: InterestMode
  part_month_rule: PartMonthRule
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${await response.text()}`)
  }
  return response.json() as Promise<T>
}

export const api = {
  getDefaultTerms: () => request<DefaultTerms>('/settings/default-terms'),
  updateDefaultTerms: (terms: DefaultTerms) =>
    request<DefaultTerms>('/settings/default-terms', {
      method: 'PUT',
      body: JSON.stringify(terms),
    }),
}
