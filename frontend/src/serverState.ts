// The server-state module: every request to the backend goes through the typed client
// (paths, query parameters and bodies checked against api.gen.ts), and every answer is
// kept in one query cache. What a change makes stale is declared here, once.
import { QueryClient, queryOptions, useQueryClient } from '@tanstack/react-query'
import createClient, { type Client } from 'openapi-fetch'
import { createContext, useContext } from 'react'
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

/** The data of a typed-client call, or an Error carrying the backend's message. */
export async function dataOrThrow<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await call
  if (!response.ok) throw new Error(errorMessage(response.status, error))
  return data as T
}

/** Query keys, by what they hold; a prefix matches every key under it. */
export const keys = {
  mortgage: (id: number) => ['mortgage', id] as const,
  /** Every single-Mortgage key. */
  allMortgages: ['mortgage'] as const,
  lists: ['list'] as const,
  dashboard: ['dashboard'] as const,
  readyToRedeem: ['ready-to-redeem'] as const,
}

/** Fired by the old fetch functions after anything that can change what Mortgages owe. */
export const LEDGER_CHANGED = 'ledger-changed'

/** What a change to what Mortgages owe makes stale. */
const STALE_AFTER_LEDGER_CHANGE = [keys.allMortgages, keys.lists, keys.dashboard, keys.readyToRedeem]

export function markLedgerStale(queryClient: QueryClient): void {
  for (const queryKey of STALE_AFTER_LEDGER_CHANGE) {
    void queryClient.invalidateQueries({ queryKey })
  }
}

/** Marks the event this module fires, so its own listener doesn't act on it twice. */
export const FIRED_BY_CACHE = 'cache'

/**
 * Anything that can change what Mortgages owe (Payments, Voids, edits, Term Changes,
 * closing and reopening) makes every Mortgage, list, the Dashboard and the Ready to
 * Redeem count stale.
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
  retry = 1,
}: { fetch?: (request: Request) => Promise<Response>; retry?: boolean | number } = {}): ServerState {
  return {
    client: createClient<paths>({ baseUrl: window.location.origin, fetch }),
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry }, mutations: { retry: false } },
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

/** A Mortgage as it stands today: its Ledger, Outstanding, Collateral and photos. */
export function mortgageQuery(client: ApiClient, id: number) {
  return queryOptions({
    queryKey: keys.mortgage(id),
    queryFn: () =>
      dataOrThrow(client.GET('/api/mortgages/{mortgage_id}', { params: { path: { mortgage_id: id } } })),
  })
}

/** Keep a photo of a Mortgage's jewellery; the Mortgage with it. */
export function addMortgagePhoto(client: ApiClient, id: number, photo: Blob) {
  return dataOrThrow(
    client.POST('/api/mortgages/{mortgage_id}/photos', {
      params: { path: { mortgage_id: id } },
      // The schema types the file as a string; it is sent as multipart form data.
      body: { photo: '' },
      bodySerializer: () => {
        const form = new FormData()
        form.append('photo', photo, 'photo.jpg')
        return form
      },
    }),
  )
}
