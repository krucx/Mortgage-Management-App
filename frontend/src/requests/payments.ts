import { queryOptions } from '@tanstack/react-query'
import type { Payment } from '../api'
import { dataOrThrow, keys, type ApiClient } from '../serverState'
import { paymentPath } from './paths'

/** A Payment and how it was applied to each Mortgage. */
export function paymentQuery(client: ApiClient, id: number) {
  return queryOptions({
    queryKey: keys.payment(id),
    queryFn: () =>
      dataOrThrow(client.GET('/api/payments/{payment_id}', { params: paymentPath(id) })),
  })
}

/** A Payment's Receipt for the Customer, worded from the Receipt template. */
export function receiptQuery(client: ApiClient, paymentId: number) {
  return queryOptions({
    queryKey: [...keys.payment(paymentId), 'receipt'],
    queryFn: ({ client: cache }) => {
      // Not asked for once the Payment is known to be Voided: it has none.
      if (cache.getQueryData<Payment>(keys.payment(paymentId))?.voided_at) {
        throw new Error('A Voided Payment has no Receipt')
      }
      return dataOrThrow(
        client.GET('/api/payments/{payment_id}/receipt', { params: paymentPath(paymentId) }),
      )
    },
  })
}

/** Each way a Payment can be made, by name: fixed while the app runs. */
export function paymentMethodsQuery(client: ApiClient) {
  return queryOptions({
    queryKey: keys.paymentMethods,
    queryFn: () => dataOrThrow(client.GET('/api/payment-methods')),
    staleTime: Infinity,
  })
}
