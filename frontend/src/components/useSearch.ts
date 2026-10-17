import { useEffect, useState } from 'react'
import { api, type SearchHit } from '../api'

/** Live search of Customers and Referrers, debounced while typing. */
export function useSearch(query: string): SearchHit[] {
  const [hits, setHits] = useState<SearchHit[]>([])

  useEffect(() => {
    if (!query.trim()) return
    let cancelled = false
    const timer = setTimeout(() => {
      api
        .search(query)
        .then((found) => !cancelled && setHits(found))
        .catch(() => !cancelled && setHits([]))
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  return query.trim() ? hits : []
}
