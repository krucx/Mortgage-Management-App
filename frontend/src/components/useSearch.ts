import { useEffect, useState } from 'react'
import { api, type SearchHit } from '../api'
import { useDebounced } from './useDebounced'

/** Live search of Customers and Referrers, debounced while typing. */
export function useSearch(query: string): SearchHit[] {
  const settled = useDebounced(query.trim())
  const [found, setFound] = useState<{ query: string; hits: SearchHit[] } | null>(null)

  useEffect(() => {
    if (!settled) return
    let cancelled = false
    api
      .search(settled)
      .then((hits) => !cancelled && setFound({ query: settled, hits }))
      .catch(() => !cancelled && setFound({ query: settled, hits: [] }))
    return () => {
      cancelled = true
    }
  }, [settled])

  return query.trim() && found ? found.hits : []
}
