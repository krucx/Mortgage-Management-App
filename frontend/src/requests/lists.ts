import type {
  CallListSort,
  CustomerSort,
  DormantSort,
  MortgageSort,
  MortgageStatus,
  ReminderSort,
  ReminderStatus,
  PaymentSort,
} from '../api'
import { dataOrThrow, type ApiClient } from '../serverState'
import type { Sort } from '../sort'

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
    /** Only the closed: Redeemed, Waived and Forfeited. */
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
  payments: (filters: { query: string; month?: string; year?: string; includeVoided: boolean }) =>
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
  reminders: (status?: ReminderStatus) =>
    ({
      key: ['reminders', { status }],
      load: (client, page, sort) =>
        dataOrThrow(
          client.GET('/api/reminders', { params: { query: { page, status, ...sortQuery(sort) } } }),
        ),
    }) satisfies ListRequest<ReminderSort, unknown>,
  callList: () =>
    ({
      key: ['call-list'],
      load: (client, page, sort) =>
        dataOrThrow(
          client.GET('/api/call-list', { params: { query: { page, ...sortQuery(sort) } } }),
        ),
    }) satisfies ListRequest<CallListSort, unknown>,
  dormant: () =>
    ({
      key: ['dormant'],
      load: (client, page, sort) =>
        dataOrThrow(
          client.GET('/api/closures/dormant', { params: { query: { page, ...sortQuery(sort) } } }),
        ),
    }) satisfies ListRequest<DormantSort, unknown>,
}
