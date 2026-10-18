import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect, type ReactNode } from 'react'
import {
  ClientContext,
  FIRED_BY_CACHE,
  LEDGER_CHANGED,
  markLedgerStale,
  type ServerState,
} from '../serverState'

/** Gives every page below it the typed client and the query cache. */
export function ServerStateProvider({
  state,
  children,
}: {
  state: ServerState
  children: ReactNode
}) {
  // While some pages still save through the old fetch functions, their Ledger changes
  // make the cache stale too.
  useEffect(() => {
    const stale = (event: Event) => {
      if ((event as CustomEvent).detail !== FIRED_BY_CACHE) markLedgerStale(state.queryClient)
    }
    window.addEventListener(LEDGER_CHANGED, stale)
    return () => window.removeEventListener(LEDGER_CHANGED, stale)
  }, [state.queryClient])

  return (
    <ClientContext.Provider value={state.client}>
      <QueryClientProvider client={state.queryClient}>{children}</QueryClientProvider>
    </ClientContext.Provider>
  )
}
