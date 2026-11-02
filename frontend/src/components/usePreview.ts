import { hashKey, keepPreviousData, useQuery } from '@tanstack/react-query'
import type { PreviewOfChange } from '../api'
import type { PreviewRequest } from '../requests'
import { keys, useServerState, type ApiClient } from '../serverState'
import { useDebounced } from './useDebounced'

/** A Preview as it loads. */
export interface Preview<T = PreviewOfChange> {
  previews: T | null
  error: string | null
  loading: boolean
}

/** The query asking for `request`'s Preview, cached under one key wherever it is asked. */
export const previewQuery = <T>(client: ApiClient, request: PreviewRequest<T>) => ({
  queryKey: [...keys.previews, ...request.key],
  queryFn: () => request.load(client),
})

/**
 * The Preview of `request` once it has stopped changing for `delay` ms; null when
 * there is nothing to preview. The last answer stays shown, marked `loading`, until the
 * next one arrives, and an answer for a change since replaced is never shown.
 */
export function usePreview<T = PreviewOfChange>(
  request: PreviewRequest<T> | null,
  delay = 400,
): Preview<T> {
  const { client } = useServerState()
  const wanted = request ? hashKey(request.key) : null
  const settled = useDebounced(wanted, delay) === wanted
  const query = useQuery({
    // Nothing is asked without a request: `enabled` is false then.
    ...previewQuery(client, request ?? { key: [], load: async () => null as T }),
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
