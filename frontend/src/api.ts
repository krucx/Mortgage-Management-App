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
  event:
    | 'started'
    | 'interest'
    | 'part_month'
    | 'payment'
    | 'capitalised'
    | 'forfeited'
    | 'term_changed'
  amount: number // paise
  principal: number // running, paise
  unpaid_interest: number // running, paise
  charged_on: number // interest / part_month steps: the Principal at the start of that month
  part_month_days: number // part_month steps: days since the last Accrual Date
  interest_paid: number // payment steps only
  principal_paid: number // payment steps only
  payment_id: number | null
  terms: Terms | null // term_changed steps: the Terms from then on
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
  mortgages: { id: number; name: string }[] // in the order the Allocations were made
  voided: boolean
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
    interest_paid: number | null // null once Voided
    principal_paid: number | null
  }[]
  voided_at: string | null
  void_reason: string | null
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
  terms: Terms // in force today
  term_changes: TermChange[]
  upcoming_accrual_dates: string[] // when a Term Change could start
  status: MortgageStatus
  photos: { id: number; url: string }[]
  as_of: string
  ledger: LedgerStep[]
  outstanding: Outstanding
  collateral: Collateral | null // null until a Gold Rate or manual value is set
  closure: Closure | null
}

/** New Terms from an Accrual Date on. */
export interface TermChange {
  id: number
  effective_on: string
  terms: Terms
  removable: boolean // until it takes effect
}

export interface ProjectedPoint {
  months: number
  on: string
  principal: number
  unpaid_interest: number
  redemption_amount: number
  loan_to_value: number | null
}

export interface ProjectedSeries {
  points: ProjectedPoint[] // today, then each month for a year
  paid_off_on: string | null
}

export interface Projection {
  as_of: string
  collateral_value: number | null
  monthly_payment: number | null
  baseline: ProjectedSeries
  what_if: ProjectedSeries | null
}

/** A Ledger step that an edit would change: null on the side where it doesn't exist. */
export interface LedgerChange {
  on: string
  event: LedgerStep['event']
  before: LedgerStep | null
  after: LedgerStep | null
}

export interface PreviewSide {
  outstanding: number // today
  points: ProjectedPoint[] // with no further Payments; empty for a closed Mortgage
}

/** One Mortgage before and after a change that has not been saved. */
export interface MortgagePreview {
  mortgage_id: number
  mortgage_name: string
  before: PreviewSide
  after: PreviewSide
  ledger_changes: LedgerChange[]
}

/** What a Term Change says; anything left out carries over. */
export interface TermChangeIn {
  effective_on: string
  monthly_rate_bps?: number
  interest_mode?: InterestMode
  part_month_rule?: PartMonthRule
}

/** Collateral Value: net weight at the Gold Rate, unless set by hand. */
export interface Collateral {
  value: number // paise
  source: 'gold_rate' | 'manual'
  set_on: string
  loan_to_value: number // Outstanding ÷ Collateral Value
}

export interface GoldRate {
  purity_karat: Purity
  rate_per_gram: number | null // paise
  updated_on: string | null
}

export interface BackupStatus {
  enabled: boolean
  encrypted: boolean // false when no BACKUP_PASSWORD is set
  running: boolean
  last_backup_at: string | null
  last_backup_file: string | null
  last_error: string | null
  keep: number
}

/** The details of a Mortgage that can be corrected (not its Customer or Terms). */
export interface MortgageEdit {
  name: string
  start_date: string
  amount_lent: number // paise
  description: string
  gross_weight_mg: number
  net_weight_mg: number
  purity_karat: Purity
}

export type AuditAction =
  | 'created'
  | 'edited'
  | 'deleted'
  | 'voided'
  | 'redeemed'
  | 'forfeited'
  | 'reopened'
  | 'photo_added'
  | 'photo_removed'
  | 'term_change_added'
  | 'term_change_removed'

/** One change in the audit log; edits have one entry per changed field. */
export interface AuditEntry {
  id: number
  at: string
  entity: 'customer' | 'mortgage' | 'payment'
  entity_id: number
  action: AuditAction
  field: string | null
  old_value: string | null
  new_value: string | null
  note: string | null
  mortgage_name: string | null // for a Mortgage's entries
}

export interface CallListSettings {
  months_unpaid: number
  loan_to_value_pct: number
}

export interface CallNote {
  id: number
  called_on: string
  note: string
  created_at: string
}

export type CallReason = 'months_unpaid' | 'loan_to_value' | 'accrues_today'

export interface CallListRow {
  mortgage_id: number
  mortgage_name: string
  reasons: CallReason[]
  months_unpaid: number
  loan_to_value: number | null
  outstanding: number
  called: CallNote | null // today's latest Call Note
}

/** One Customer's Mortgages on the Call List. */
export interface CallListGroup {
  customer: PersonSummary
  phone_1: string
  phone_2: string | null
  rows: CallListRow[]
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

/** Fired after anything that can change what Mortgages owe (Payments, Voids, edits, closing). */
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

  getGoldRates: () => request<GoldRate[]>('/settings/gold-rates'),
  updateGoldRates: (rates: { purity_karat: Purity; rate_per_gram: number }[]) =>
    request<GoldRate[]>('/settings/gold-rates', sendJson('PUT', rates)),
  getCallListSettings: () => request<CallListSettings>('/settings/call-list'),
  updateCallListSettings: (settings: CallListSettings) =>
    request<CallListSettings>('/settings/call-list', sendJson('PUT', settings)),

  getBackupStatus: () => request<BackupStatus>('/backups'),
  backUpNow: () => request<BackupStatus>('/backups', { method: 'POST' }),
  updateBackupSettings: (keep: number) =>
    request<BackupStatus>('/settings/backups', sendJson('PUT', { keep })),

  getCallList: () => request<CallListGroup[]>('/call-list'),
  listCallNotes: (mortgageId: number) => request<CallNote[]>(`/mortgages/${mortgageId}/call-notes`),
  addCallNote: (mortgageId: number, note: string) =>
    request<CallNote>(`/mortgages/${mortgageId}/call-notes`, sendJson('POST', { note })),

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
  editMortgage: (id: number, mortgage: MortgageEdit) =>
    changesLedger(request<Mortgage>(`/mortgages/${id}`, sendJson('PUT', mortgage))),
  reopenMortgage: (id: number, reason: string) =>
    changesLedger(request<Mortgage>(`/mortgages/${id}/reopen`, sendJson('POST', { reason }))),
  mortgageHistory: (id: number) => request<AuditEntry[]>(`/mortgages/${id}/history`),
  customerHistory: (id: number) => request<AuditEntry[]>(`/customers/${id}/history`),
  previewEdit: (id: number, mortgage: MortgageEdit) =>
    request<MortgagePreview[]>(`/mortgages/${id}/edit-preview`, sendJson('POST', mortgage)),
  previewTermChange: (id: number, change: TermChangeIn) =>
    request<MortgagePreview[]>(`/mortgages/${id}/term-changes/preview`, sendJson('POST', change)),
  previewVoid: (paymentId: number) =>
    request<MortgagePreview[]>(`/payments/${paymentId}/void-preview`, { method: 'POST' }),
  addTermChange: (id: number, change: TermChangeIn) =>
    changesLedger(request<Mortgage>(`/mortgages/${id}/term-changes`, sendJson('POST', change))),
  removeTermChange: (id: number, changeId: number) =>
    changesLedger(
      request<Mortgage>(`/mortgages/${id}/term-changes/${changeId}`, { method: 'DELETE' }),
    ),
  getProjection: (id: number, monthlyPayment: number | null) =>
    request<Projection>(
      `/mortgages/${id}/projection` + (monthlyPayment ? `?monthly_payment=${monthlyPayment}` : ''),
    ),
  setCollateral: (id: number, value: number | null) =>
    request<Mortgage>(`/mortgages/${id}/collateral`, sendJson('PUT', { value })),

  recordPayment: (payment: PaymentIn) =>
    changesLedger(request<Payment>('/payments', sendJson('POST', payment))),
  getPayment: (id: number) => request<Payment>(`/payments/${id}`),
  voidPayment: (id: number, reason: string) =>
    changesLedger(request<Payment>(`/payments/${id}/void`, sendJson('POST', { reason }))),
  listPayments: (page: number, query: string) =>
    request<PaymentPage>(`/payments?page=${page}&q=${encodeURIComponent(query)}`),

  personByPhone: (phone: string) =>
    request<PersonSummary | null>(`/people/by-phone?phone=${encodeURIComponent(phone)}`),
}
