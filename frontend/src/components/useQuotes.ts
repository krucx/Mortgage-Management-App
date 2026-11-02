import { useQueries } from '@tanstack/react-query'
import { closingQuoteQuery } from '../requests'
import { useServerState } from '../serverState'
import type { Quote } from './Owed'

/** The Outstanding of each of `mortgages` if closed on `on`, or why it can't be. */
export function useQuotes(mortgages: { id: number }[], on: string) {
  const { client } = useServerState()
  const quoted = useQueries({
    queries: mortgages.map((m) => ({ ...closingQuoteQuery(client, m.id, on), enabled: on !== '' })),
  })
  const quotes: Record<string, Quote> = Object.fromEntries(
    mortgages.map((m, i) => [`${on}:${m.id}`, quoted[i].data ?? quoted[i].error?.message]),
  )
  return (id: number) => quotes[`${on}:${id}`]
}
