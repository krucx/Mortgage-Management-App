import { useSearchParams } from 'react-router'

type Changes = Record<string, string | null> // null removes the filter

/**
 * A list's filters, kept in the page's URL so a narrowed list can be shared, bookmarked
 * or opened from a link (e.g. a Dashboard figure). Changing them replaces the history
 * entry rather than adding one per click.
 */
export function useUrlFilters(): [URLSearchParams, (changes: Changes) => void] {
  const [params, setParams] = useSearchParams()
  function setFilters(changes: Changes) {
    const next = new URLSearchParams(params)
    for (const [name, value] of Object.entries(changes)) {
      if (value === null) next.delete(name)
      else next.set(name, value)
    }
    setParams(next, { replace: true })
  }
  return [params, setFilters]
}
