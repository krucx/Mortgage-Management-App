export type InterestMode = 'simple' | 'compounded_yearly' | 'compounded_monthly'
export type PartMonthRule = 'pro_rata' | 'full_month' | 'nothing'

export interface DefaultTerms {
  /** Basis points per month: 300 = 3% a month. */
  monthly_rate_bps: number
  interest_mode: InterestMode
  part_month_rule: PartMonthRule
}

/** A Customer or standalone Referrer, as shown in lists and links. */
export interface PersonSummary {
  kind: 'customer' | 'referrer'
  id: number
  name: string
}

export interface SearchHit extends PersonSummary {
  phone: string
  photo_url: string | null
}

export type ReferrerChoice =
  | { kind: 'customer' | 'referrer'; id: number }
  | { kind: 'new'; name: string; address: string; phone: string }

export interface CustomerIn {
  name: string
  address: string
  phone_1: string
  phone_2: string | null
  referrer: ReferrerChoice | null
}

export interface Customer {
  id: number
  name: string
  address: string
  phone_1: string
  phone_2: string | null
  photo_url: string | null
  referrer: PersonSummary | null
  referred: PersonSummary[]
  shares_phone_with: PersonSummary[]
}

export interface StandaloneReferrer {
  id: number
  name: string
  address: string
  phone: string
  referred: PersonSummary[]
}

/** Turns a FastAPI error body into one readable line. */
function errorMessage(status: number, body: unknown): string {
  const detail = (body as { detail?: unknown } | null)?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((item: { loc?: unknown[]; msg?: string }) => {
        const field = item.loc?.filter((part) => part !== 'body').join('.')
        return field ? `${field}: ${item.msg}` : item.msg
      })
      .join('; ')
  }
  return `Request failed (${status})`
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // FormData sets its own multipart Content-Type.
  const headers: HeadersInit =
    init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }
  const response = await fetch(`/api${path}`, { headers, ...init })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new Error(errorMessage(response.status, body))
  return body as T
}

const sendJson = (method: string, data: unknown): RequestInit => ({
  method,
  body: JSON.stringify(data),
})

export const api = {
  getDefaultTerms: () => request<DefaultTerms>('/settings/default-terms'),
  updateDefaultTerms: (terms: DefaultTerms) =>
    request<DefaultTerms>('/settings/default-terms', sendJson('PUT', terms)),

  search: (query: string) => request<SearchHit[]>(`/search?q=${encodeURIComponent(query)}`),

  getCustomer: (id: number) => request<Customer>(`/customers/${id}`),
  createCustomer: (customer: CustomerIn) =>
    request<Customer>('/customers', sendJson('POST', customer)),
  updateCustomer: (id: number, customer: CustomerIn) =>
    request<Customer>(`/customers/${id}`, sendJson('PUT', customer)),
  replaceCustomerPhoto: (id: number, photo: Blob) => {
    const form = new FormData()
    form.append('photo', photo, 'photo.jpg')
    return request<Customer>(`/customers/${id}/photo`, { method: 'PUT', body: form })
  },

  getReferrer: (id: number) => request<StandaloneReferrer>(`/referrers/${id}`),
}
