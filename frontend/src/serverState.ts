// The server-state module: every request to the backend goes through the typed client
// (paths, query parameters and bodies checked against api.gen.ts), and every answer is
// kept in one query cache. What a change makes stale is declared here, once.
import { QueryClient, useQueryClient } from '@tanstack/react-query'
import createClient, { type Client } from 'openapi-fetch'
import { createContext, useContext } from 'react'
import type { Mortgage } from './api'
import type { paths } from './api.gen'

export type ApiClient = Client<paths>

/** Turns a FastAPI error body into one readable line. */
export function errorMessage(status: number, body: unknown): string {
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

/** The backend answered, but not with what was asked: a refusal (4xx) or a failure (5xx). */
export class BackendError extends Error {
  readonly status: number
  constructor(status: number, body: unknown) {
    super(errorMessage(status, body))
    this.status = status
  }
}

/** The data of a typed-client call, or a BackendError carrying the backend's message. */
export async function dataOrThrow<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await call
  if (!response.ok) throw new BackendError(response.status, error)
  return data as T
}

/** Asked again once, unless the backend refused: a refusal is the answer. */
const retryUnlessRefused = (failures: number, error: Error) =>
  failures < 1 && !(error instanceof BackendError && error.status < 500)

/** Query keys, by what they hold; a prefix matches every key under it. */
export const keys = {
  mortgage: (id: number) => ['mortgage', id] as const,
  /** A Mortgage's History; under the Mortgage, so whatever makes it stale does this too. */
  mortgageHistory: (id: number) => ['mortgage', id, 'history'] as const,
  customer: (id: number) => ['customer', id] as const,
  /** Every Customer, and everything under one (their History). */
  allCustomers: ['customer'] as const,
  payment: (id: number) => ['payment', id] as const,
  /** Every Payment, and everything under one (its Receipt). */
  allPayments: ['payment'] as const,
  /** A Mortgage's Call Notes. */
  callNotes: (mortgageId: number) => ['call-notes', mortgageId] as const,
  /** Every single-Mortgage key. */
  allMortgages: ['mortgage'] as const,
  lists: ['list'] as const,
  /** One list (with any filters, sort and page). */
  list: (name: string) => ['list', name] as const,
  dashboard: ['dashboard'] as const,
  readyToRedeem: ['ready-to-redeem'] as const,
  /** Every Preview of an unsaved change. */
  previews: ['preview'] as const,
  /** Every Redemption Amount quoted for a date. */
  redemptions: ['redemption'] as const,
  /** Every settings group. */
  settings: ['settings'] as const,
  backups: ['backups'] as const,
}

/** Fired by the old fetch functions after anything that can change what Mortgages owe. */
export const LEDGER_CHANGED = 'ledger-changed'

/** What a change to what Mortgages owe makes stale, asked for again at once if shown. */
const REFRESHED_AFTER_LEDGER_CHANGE = [
  keys.allMortgages,
  // How each Payment was applied, and its Receipt, are replayed too.
  keys.allPayments,
  keys.lists,
  keys.dashboard,
  keys.readyToRedeem,
]
/** Stale too, but asked for again only when next shown: one on screen is usually the
 *  Preview or quote of the very change just made, which the backend would now refuse. */
const OUTDATED_BY_LEDGER_CHANGE = [keys.previews, keys.redemptions]

export function markLedgerStale(queryClient: QueryClient): void {
  for (const queryKey of REFRESHED_AFTER_LEDGER_CHANGE) {
    void queryClient.invalidateQueries({ queryKey })
  }
  for (const queryKey of OUTDATED_BY_LEDGER_CHANGE) {
    void queryClient.invalidateQueries({ queryKey, refetchType: 'none' })
  }
}

/** What each other kind of change makes stale. */
export const STALE_AFTER = {
  /** Approving, skipping or sending a Notice: the Notices, and the Dashboard's counts. */
  notice: [keys.list('notices'), keys.dashboard],
  /** Marking a Mortgage called: the Call List and the Call Notes. */
  callNote: [keys.list('call-list'), ['call-notes']],
  /** Saving or deleting a Customer: the Customer, and the lists that show Customers. */
  customer: [
    keys.allCustomers,
    keys.list('customers'),
    keys.list('mortgages'),
    keys.list('payments'),
  ],
  /** A Collateral Value set by hand: that Mortgage's Loan-to-Value, so the Call List. */
  collateral: [keys.allMortgages, keys.lists, keys.dashboard],
  /** New Gold Rates: every Collateral Value, so Loan-to-Value and the Call List. */
  goldRates: [keys.allMortgages, keys.lists, keys.dashboard],
  /** New Call List thresholds: the Call List, and the Dashboard's count of it. */
  callListThresholds: [keys.list('call-list'), keys.dashboard],
  /** New message settings: Notices are queued again to match them. */
  messageSettings: [keys.list('notices'), keys.dashboard],
} satisfies Record<string, readonly (readonly unknown[])[]>

export function markStale(queryClient: QueryClient, stale: readonly (readonly unknown[])[]) {
  for (const queryKey of stale) void queryClient.invalidateQueries({ queryKey })
}

/** Marks the event this module fires, so its own listener doesn't act on it twice. */
export const FIRED_BY_CACHE = 'cache'

/**
 * Anything that can change what Mortgages owe (Payments, Voids, edits, Term Changes,
 * closing and reopening) makes every Mortgage, list, the Dashboard, the Ready to
 * Redeem count, every Preview and every Redemption Amount quote stale.
 */
export function ledgerChanged(queryClient: QueryClient): void {
  markLedgerStale(queryClient)
  // Pages still on the old fetch functions listen for this.
  window.dispatchEvent(new CustomEvent(LEDGER_CHANGED, { detail: FIRED_BY_CACHE }))
}

export interface ServerState {
  client: ApiClient
  queryClient: QueryClient
}

/** A typed client and an empty cache; tests pass a fake `fetch` and no retries. */
export function createServerState({
  fetch = (request: Request) => globalThis.fetch(request),
  retry = true,
}: { fetch?: (request: Request) => Promise<Response>; retry?: boolean } = {}): ServerState {
  return {
    client: createClient<paths>({ baseUrl: window.location.origin, fetch }),
    queryClient: new QueryClient({
      defaultOptions: {
        queries: { retry: retry ? retryUnlessRefused : false },
        mutations: { retry: false },
      },
    }),
  }
}

/** The typed client, given by ServerStateProvider. */
export const ClientContext = createContext<ApiClient | null>(null)

/** The typed client and the cache, inside a ServerStateProvider. */
export function useServerState(): ServerState {
  const client = useContext(ClientContext)
  const queryClient = useQueryClient()
  if (!client) throw new Error('useServerState needs a ServerStateProvider')
  return { client, queryClient }
}

/**
 * Saves a change that can alter what Mortgages owe, then makes stale everything it
 * affects: `const changeLedger = useLedgerChange(); await changeLedger((c) => …)`.
 */
export function useLedgerChange() {
  const { client, queryClient } = useServerState()
  return async <T,>(change: (client: ApiClient) => Promise<T>): Promise<T> => {
    const result = await change(client)
    ledgerChanged(queryClient)
    return result
  }
}

/**
 * Saves a change to one Mortgage that returns it, as useLedgerChange does, and keeps
 * what was returned as that Mortgage, so its page shows the change at once rather than
 * what was cached before it.
 */
export function useMortgageChange() {
  const { queryClient } = useServerState()
  const changeLedger = useLedgerChange()
  return async (change: (client: ApiClient) => Promise<Mortgage>): Promise<Mortgage> => {
    const changed = await changeLedger(change)
    queryClient.setQueryData(keys.mortgage(changed.id), changed)
    return changed
  }
}

/**
 * Saves a change that cannot alter what Mortgages owe, then makes `stale` stale (one
 * of STALE_AFTER): `const actOnNotice = useChange(STALE_AFTER.notice)`.
 */
export function useChange(stale: readonly (readonly unknown[])[]) {
  const { client, queryClient } = useServerState()
  return async <T,>(change: (client: ApiClient) => Promise<T>): Promise<T> => {
    const result = await change(client)
    markStale(queryClient, stale)
    return result
  }
}
