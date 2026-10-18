import { hashKey, keepPreviousData, useQuery } from '@tanstack/react-query'
import type { MortgagePreview } from '../api'
import type { PreviewRequest } from '../requests'
import { keys, useServerState } from '../serverState'
import { useDebounced } from './useDebounced'

/** A Preview as it loads. */
export interface Preview<T = MortgagePreview[]> {
  previews: T | null
  error: string | null
  loading: boolean
}

/**
 * The Preview of `request` once it has stopped changing for `delay` ms; null when
 * there is nothing to preview. The last answer stays shown, marked `loading`, until the
 * next one arrives, and an answer for a change since replaced is never shown.
 */
export function usePreview<T = MortgagePreview[]>(
  request: PreviewRequest<T> | null,
  delay = 400,
): Preview<T> {
  const { client } = useServerState()
  const wanted = request ? hashKey(request.key) : null
  const settled = useDebounced(wanted, delay) === wanted
  const query = useQuery({
    queryKey: [...keys.previews, ...(request?.key ?? [])],
    queryFn: () => request!.load(client),
    enabled: request !== null && settled,
    placeholderData: keepPreviousData,
    // The answer for an unchanged draft is the same: looking away and back asks nothing.
    refetchOnWindowFocus: false,
  })

  if (!request) return { previews: null, error: null, loading: false }
  const current = settled && !query.isPlaceholderData && !query.isFetching
  return {
    previews: query.data ?? null,
    error: current ? (query.error?.message ?? null) : null,
    loading: !current,
  }
}
