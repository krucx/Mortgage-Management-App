import { useQueries } from '@tanstack/react-query'
import { redemptionQuery } from '../requests'
import { useServerState } from '../serverState'
import type { Quote } from './Owed'

/** The Redemption Amount of each of `mortgages` on `on`, or why there is none. */
export function useQuotes(mortgages: { id: number }[], on: string) {
  const { client } = useServerState()
  const quoted = useQueries({
    queries: mortgages.map((m) => ({ ...redemptionQuery(client, m.id, on), enabled: on !== '' })),
  })
  const quotes: Record<string, Quote> = Object.fromEntries(
    mortgages.map((m, i) => [`${on}:${m.id}`, quoted[i].data ?? quoted[i].error?.message]),
  )
  return (id: number) => quotes[`${on}:${id}`]
}
