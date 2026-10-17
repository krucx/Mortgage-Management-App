export type InterestMode = 'simple' | 'compounded_yearly' | 'compounded_monthly'
export type PartMonthRule = 'pro_rata' | 'full_month' | 'nothing'

/** A Mortgage's rate, Interest Mode and Part-Month Rule; also the Default Terms in Settings. */
export interface Terms {
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

/** A Customer as listed in the Customers table. */
export interface CustomerRow {
  id: number
  name: string
  address: string
  phone_1: string
  phone_2: string | null
  photo_url: string | null
  referrer: PersonSummary | null
}

export interface CustomerPage {
  items: CustomerRow[]
  total: number
  page: number
  page_size: number
}

export interface Customer extends CustomerRow {
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

export type Purity = 24 | 22 | 20 | 18 | 14
export const PURITIES: Purity[] = [24, 22, 20, 18, 14]

export interface MortgageIn {
  customer_id: number
  name: string | null
  start_date: string // YYYY-MM-DD
  amount_lent: number // paise; the starting Principal
  description: string
  gross_weight_mg: number
  net_weight_mg: number
  purity_karat: Purity
  terms: Terms | null
}

export interface LedgerStep {
  on: string
  event: 'started' | 'interest' | 'part_month' | 'payment' | 'capitalised' | 'forfeited'
  amount: number // paise
  principal: number // running, paise
  unpaid_interest: number // running, paise
  charged_on: number // interest / part_month steps: the Principal at the start of that month
  part_month_days: number // part_month steps: days since the last Accrual Date
  interest_paid: number // payment steps only
  principal_paid: number // payment steps only
  payment_id: number | null
}

export type PaymentMethod = 'cash' | 'upi' | 'bank_transfer'

export const PAYMENT_METHODS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  upi: 'UPI',
  bank_transfer: 'Bank transfer',
}

export interface PaymentIn {
  customer_id: number
  paid_on: string
  amount: number // paise
  method: PaymentMethod
  reference: string | null
  allocations: { mortgage_id: number; amount: number }[]
}

/** A Payment as listed on the Payments page. */
export interface PaymentRow {
  id: number
  paid_on: string
  customer: PersonSummary
  amount: number
  method: PaymentMethod
  reference: string | null
  mortgage_names: string[]
}

export interface PaymentPage {
  items: PaymentRow[]
  total: number
  page: number
  page_size: number
}

export interface Payment {
  id: number
  customer: PersonSummary
  paid_on: string
  amount: number
  method: PaymentMethod
  reference: string | null
  allocations: {
    mortgage_id: number
    mortgage_name: string
    amount: number
    interest_paid: number
    principal_paid: number
  }[]
}

export type MortgageStatus = 'active' | 'redeemed' | 'forfeited'

/** Principal plus unpaid interest on a date, before any Part-Month Rule charge. */
export interface Outstanding {
  principal: number
  unpaid_interest: number
  total: number
}

export interface Mortgage {
  id: number
  name: string
  customer: PersonSummary
  start_date: string
  amount_lent: number
  description: string
  gross_weight_mg: number
  net_weight_mg: number
  purity_karat: Purity
  terms: Terms
  status: MortgageStatus
  photos: { id: number; url: string }[]
  as_of: string
  ledger: LedgerStep[]
  outstanding: Outstanding
  closure: Closure | null
}

/** What it takes to close a Mortgage on a date. */
export interface Redemption {
  on: string
  principal: number
  unpaid_interest: number
  part_month_days: number
  part_month_charge: number
  total: number // the Redemption Amount
}

export interface RedeemIn {
  redeemed_on: string
  method: PaymentMethod // of the final Payment
  reference: string | null
}

export interface ForfeitIn {
  forfeited_on: string
  recovered_amount: number // paise
  note: string
}

/** An Active Mortgage with nothing Outstanding: the jewellery is waiting to go back. */
export interface ReadyToRedeem {
  mortgage: MortgageRow
  redemption: Redemption // redeeming today
}

export interface Closure {
  kind: 'redeemed' | 'forfeited'
  on: string
  redemption_amount: number
  payment_id: number | null
  recovered_amount: number | null
  profit_loss: number | null
  note: string | null
}

export interface MortgageRow {
  id: number
  name: string
  customer: PersonSummary
  start_date: string
  amount_lent: number
  status: MortgageStatus
  outstanding_total: number
}

export interface MortgagePage {
  items: MortgageRow[]
  total: number
  page: number
  page_size: number
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

/** Fired after anything that can change what Mortgages owe (Payments, Redemption, Forfeiture). */
export const LEDGER_CHANGED = 'ledger-changed'

async function changesLedger<T>(result: Promise<T>): Promise<T> {
  const value = await result
  window.dispatchEvent(new Event(LEDGER_CHANGED))
  return value
}

const sendJson = (method: string, data: unknown): RequestInit => ({
  method,
  body: JSON.stringify(data),
})

export const api = {
  getDefaultTerms: () => request<Terms>('/settings/default-terms'),
  updateDefaultTerms: (terms: Terms) =>
    request<Terms>('/settings/default-terms', sendJson('PUT', terms)),

  search: (query: string) => request<SearchHit[]>(`/search?q=${encodeURIComponent(query)}`),

  listCustomers: (page: number, query: string) =>
    request<CustomerPage>(`/customers?page=${page}&q=${encodeURIComponent(query)}`),
  getCustomer: (id: number) => request<Customer>(`/customers/${id}`),
  deleteCustomer: (id: number) => request<null>(`/customers/${id}`, { method: 'DELETE' }),
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
  listMortgages: (
    page: number,
    query: string,
    filters: { customerId?: number; status?: MortgageStatus; asOf?: string; owing?: boolean } = {},
  ) =>
    request<MortgagePage>(
      `/mortgages?page=${page}&q=${encodeURIComponent(query)}` +
        (filters.customerId ? `&customer_id=${filters.customerId}` : '') +
        (filters.status ? `&status=${filters.status}` : '') +
        (filters.asOf ? `&as_of=${filters.asOf}` : '') +
        (filters.owing ? '&owing=true' : ''),
    ),
  getMortgage: (id: number) => request<Mortgage>(`/mortgages/${id}`),
  readyToRedeem: () => request<ReadyToRedeem[]>('/closures/ready-to-redeem'),
  getRedemption: (id: number, on: string) =>
    request<Redemption>(`/mortgages/${id}/redemption?on=${on}`),
  redeem: (id: number, body: RedeemIn) =>
    changesLedger(request<Mortgage>(`/mortgages/${id}/redeem`, sendJson('POST', body))),
  forfeit: (id: number, body: ForfeitIn) =>
    changesLedger(request<Mortgage>(`/mortgages/${id}/forfeit`, sendJson('POST', body))),
  createMortgage: (mortgage: MortgageIn) =>
    request<Mortgage>('/mortgages', sendJson('POST', mortgage)),
  suggestMortgageName: (customerId: number, startDate: string, description: string) =>
    request<{ name: string }>(
      `/mortgages/suggested-name?customer_id=${customerId}&start_date=${startDate}` +
        `&description=${encodeURIComponent(description)}`,
    ),
  addMortgagePhoto: (id: number, photo: Blob) => {
    const form = new FormData()
    form.append('photo', photo, 'photo.jpg')
    return request<Mortgage>(`/mortgages/${id}/photos`, { method: 'POST', body: form })
  },
  deleteMortgagePhoto: (id: number, photoId: number) =>
    request<Mortgage>(`/mortgages/${id}/photos/${photoId}`, { method: 'DELETE' }),

  recordPayment: (payment: PaymentIn) =>
    changesLedger(request<Payment>('/payments', sendJson('POST', payment))),
  getPayment: (id: number) => request<Payment>(`/payments/${id}`),
  listPayments: (page: number, query: string) =>
    request<PaymentPage>(`/payments?page=${page}&q=${encodeURIComponent(query)}`),

  personByPhone: (phone: string) =>
    request<PersonSummary | null>(`/people/by-phone?phone=${encodeURIComponent(phone)}`),
}
