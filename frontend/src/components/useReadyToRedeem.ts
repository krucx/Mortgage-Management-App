import { useQuery } from '@tanstack/react-query'
import { dataOrThrow, keys, useServerState } from '../serverState'

/**
 * How many Mortgages are paid off and waiting to be Redeemed; asked for again whenever
 * a change to what Mortgages owe makes it stale. Nothing is shown while it can't be had.
 */
export function useReadyToRedeemCount(): number {
  const { client } = useServerState()
  const { data } = useQuery({
    queryKey: keys.readyToRedeem,
    queryFn: () =>
      dataOrThrow(client.GET('/api/closures/ready-to-redeem', { params: { query: { page: 1 } } })),
    select: (ready) => ready.total,
  })
  return data ?? 0
}
