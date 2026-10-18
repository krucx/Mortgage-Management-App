import { useQuery } from '@tanstack/react-query'
import { readyToRedeemCountQuery } from '../requests'
import { useServerState } from '../serverState'

/**
 * How many Mortgages are paid off and waiting to be Redeemed; asked for again whenever
 * a change to what Mortgages owe makes it stale. Nothing is shown while it can't be had.
 */
export function useReadyToRedeemCount(): number {
  const { client } = useServerState()
  return useQuery(readyToRedeemCountQuery(client)).data ?? 0
}
