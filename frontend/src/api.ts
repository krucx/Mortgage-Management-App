// Request and response types are generated from the backend's OpenAPI schema into
// api.gen.ts (`npm run gen:types`); this file names them and holds the fetch calls.
import type { components, operations } from './api.gen'
import type { Sort } from './sort'

type Schemas = components['schemas']

/** The columns a list endpoint can sort by. */
type SortOf<Operation extends keyof operations> = NonNullable<
  NonNullable<operations[Operation]['parameters']['query']> extends { sort?: infer S } ? S : never
>
/** Every column of `Sort`, in the order given: one missing or not in the generated
 *  type fails to compile, so a column the backend adds or renames is never missed. */
function columnsOf<Sort extends string>(columns: Record<Sort, true>): readonly Sort[] {
  return Object.keys(columns) as Sort[]
}

export type CustomerSort = SortOf<'list_customers_api_customers_get'>
export const CUSTOMER_SORTS = columnsOf<CustomerSort>({
  name: true,
  phone: true,
  address: true,
  referrer: true,
})
export type MortgageSort = SortOf<'list_mortgages_api_mortgages_get'>
export const MORTGAGE_SORTS = columnsOf<MortgageSort>({
  name: true,
  customer: true,
  started: true,
  lent: true,
  outstanding: true,
  status: true,
})
export type PaymentSort = SortOf<'list_payments_api_payments_get'>
export const PAYMENT_SORTS = columnsOf<PaymentSort>({
  date: true,
  customer: true,
  mortgages: true,
  method: true,
  amount: true,
})
export type NoticeSort = SortOf<'read_notices_api_notices_get'>
export const NOTICE_SORTS = columnsOf<NoticeSort>({
  customer: true,
  accrues: true,
  mortgages: true,
  status: true,
})
export type CallListSort = SortOf<'read_call_list_api_call_list_get'>
export const CALL_LIST_SORTS = columnsOf<CallListSort>({
  customer: true,
  mortgage: true,
  why: true,
  outstanding: true,
})
export type ReadySort = SortOf<'ready_to_redeem_api_closures_ready_to_redeem_get'>
export const READY_SORTS = columnsOf<ReadySort>({ mortgage: true, customer: true, amount: true })

/** A list's sort as query parameters; none for the list's own order. */
function sortQuery(sort: Sort | null | undefined): string {
  if (!sort) return ''
  return `&sort=${sort.column}` + (sort.descending ? '&descending=true' : '')
}

export type InterestMode = Schemas['InterestMode']
export type PartMonthRule = Schemas['PartMonthRule']
/** A Mortgage's rate, Interest Mode and Part-Month Rule; also the Default Terms in Settings. */
export type Terms = Schemas['Terms']

/** A Customer or standalone Referrer, as shown in lists and links. */
export type PersonSummary = Schemas['PersonSummary']
export type SearchHit = Schemas['SearchHit']
export type ReferrerChoice = NonNullable<Schemas['CustomerIn']['referrer']>
export type CustomerIn = Schemas['CustomerIn']
/** A Customer as listed in the Customers table. */
export type CustomerRow = Schemas['CustomerRow']
export type CustomerPage = Schemas['Page_CustomerRow_']
export type Customer = Schemas['Customer']
export type StandaloneReferrer = Schemas['StandaloneReferrer']

export type Purity = Schemas['MortgageIn']['purity_karat']
export const PURITIES: Purity[] = [24, 22, 20, 18, 14]

export type MortgageIn = Schemas['MortgageIn']
export type LedgerStep = Schemas['LedgerStep']

export type PaymentMethod = Schemas['PaymentMethod']
export type PaymentMethodName = Schemas['PaymentMethodName']
export type PaymentIn = Schemas['PaymentIn']
/** A Payment as listed on the Payments page. */
export type PaymentRow = Schemas['PaymentRow']
export type PaymentPage = Schemas['PaymentPage']
export type Payment = Schemas['Payment']

export type MortgageStatus = Schemas['MortgageStatus']
/** Principal plus unpaid interest on a date, before any Part-Month Rule charge. */
export type Outstanding = Schemas['Outstanding']
export type Mortgage = Schemas['Mortgage']
/** New Terms from an Accrual Date on. */
export type TermChange = Schemas['TermChangeOut']
export type MortgageRow = Schemas['MortgageRow']
export type MortgagePage = Schemas['Page_MortgageRow_']

export type ProjectedPoint = Schemas['ProjectedPoint']
/** A Term Change in the coming year. */
export type ComingTermChange = Schemas['ComingTermChange']
export type ProjectedSeries = Schemas['ProjectedSeries']
export type Projection = Schemas['Projection']

/** A Ledger step that a change would alter: null on the side where it doesn't exist. */
export type LedgerChange = Schemas['LedgerChange']
export type PreviewSide = Schemas['PreviewSide']
/** One Mortgage before and after a change that has not been saved. */
export type MortgagePreview = Schemas['MortgagePreview']
export type NewMortgagePreview = Schemas['NewMortgagePreview']
export type CollateralPreview = Schemas['CollateralPreview']
/** What a Term Change says; anything left out carries over. */
export type TermChangeIn = Schemas['TermChangeIn']
/** The details of a Mortgage that can be corrected (not its Customer or Terms). */
export type MortgageEdit = Schemas['MortgageEdit']

/** Collateral Value: net weight at the Gold Rate, unless set by hand. */
export type Collateral = Schemas['Collateral']
export type GoldRate = Schemas['GoldRate']
export type BackupStatus = Schemas['BackupStatus']

/** One change in the History; edits have one entry per changed field. */
export type AuditEntry = Schemas['AuditEntry']
export type AuditAction = AuditEntry['action']

export type CallListSettings = Schemas['CallListSettings']
export type CallNote = Schemas['CallNote']
export type CallListRow = Schemas['CallListRow']
export type CallReason = CallListRow['reasons'][number]
/** One Customer's Mortgages on the Call List. */
export type CallListGroup = Schemas['CallListGroup']
export type CallListPage = Schemas['CallListPage']

/** What it takes to close a Mortgage on a date. */
export type Redemption = Schemas['Redemption']
export type RedeemIn = Schemas['RedeemIn']
export type ForfeitIn = Schemas['ForfeitIn']
/** An Active Mortgage with nothing Outstanding: the jewellery is waiting to go back. */
export type ReadyToRedeem = Schemas['ReadyToRedeem']
export type ReadyToRedeemPage = Schemas['Page_ReadyToRedeem_']
export type Closure = Schemas['Closure']

/** The whole lending book at a glance. */
export type Dashboard = Schemas['Dashboard']
export type MonthlyPayments = Schemas['MonthlyPayments']
export type ProjectionHorizon = Schemas['ProjectionHorizon']
export type ComingMonth = Schemas['ComingMonth']
export type Receipt = Schemas['Receipt']
export type Notice = Schemas['Notice']
export type NoticePage = Schemas['Page_Notice_']
export type NoticeStatus = Notice['status']
export type MessageSettings = Schemas['MessageSettings']
export type MessagePlaceholders = Schemas['MessagePlaceholders']

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

  getDashboard: () => request<Dashboard>('/dashboard'),

  getPaymentMethods: () => request<PaymentMethodName[]>('/payment-methods'),

  getReceipt: (paymentId: number) => request<Receipt>(`/payments/${paymentId}/receipt`),
  getMessageSettings: () => request<MessageSettings>('/settings/messages'),
  getMessagePlaceholders: () =>
    request<MessagePlaceholders>('/settings/messages/placeholders'),
  updateMessageSettings: (settings: MessageSettings) =>
    request<MessageSettings>('/settings/messages', sendJson('PUT', settings)),
  listNotices: (page: number, status?: NoticeStatus, sort?: Sort<NoticeSort> | null) =>
    request<NoticePage>(
      `/notices?page=${page}${status ? `&status=${status}` : ''}` + sortQuery(sort),
    ),
  approveNotice: (id: number) => request<Notice>(`/notices/${id}/approve`, { method: 'POST' }),
  skipNotice: (id: number) => request<Notice>(`/notices/${id}/skip`, { method: 'POST' }),
  markNoticeSent: (id: number) => request<Notice>(`/notices/${id}/sent`, { method: 'POST' }),

  getCallList: (page: number, sort?: Sort<CallListSort> | null) =>
    request<CallListPage>(`/call-list?page=${page}` + sortQuery(sort)),
  listCallNotes: (mortgageId: number) => request<CallNote[]>(`/mortgages/${mortgageId}/call-notes`),
  addCallNote: (mortgageId: number, note: string) =>
    request<CallNote>(`/mortgages/${mortgageId}/call-notes`, sendJson('POST', { note })),

  search: (query: string) => request<SearchHit[]>(`/search?q=${encodeURIComponent(query)}`),

  listCustomers: (
    page: number,
    query: string,
    filters: { hasActiveMortgage?: boolean; sort?: Sort<CustomerSort> | null } = {},
  ) =>
    request<CustomerPage>(
      `/customers?page=${page}&q=${encodeURIComponent(query)}` +
        (filters.hasActiveMortgage ? '&has_active_mortgage=true' : '') +
        sortQuery(filters.sort),
    ),
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
    filters: {
      customerId?: number
      status?: MortgageStatus
      asOf?: string
      owing?: boolean
      /** False: every match on one page, for pickers, which must never leave one out. */
      paged?: boolean
      closedIn?: string // YYYY-MM
      /** Only the Redeemed and Forfeited. */
      closed?: boolean
      sort?: Sort<MortgageSort> | null
    } = {},
  ) =>
    request<MortgagePage>(
      `/mortgages?page=${page}&q=${encodeURIComponent(query)}` +
        (filters.customerId ? `&customer_id=${filters.customerId}` : '') +
        (filters.status ? `&status=${filters.status}` : '') +
        (filters.asOf ? `&as_of=${filters.asOf}` : '') +
        (filters.owing ? '&owing=true' : '') +
        (filters.paged === false ? '&paged=false' : '') +
        (filters.closedIn ? `&closed_in=${filters.closedIn}` : '') +
        (filters.closed ? '&closed=true' : '') +
        sortQuery(filters.sort),
    ),
  getMortgage: (id: number) => request<Mortgage>(`/mortgages/${id}`),
  readyToRedeem: (page: number, sort?: Sort<ReadySort> | null) =>
    request<ReadyToRedeemPage>(`/closures/ready-to-redeem?page=${page}` + sortQuery(sort)),
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
  previewNewMortgage: (mortgage: MortgageIn) =>
    request<NewMortgagePreview>('/mortgages/preview', sendJson('POST', mortgage)),
  previewCollateral: (id: number, value: number | null) =>
    request<CollateralPreview>(
      `/mortgages/${id}/collateral-preview`,
      sendJson('POST', { value }),
    ),
  previewEdit: (id: number, mortgage: MortgageEdit) =>
    request<MortgagePreview[]>(`/mortgages/${id}/edit-preview`, sendJson('POST', mortgage)),
  previewTermChange: (id: number, change: TermChangeIn) =>
    request<MortgagePreview[]>(`/mortgages/${id}/term-changes/preview`, sendJson('POST', change)),
  previewVoid: (paymentId: number) =>
    request<MortgagePreview[]>(`/payments/${paymentId}/void-preview`, { method: 'POST' }),
  previewPayment: (payment: PaymentIn) =>
    request<MortgagePreview[]>('/payments/preview', sendJson('POST', payment)),
  previewRedeem: (id: number, body: RedeemIn) =>
    request<MortgagePreview[]>(`/mortgages/${id}/redeem-preview`, sendJson('POST', body)),
  previewForfeit: (id: number, body: ForfeitIn) =>
    request<MortgagePreview[]>(`/mortgages/${id}/forfeit-preview`, sendJson('POST', body)),
  previewReopen: (id: number) =>
    request<MortgagePreview[]>(`/mortgages/${id}/reopen-preview`, { method: 'POST' }),
  previewTermChangeRemoval: (id: number, changeId: number) =>
    request<MortgagePreview[]>(`/mortgages/${id}/term-changes/${changeId}/remove-preview`, {
      method: 'POST',
    }),
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
  listPayments: (
    page: number,
    query: string,
    filters: {
      month?: string
      year?: string
      includeVoided?: boolean
      sort?: Sort<PaymentSort> | null
    } = {},
  ) =>
    request<PaymentPage>(
      `/payments?page=${page}&q=${encodeURIComponent(query)}` +
        (filters.month ? `&month=${filters.month}` : '') +
        (filters.year ? `&year=${filters.year}` : '') +
        (filters.includeVoided === false ? '&include_voided=false' : '') +
        sortQuery(filters.sort),
    ),

  personByPhone: (phone: string) =>
    request<PersonSummary | null>(`/people/by-phone?phone=${encodeURIComponent(phone)}`),
}
