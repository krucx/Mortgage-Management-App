import { queryOptions } from '@tanstack/react-query'
import { dataOrThrow, keys, type ApiClient } from '../serverState'

/** The whole lending book at a glance. */
export function dashboardQuery(client: ApiClient, startDate?: string, endDate?: string) {
  return queryOptions({
    queryKey: [...keys.dashboard, startDate, endDate],
    queryFn: () =>
      dataOrThrow(
        client.GET('/api/dashboard', {
          params: {
            query: startDate && endDate ? { start_date: startDate, end_date: endDate } : {},
          },
        }),
      ),
    enabled: !startDate || !endDate || endDate >= startDate,
    placeholderData: (previous) => previous,
  })
}

/** The version running, and a newer release if one is out. */
export function updateStatusQuery(client: ApiClient) {
  return queryOptions({
    queryKey: keys.update,
    queryFn: () => dataOrThrow(client.GET('/api/update')),
    staleTime: Infinity,
  })
}
