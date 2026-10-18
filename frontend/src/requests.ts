// What the frontend asks the backend, by name: what it reads (with its place in the
// cache), the Previews of unsaved changes, and the changes themselves. Each goes
// through the typed client, so a path, parameter or body the backend doesn't take
// fails to compile.
import { queryOptions } from '@tanstack/react-query'
import type {
  CallListSettings,
  CallListSort,
  CollateralPreview,
  CustomerIn,
  CustomerSort,
  ForfeitIn,
  MortgageEdit,
  MortgageIn,
  MessageSettings,
  MortgagePreview,
  MortgageSort,
  MortgageStatus,
  NewMortgagePreview,
  NoticeStatus,
  NoticeSort,
  PaymentIn,
  PaymentSort,
  ReadySort,
  RedeemIn,
  Purity,
  TermChangeIn,
  Terms,
} from './api'
import { dataOrThrow, keys, type ApiClient } from './serverState'
import type { Sort } from './sort'

const mortgagePath = (id: number) => ({ path: { mortgage_id: id } })
const paymentPath = (id: number) => ({ path: { payment_id: id } })

/** A Mortgage as it stands today: its Ledger, Outstanding, Collateral and photos. */
export function mortgageQuery(client: ApiClient, id: number) {
  return queryOptions({
    queryKey: keys.mortgage(id),
    queryFn: () =>
      dataOrThrow(client.GET('/api/mortgages/{mortgage_id}', { params: mortgagePath(id) })),
  })
}

/** What it takes to close a Mortgage on a date (quoted, so also a future one). */
export function redemptionQuery(client: ApiClient, id: number, on: string) {
  return queryOptions({
    queryKey: [...keys.redemptions, id, on],
    queryFn: () =>
      dataOrThrow(
        client.GET('/api/mortgages/{mortgage_id}/redemption', {
          params: { ...mortgagePath(id), query: { on } },
        }),
      ),
  })
}

/** Keep a photo of a Mortgage's jewellery; the Mortgage with it. */
export function addMortgagePhoto(client: ApiClient, id: number, photo: Blob) {
  return dataOrThrow(
    client.POST('/api/mortgages/{mortgage_id}/photos', {
      params: mortgagePath(id),
      // The schema types the file as a string; it is sent as multipart form data.
      body: { photo: '' },
      bodySerializer: () => photoForm(photo),
    }),
  )
}

/** A Preview of an unsaved change: which change it is, and how to ask for it. */
export interface PreviewRequest<T = MortgagePreview[]> {
  key: readonly unknown[]
  load: (client: ApiClient) => Promise<T>
}

/** The Preview of each change: what it would do, made and rolled back by the backend. */
export const previews = {
  edit: (id: number, edit: MortgageEdit): PreviewRequest => ({
    key: ['edit', id, edit],
    load: (client) =>
      dataOrThrow(
        client.POST('/api/mortgages/{mortgage_id}/edit-preview', {
          params: mortgagePath(id),
          body: edit,
        }),
      ),
  }),
  termChange: (id: number, change: TermChangeIn): PreviewRequest => ({
    key: ['term-change', id, change],
    load: (client) =>
      dataOrThrow(
        client.POST('/api/mortgages/{mortgage_id}/term-changes/preview', {
          params: mortgagePath(id),
          body: change,
        }),
      ),
  }),
  termChangeRemoval: (id: number, changeId: number): PreviewRequest => ({
    key: ['term-change-removal', id, changeId],
    load: (client) =>
      dataOrThrow(
        client.POST('/api/mortgages/{mortgage_id}/term-changes/{change_id}/remove-preview', {
          params: { path: { mortgage_id: id, change_id: changeId } },
        }),
      ),
  }),
  payment: (payment: PaymentIn): PreviewRequest => ({
    key: ['payment', payment],
    load: (client) => dataOrThrow(client.POST('/api/payments/preview', { body: payment })),
  }),
  void: (paymentId: number): PreviewRequest => ({
    key: ['void', paymentId],
    load: (client) =>
      dataOrThrow(
        client.POST('/api/payments/{payment_id}/void-preview', { params: paymentPath(paymentId) }),
      ),
  }),
  redeem: (id: number, redeem: RedeemIn): PreviewRequest => ({
    key: ['redeem', id, redeem],
    load: (client) =>
      dataOrThrow(
        client.POST('/api/mortgages/{mortgage_id}/redeem-preview', {
          params: mortgagePath(id),
          body: redeem,
        }),
      ),
  }),
  forfeit: (id: number, forfeit: ForfeitIn): PreviewRequest => ({
    key: ['forfeit', id, forfeit],
    load: (client) =>
      dataOrThrow(
        client.POST('/api/mortgages/{mortgage_id}/forfeit-preview', {
          params: mortgagePath(id),
          body: forfeit,
        }),
      ),
  }),
  reopen: (id: number): PreviewRequest => ({
    key: ['reopen', id],
    load: (client) =>
      dataOrThrow(
        client.POST('/api/mortgages/{mortgage_id}/reopen-preview', { params: mortgagePath(id) }),
      ),
  }),
  newMortgage: (mortgage: MortgageIn): PreviewRequest<NewMortgagePreview> => ({
    key: ['new-mortgage', mortgage],
    load: (client) => dataOrThrow(client.POST('/api/mortgages/preview', { body: mortgage })),
  }),
  collateral: (id: number, value: number | null): PreviewRequest<CollateralPreview> => ({
    key: ['collateral', id, value],
    load: (client) =>
      dataOrThrow(
        client.POST('/api/mortgages/{mortgage_id}/collateral-preview', {
          params: mortgagePath(id),
          body: { value },
        }),
      ),
  }),
}

/** Each change that can alter what Mortgages owe; save them through useLedgerChange. */
export const changes = {
  edit: (client: ApiClient, id: number, edit: MortgageEdit) =>
    dataOrThrow(client.PUT('/api/mortgages/{mortgage_id}', { params: mortgagePath(id), body: edit })),
  addTermChange: (client: ApiClient, id: number, change: TermChangeIn) =>
    dataOrThrow(
      client.POST('/api/mortgages/{mortgage_id}/term-changes', {
        params: mortgagePath(id),
        body: change,
      }),
    ),
  removeTermChange: (client: ApiClient, id: number, changeId: number) =>
    dataOrThrow(
      client.DELETE('/api/mortgages/{mortgage_id}/term-changes/{change_id}', {
        params: { path: { mortgage_id: id, change_id: changeId } },
      }),
    ),
  recordPayment: (client: ApiClient, payment: PaymentIn) =>
    dataOrThrow(client.POST('/api/payments', { body: payment })),
  voidPayment: (client: ApiClient, paymentId: number, reason: string) =>
    dataOrThrow(
      client.POST('/api/payments/{payment_id}/void', {
        params: paymentPath(paymentId),
        body: { reason },
      }),
    ),
  redeem: (client: ApiClient, id: number, redeem: RedeemIn) =>
    dataOrThrow(
      client.POST('/api/mortgages/{mortgage_id}/redeem', { params: mortgagePath(id), body: redeem }),
    ),
  forfeit: (client: ApiClient, id: number, forfeit: ForfeitIn) =>
    dataOrThrow(
      client.POST('/api/mortgages/{mortgage_id}/forfeit', {
        params: mortgagePath(id),
        body: forfeit,
      }),
    ),
  reopen: (client: ApiClient, id: number, reason: string) =>
    dataOrThrow(
      client.POST('/api/mortgages/{mortgage_id}/reopen', {
        params: mortgagePath(id),
        body: { reason },
      }),
    ),
  setCollateral: (client: ApiClient, id: number, value: number | null) =>
    dataOrThrow(
      client.PUT('/api/mortgages/{mortgage_id}/collateral', {
        params: mortgagePath(id),
        body: { value },
      }),
    ),
}

/** A list read a page at a time and sorted on the server: which list (with its
 *  filters), and how to ask for one page of it in one order. */
export interface ListRequest<Column extends string, Listed> {
  key: readonly unknown[]
  load: (client: ApiClient, page: number, sort: Sort<Column> | null) => Promise<Listed>
}

/** A sort as query parameters; none for the list's own order. */
const sortQuery = <Column extends string>(sort: Sort<Column> | null) =>
  sort ? { sort: sort.column, ...(sort.descending ? { descending: true } : {}) } : {}

/** Every list, by name, with the filters it can be narrowed by. */
export const lists = {
  customers: (filters: { query: string; hasActiveMortgage: boolean }) =>
    ({
      key: ['customers', filters],
      load: (client, page, sort) =>
        dataOrThrow(
          client.GET('/api/customers', {
            params: {
              query: {
                page,
                q: filters.query,
                ...(filters.hasActiveMortgage ? { has_active_mortgage: true } : {}),
                ...sortQuery(sort),
              },
            },
          }),
        ),
    }) satisfies ListRequest<CustomerSort, unknown>,
  mortgages: (filters: {
    query?: string
    customerId?: number
    status?: MortgageStatus
    owing?: boolean
    /** Only the Redeemed and Forfeited. */
    closed?: boolean
    /** Closed in that month (YYYY-MM). */
    closedIn?: string
  }) =>
    ({
      key: ['mortgages', filters],
      load: (client, page, sort) =>
        dataOrThrow(
          client.GET('/api/mortgages', {
            params: {
              query: {
                page,
                q: filters.query ?? '',
                customer_id: filters.customerId,
                status: filters.status,
                ...(filters.owing ? { owing: true } : {}),
                ...(filters.closed ? { closed: true } : {}),
                closed_in: filters.closedIn,
                ...sortQuery(sort),
              },
            },
          }),
        ),
    }) satisfies ListRequest<MortgageSort, unknown>,
  payments: (filters: {
    query: string
    month?: string
    year?: string
    includeVoided: boolean
  }) =>
    ({
      key: ['payments', filters],
      load: (client, page, sort) =>
        dataOrThrow(
          client.GET('/api/payments', {
            params: {
              query: {
                page,
                q: filters.query,
                month: filters.month,
                year: filters.year ? Number(filters.year) : undefined,
                ...(filters.includeVoided ? {} : { include_voided: false }),
                ...sortQuery(sort),
              },
            },
          }),
        ),
    }) satisfies ListRequest<PaymentSort, unknown>,
  notices: (status?: NoticeStatus) =>
    ({
      key: ['notices', { status }],
      load: (client, page, sort) =>
        dataOrThrow(client.GET('/api/notices', { params: { query: { page, status, ...sortQuery(sort) } } })),
    }) satisfies ListRequest<NoticeSort, unknown>,
  callList: () =>
    ({
      key: ['call-list'],
      load: (client, page, sort) =>
        dataOrThrow(client.GET('/api/call-list', { params: { query: { page, ...sortQuery(sort) } } })),
    }) satisfies ListRequest<CallListSort, unknown>,
  readyToRedeem: () =>
    ({
      key: ['ready-to-redeem'],
      load: (client, page, sort) =>
        dataOrThrow(
          client.GET('/api/closures/ready-to-redeem', {
            params: { query: { page, ...sortQuery(sort) } },
          }),
        ),
    }) satisfies ListRequest<ReadySort, unknown>,
}

/** What the Lender does with a queued Notice. */
export const noticeActions = {
  approve: (client: ApiClient, id: number) =>
    dataOrThrow(client.POST('/api/notices/{notice_id}/approve', { params: { path: { notice_id: id } } })),
  skip: (client: ApiClient, id: number) =>
    dataOrThrow(client.POST('/api/notices/{notice_id}/skip', { params: { path: { notice_id: id } } })),
  markSent: (client: ApiClient, id: number) =>
    dataOrThrow(client.POST('/api/notices/{notice_id}/sent', { params: { path: { notice_id: id } } })),
}

/** Delete a Customer (refused while they have Mortgages). */
export const deleteCustomer = (client: ApiClient, id: number) =>
  dataOrThrow(client.DELETE('/api/customers/{customer_id}', { params: { path: { customer_id: id } } }))

/** A settings group: read once, then known from what saving it returns. */
function settingsQuery<T>(name: string, load: () => Promise<T>) {
  return queryOptions({ queryKey: [...keys.settings, name], queryFn: load, staleTime: Infinity })
}

/** Each settings group, and saving it. */
export const settings = {
  defaultTerms: (client: ApiClient) =>
    settingsQuery('default-terms', () => dataOrThrow(client.GET('/api/settings/default-terms'))),
  saveDefaultTerms: (client: ApiClient, terms: Terms) =>
    dataOrThrow(client.PUT('/api/settings/default-terms', { body: terms })),
  goldRates: (client: ApiClient) =>
    settingsQuery('gold-rates', () => dataOrThrow(client.GET('/api/settings/gold-rates'))),
  saveGoldRates: (
    client: ApiClient,
    rates: { purity_karat: Purity; rate_per_gram: number }[],
  ) => dataOrThrow(client.PUT('/api/settings/gold-rates', { body: rates })),
  callList: (client: ApiClient) =>
    settingsQuery('call-list', () => dataOrThrow(client.GET('/api/settings/call-list'))),
  saveCallList: (client: ApiClient, thresholds: CallListSettings) =>
    dataOrThrow(client.PUT('/api/settings/call-list', { body: thresholds })),
  messages: (client: ApiClient) =>
    settingsQuery('messages', () => dataOrThrow(client.GET('/api/settings/messages'))),
  saveMessages: (client: ApiClient, messages: MessageSettings) =>
    dataOrThrow(client.PUT('/api/settings/messages', { body: messages })),
  placeholders: (client: ApiClient) =>
    settingsQuery('placeholders', () =>
      dataOrThrow(client.GET('/api/settings/messages/placeholders')),
    ),
  saveBackups: (client: ApiClient, keep: number) =>
    dataOrThrow(client.PUT('/api/settings/backups', { body: { keep } })),
}

/** The Backups: when the last was taken, whether one is running, how many are kept. */
export function backupsQuery(client: ApiClient) {
  return queryOptions({
    queryKey: keys.backups,
    queryFn: () => dataOrThrow(client.GET('/api/backups')),
    // While a Backup runs in the background, check on it every second.
    refetchInterval: (query) => (query.state.data?.running ? 1000 : false),
  })
}

export const backUpNow = (client: ApiClient) => dataOrThrow(client.POST('/api/backups'))

/** The whole lending book at a glance. */
export function dashboardQuery(client: ApiClient) {
  return queryOptions({
    queryKey: keys.dashboard,
    queryFn: () => dataOrThrow(client.GET('/api/dashboard')),
  })
}

/** A Mortgage's History, newest first. */
export function mortgageHistoryQuery(client: ApiClient, id: number) {
  return queryOptions({
    queryKey: keys.mortgageHistory(id),
    queryFn: () =>
      dataOrThrow(client.GET('/api/mortgages/{mortgage_id}/history', { params: mortgagePath(id) })),
  })
}

/** A Customer's History (and their Mortgages'), newest first. */
export function customerHistoryQuery(client: ApiClient, id: number) {
  return queryOptions({
    queryKey: [...keys.customer(id), 'history'],
    queryFn: () =>
      dataOrThrow(
        client.GET('/api/customers/{customer_id}/history', {
          params: { path: { customer_id: id } },
        }),
      ),
  })
}

/** Where an Active Mortgage is heading with no more Payments, and with `monthlyPayment`. */
export function projectionQuery(client: ApiClient, id: number, monthlyPayment: number | null) {
  return queryOptions({
    queryKey: [...keys.mortgage(id), 'projection', monthlyPayment],
    queryFn: () =>
      dataOrThrow(
        client.GET('/api/mortgages/{mortgage_id}/projection', {
          params: {
            ...mortgagePath(id),
            query: monthlyPayment ? { monthly_payment: monthlyPayment } : {},
          },
        }),
      ),
  })
}

/** A Mortgage's Call Notes, newest first. */
export function callNotesQuery(client: ApiClient, mortgageId: number) {
  return queryOptions({
    queryKey: keys.callNotes(mortgageId),
    queryFn: () =>
      dataOrThrow(
        client.GET('/api/mortgages/{mortgage_id}/call-notes', { params: mortgagePath(mortgageId) }),
      ),
  })
}

/** Note that the Customer was phoned about a Mortgage today. */
export const addCallNote = (client: ApiClient, mortgageId: number, note: string) =>
  dataOrThrow(
    client.POST('/api/mortgages/{mortgage_id}/call-notes', {
      params: mortgagePath(mortgageId),
      body: { note },
    }),
  )

/** A Customer, with whom they referred and who shares their numbers. */
export function customerQuery(client: ApiClient, id: number) {
  return queryOptions({
    queryKey: keys.customer(id),
    queryFn: () =>
      dataOrThrow(client.GET('/api/customers/{customer_id}', { params: { path: { customer_id: id } } })),
  })
}

/** A Standalone Referrer, with the Customers they referred. */
export function referrerQuery(client: ApiClient, id: number) {
  return queryOptions({
    // Under the Customers, so saving a Customer they referred makes it stale.
    queryKey: [...keys.allCustomers, 'referrer', id],
    queryFn: () =>
      dataOrThrow(client.GET('/api/referrers/{referrer_id}', { params: { path: { referrer_id: id } } })),
  })
}

/** Customers and Referrers matching a name or phone. */
export function searchQuery(client: ApiClient, query: string) {
  return queryOptions({
    queryKey: [...keys.allCustomers, 'search', query],
    queryFn: () => dataOrThrow(client.GET('/api/search', { params: { query: { q: query } } })),
  })
}

/** Who a Primary Number belongs to, if anyone. */
export function numberOwnerQuery(client: ApiClient, phone: string) {
  return queryOptions({
    queryKey: [...keys.allCustomers, 'number-owner', phone],
    queryFn: () =>
      dataOrThrow(client.GET('/api/people/by-phone', { params: { query: { phone } } })),
  })
}

/** Saving a Customer: new (no id) or edited; their photo is replaced separately. */
export const customerChanges = {
  save: (client: ApiClient, customer: CustomerIn, id?: number) =>
    dataOrThrow(
      id === undefined
        ? client.POST('/api/customers', { body: customer })
        : client.PUT('/api/customers/{customer_id}', {
            params: { path: { customer_id: id } },
            body: customer,
          }),
    ),
  replacePhoto: (client: ApiClient, id: number, photo: Blob) =>
    dataOrThrow(
      client.PUT('/api/customers/{customer_id}/photo', {
        params: { path: { customer_id: id } },
        // The schema types the file as a string; it is sent as multipart form data.
        body: { photo: '' },
        bodySerializer: () => photoForm(photo),
      }),
    ),
}

/** A photo as the multipart form the backend takes. */
function photoForm(photo: Blob): FormData {
  const form = new FormData()
  form.append('photo', photo, 'photo.jpg')
  return form
}

/** Every one of a Customer's Mortgages that match, on one page, for choosing from: a
 *  picker must never leave one out. With `asOf`, Outstanding is worked out on that date. */
export function everyMortgageQuery(
  client: ApiClient,
  filters: { customerId: number; status?: MortgageStatus; asOf?: string },
) {
  return queryOptions({
    queryKey: [...keys.list('mortgages'), 'every', filters],
    queryFn: () =>
      dataOrThrow(
        client.GET('/api/mortgages', {
          params: {
            query: {
              page: 1,
              customer_id: filters.customerId,
              status: filters.status,
              as_of: filters.asOf,
              paged: false,
            },
          },
        }),
      ),
  })
}

/** The Mortgage Name the backend would give a new Mortgage. */
export function suggestedNameQuery(
  client: ApiClient,
  asked: { customerId: number; startDate: string; description: string },
) {
  return queryOptions({
    queryKey: ['suggested-name', asked],
    queryFn: () =>
      dataOrThrow(
        client.GET('/api/mortgages/suggested-name', {
          params: {
            query: {
              customer_id: asked.customerId,
              start_date: asked.startDate,
              description: asked.description,
            },
          },
        }),
      ),
  })
}

/** Lend against a packet of jewellery; the new Mortgage. */
export const createMortgage = (client: ApiClient, mortgage: MortgageIn) =>
  dataOrThrow(client.POST('/api/mortgages', { body: mortgage }))

/** A Payment and how it was applied to each Mortgage. */
export function paymentQuery(client: ApiClient, id: number) {
  return queryOptions({
    queryKey: keys.payment(id),
    queryFn: () => dataOrThrow(client.GET('/api/payments/{payment_id}', { params: paymentPath(id) })),
  })
}

/** A Payment's Receipt for the Customer, worded from the Receipt template. */
export function receiptQuery(client: ApiClient, paymentId: number) {
  return queryOptions({
    queryKey: [...keys.payment(paymentId), 'receipt'],
    queryFn: () =>
      dataOrThrow(
        client.GET('/api/payments/{payment_id}/receipt', { params: paymentPath(paymentId) }),
      ),
  })
}

/** Each way a Payment can be made, by name: fixed while the app runs. */
export function paymentMethodsQuery(client: ApiClient) {
  return queryOptions({
    queryKey: ['payment-methods'],
    queryFn: () => dataOrThrow(client.GET('/api/payment-methods')),
    staleTime: Infinity,
  })
}
