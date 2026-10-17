import { useEffect, useState } from 'react'
import { api, type PersonSummary } from '../api'
import { normalisePhone } from '../phone'

/** Who a Primary Number belongs to, looked up once a complete number is typed. */
export function useNumberOwner(raw: string): PersonSummary | null {
  const phone = normalisePhone(raw)
  const [found, setFound] = useState<{ phone: string; owner: PersonSummary | null } | null>(null)

  useEffect(() => {
    if (!phone) return
    let cancelled = false
    api
      .personByPhone(phone)
      .then((owner) => !cancelled && setFound({ phone, owner }))
      .catch(() => !cancelled && setFound({ phone, owner: null }))
    return () => {
      cancelled = true
    }
  }, [phone])

  return phone && found?.phone === phone ? found.owner : null
}
