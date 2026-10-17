import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { api, LEDGER_CHANGED } from '../api'

/**
 * How many Mortgages are paid off and waiting to be Redeemed. Re-checked on every page
 * and whenever a Payment, Redemption or Forfeiture is recorded.
 */
export function useReadyToRedeemCount(): number {
  const { pathname } = useLocation()
  const [count, setCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    const refresh = () =>
      api
        .readyToRedeem(1)
        .then((ready) => !cancelled && setCount(ready.total))
        .catch(() => {})
    refresh()
    window.addEventListener(LEDGER_CHANGED, refresh)
    return () => {
      cancelled = true
      window.removeEventListener(LEDGER_CHANGED, refresh)
    }
  }, [pathname])

  return count
}
