import { useEffect, useState } from 'react'
import { api, type PaymentMethod } from '../api'

/** Each way a Payment can be made, by name. */
export type PaymentMethodNames = Record<PaymentMethod, string>

// Fetched once for the whole app; forgotten if it fails, so it is asked for again.
let names: Promise<PaymentMethodNames> | null = null
const RETRY_MS = 3000

/** The payment method names as the backend gives them (and Receipts use); null until
 *  they arrive, asking again every few seconds if the backend could not be reached. */
export function usePaymentMethods(): PaymentMethodNames | null {
  const [loaded, setLoaded] = useState<PaymentMethodNames | null>(null)
  useEffect(() => {
    let live = true
    let retry: ReturnType<typeof setTimeout> | undefined
    function load() {
      names ??= api
        .getPaymentMethods()
        .then((methods) =>
          Object.fromEntries(methods.map(({ method, name }) => [method, name])) as PaymentMethodNames,
        )
      names.then(
        (found) => {
          if (live) setLoaded(found)
        },
        () => {
          names = null
          if (live) retry = setTimeout(load, RETRY_MS)
        },
      )
    }
    load()
    return () => {
      live = false
      clearTimeout(retry)
    }
  }, [])
  return loaded
}
