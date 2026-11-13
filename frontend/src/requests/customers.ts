import { queryOptions } from '@tanstack/react-query'
import type { CustomerIn, IdCard } from '../api'
import { dataOrThrow, keys, type ApiClient } from '../serverState'
import { customerPath } from './paths'
import { photoBody } from './files'
import type { PreviewRequest } from './previews'

/** Delete a Customer (refused while they have Mortgages). */
export const deleteCustomer = (client: ApiClient, id: number) =>
  dataOrThrow(client.DELETE('/api/customers/{customer_id}', { params: customerPath(id) }))
/** Whether deleting the Customer would be refused (it throws the reason), saving nothing. */
export const previewDeleteCustomer = (client: ApiClient, id: number) =>
  dataOrThrow(
    client.POST('/api/customers/{customer_id}/delete-preview', { params: customerPath(id) }),
  )

/** A Customer's History (and their Mortgages'), newest first. */
export function customerHistoryQuery(client: ApiClient, id: number) {
  return queryOptions({
    queryKey: [...keys.customer(id), 'history'],
    queryFn: () =>
      dataOrThrow(
        client.GET('/api/customers/{customer_id}/history', {
          params: customerPath(id),
        }),
      ),
  })
}

/** A Customer, with whom they referred and who shares their numbers. */
export function customerQuery(client: ApiClient, id: number) {
  return queryOptions({
    queryKey: keys.customer(id),
    queryFn: () =>
      dataOrThrow(client.GET('/api/customers/{customer_id}', { params: customerPath(id) })),
  })
}

/** A Standalone Referrer, with the Customers they referred. */
export function referrerQuery(client: ApiClient, id: number) {
  return queryOptions({
    queryKey: keys.referrer(id),
    queryFn: () =>
      dataOrThrow(
        client.GET('/api/referrers/{referrer_id}', { params: { path: { referrer_id: id } } }),
      ),
  })
}

/** Customers and Referrers matching a name or phone. */
export function searchQuery(client: ApiClient, query: string) {
  return queryOptions({
    queryKey: keys.search(query),
    queryFn: () => dataOrThrow(client.GET('/api/search', { params: { query: { q: query } } })),
  })
}

/** Who a Primary Number belongs to, if anyone. */
export function numberOwnerQuery(client: ApiClient, phone: string) {
  return queryOptions({
    queryKey: keys.numberOwner(phone),
    queryFn: () =>
      dataOrThrow(client.GET('/api/people/by-phone', { params: { query: { phone } } })),
  })
}

/** Saving a Customer: new (no id) or edited; their photo is replaced separately. */
export const customerChanges = {
  /** Whether saving would be refused (its reason as the Preview's error), saving nothing. */
  preview: (customer: CustomerIn, id?: number): PreviewRequest<null> => ({
    key: ['customer-save', id ?? 'new', customer],
    // Nothing comes back when it would save; null, as a query's answer can't be undefined.
    load: (client) =>
      dataOrThrow(
        id === undefined
          ? client.POST('/api/customers/preview', { body: customer })
          : client.PUT('/api/customers/{customer_id}/preview', {
              params: customerPath(id),
              body: customer,
            }),
      ).then(() => null),
  }),
  save: (client: ApiClient, customer: CustomerIn, id?: number) =>
    dataOrThrow(
      id === undefined
        ? client.POST('/api/customers', { body: customer })
        : client.PUT('/api/customers/{customer_id}', {
            params: customerPath(id),
            body: customer,
          }),
    ),
  /** Add or replace one of the Customer's ID Photos; the Customer as it now is. */
  replaceIdPhoto: (client: ApiClient, id: number, card: IdCard, photo: Blob) =>
    dataOrThrow(
      client.PUT('/api/customers/{customer_id}/id-photos/{card}', {
        params: { path: { customer_id: id, card } },
        ...photoBody(photo),
      }),
    ),
  /** Remove one of the Customer's ID Photos; the Customer as it now is. */
  removeIdPhoto: (client: ApiClient, id: number, card: IdCard) =>
    dataOrThrow(
      client.DELETE('/api/customers/{customer_id}/id-photos/{card}', {
        params: { path: { customer_id: id, card } },
      }),
    ),
  replacePhoto: (client: ApiClient, id: number, photo: Blob) =>
    dataOrThrow(
      client.PUT('/api/customers/{customer_id}/photo', {
        params: customerPath(id),
        ...photoBody(photo),
      }),
    ),
}
