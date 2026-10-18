import { useQuery } from '@tanstack/react-query'
import type { SearchHit } from '../api'
import { searchQuery } from '../requests'
import { useServerState } from '../serverState'
import { useDebounced } from './useDebounced'

/** Live search of Customers and Referrers, debounced while typing; nothing if it fails. */
export function useSearch(query: string): SearchHit[] {
  const { client } = useServerState()
  const settled = useDebounced(query.trim())
  const { data } = useQuery({ ...searchQuery(client, settled), enabled: settled !== '' })
  return query.trim() && settled ? (data ?? []) : []
}
