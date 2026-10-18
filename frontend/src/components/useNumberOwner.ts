import { useQuery } from '@tanstack/react-query'
import type { PersonSummary } from '../api'
import { normalisePhone } from '../phone'
import { numberOwnerQuery } from '../requests'
import { useServerState } from '../serverState'

/** Who a Primary Number belongs to, looked up once a complete number is typed; nobody
 *  if it can't be looked up. */
export function useNumberOwner(raw: string): PersonSummary | null {
  const { client } = useServerState()
  const phone = normalisePhone(raw)
  const { data } = useQuery({ ...numberOwnerQuery(client, phone ?? ''), enabled: Boolean(phone) })
  return phone ? (data ?? null) : null
}
