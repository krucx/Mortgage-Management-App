import { queryOptions } from '@tanstack/react-query'
import type { Mortgage, MortgageIn, MortgageStatus, SimulationIn } from '../api'
import { dataOrThrow, keys, type ApiClient } from '../serverState'
import { mortgagePath, customerPath } from './paths'
import { photoBody } from './files'

/** How many Mortgages are Dormant: Active yet owing nothing, to be Redeemed. */
export function dormantCountQuery(client: ApiClient) {
  return queryOptions({
    queryKey: keys.dormant,
    queryFn: () =>
      dataOrThrow(client.GET('/api/closures/dormant', { params: { query: { page: 1 } } })),
    select: (dormant) => dormant.total,
  })
}

/** A Mortgage as it stands today: its Ledger, Outstanding, Collateral and photos. */
export function mortgageQuery(client: ApiClient, id: number) {
  return queryOptions({
    queryKey: keys.mortgage(id),
    queryFn: () =>
      dataOrThrow(client.GET('/api/mortgages/{mortgage_id}', { params: mortgagePath(id) })),
  })
}

/** What it takes to close a Mortgage on a date, its Outstanding then (quoted, so also a
 *  future one). */
export function outstandingOnClosureQuery(client: ApiClient, id: number, on: string) {
  return queryOptions({
    queryKey: [...keys.outstandingOnClosure, id, on],
    queryFn: () =>
      dataOrThrow(
        client.GET('/api/mortgages/{mortgage_id}/outstanding-on-closure', {
          params: { ...mortgagePath(id), query: { on } },
        }),
      ),
  })
}

/** Keep a photo of a Mortgage's jewellery; the Mortgage with it. */
export function addMortgagePhoto(client: ApiClient, id: number, photo: Blob) {
  return dataOrThrow(
    client.POST('/api/mortgages/{mortgage_id}/photos', {
      params: mortgagePath(id),
      ...photoBody(photo),
    }),
  )
}

/** Stop keeping one of a Mortgage's photos; the Mortgage without it. */
export const removeMortgagePhoto = (client: ApiClient, id: number, photoId: number) =>
  dataOrThrow(
    client.DELETE('/api/mortgages/{mortgage_id}/photos/{photo_id}', {
      params: { path: { mortgage_id: id, photo_id: photoId } },
    }),
  )

/** A Mortgage's History, newest first. */
export function mortgageHistoryQuery(client: ApiClient, id: number) {
  return queryOptions({
    queryKey: keys.mortgageHistory(id),
    queryFn: () =>
      dataOrThrow(client.GET('/api/mortgages/{mortgage_id}/history', { params: mortgagePath(id) })),
  })
}

/** Every Discount and Waived Amount still standing for a Customer, newest first (Grace
 *  joins them later); under the Customer, so a change to what Mortgages owe makes it
 *  stale. */
export function favoursGivenQuery(client: ApiClient, id: number) {
  return queryOptions({
    queryKey: [...keys.customer(id), 'favours'],
    queryFn: () =>
      dataOrThrow(client.GET('/api/customers/{customer_id}/favours', { params: customerPath(id) })),
  })
}

/** Where an Active Mortgage is heading with no more Payments, and with `monthlyPayment`. */
export function projectionQuery(client: ApiClient, id: number, monthlyPayment: number | null) {
  return queryOptions({
    queryKey: [...keys.mortgage(id), 'projection', monthlyPayment],
    queryFn: ({ client: cache }) => {
      // Not asked for once the Mortgage is known to be closed: it has none.
      const status = cache.getQueryData<Mortgage>(keys.mortgage(id))?.status
      if (status && status !== 'active') throw new Error('Only an Active Mortgage has a Projection')
      return dataOrThrow(
        client.GET('/api/mortgages/{mortgage_id}/projection', {
          params: {
            ...mortgagePath(id),
            query: monthlyPayment ? { monthly_payment: monthlyPayment } : {},
          },
        }),
      )
    },
  })
}

/** A Simulation, worked out by the backend's ledger engine; nothing is stored, so it is
 *  never made stale. */
export function simulationQuery(client: ApiClient, simulation: SimulationIn) {
  return queryOptions({
    queryKey: ['simulation', simulation],
    queryFn: () => dataOrThrow(client.POST('/api/simulation', { body: simulation })),
  })
}

/** Every one of a Customer's Mortgages that match, on one page, for choosing from: a
 *  picker must never leave one out. With `asOf`, Outstanding is worked out on that date. */
export function everyMortgageQuery(
  client: ApiClient,
  filters: { customerId: number; status?: MortgageStatus; asOf?: string },
) {
  return queryOptions({
    queryKey: [...keys.list('mortgages'), 'every', filters],
    queryFn: () =>
      dataOrThrow(
        client.GET('/api/mortgages', {
          params: {
            query: {
              page: 1,
              customer_id: filters.customerId,
              status: filters.status,
              as_of: filters.asOf,
              paged: false,
            },
          },
        }),
      ),
  })
}

/** The Mortgage Name the backend would give a new Mortgage. */
export function suggestedNameQuery(
  client: ApiClient,
  asked: { customerId: number; startDate: string; description: string },
) {
  return queryOptions({
    queryKey: keys.suggestedName(asked),
    queryFn: () =>
      dataOrThrow(
        client.GET('/api/mortgages/suggested-name', {
          params: {
            query: {
              customer_id: asked.customerId,
              start_date: asked.startDate,
              description: asked.description,
            },
          },
        }),
      ),
  })
}

/** Lend against a packet of jewellery; the new Mortgage. */
export const createMortgage = (client: ApiClient, mortgage: MortgageIn) =>
  dataOrThrow(client.POST('/api/mortgages', { body: mortgage }))
