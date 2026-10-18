import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ClientContext, type ServerState } from '../serverState'

/** Gives every page below it the typed client and the query cache. */
export function ServerStateProvider({
  state,
  children,
}: {
  state: ServerState
  children: ReactNode
}) {
  return (
    <ClientContext.Provider value={state.client}>
      <QueryClientProvider client={state.queryClient}>{children}</QueryClientProvider>
    </ClientContext.Provider>
  )
}
