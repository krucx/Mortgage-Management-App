import { useQuery } from '@tanstack/react-query'
import type { PaymentMethod } from '../api'
import { paymentMethodsQuery } from '../requests'
import { useServerState } from '../serverState'

/** Each way a Payment can be made, by name. */
export type PaymentMethodNames = Record<PaymentMethod, string>

const RETRY_MS = 3000

/** The payment method names as the backend gives them (and Receipts use); null until
 *  they arrive, asking again every few seconds if the backend could not be reached. */
export function usePaymentMethods(): PaymentMethodNames | null {
  const { client } = useServerState()
  const { data } = useQuery({
    ...paymentMethodsQuery(client),
    select: (methods) =>
      Object.fromEntries(methods.map(({ method, name }) => [method, name])) as PaymentMethodNames,
    retry: true,
    retryDelay: RETRY_MS,
  })
  return data ?? null
}
