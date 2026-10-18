// What the frontend asks the backend, by name: what it reads (with its place in the
// cache), the Previews of unsaved changes, and the changes themselves. Each goes
// through the typed client, so a path, parameter or body the backend doesn't take
// fails to compile.
import { queryOptions } from '@tanstack/react-query'
import type {
  CollateralPreview,
  ForfeitIn,
  MortgageEdit,
  MortgageIn,
  MortgagePreview,
  NewMortgagePreview,
  PaymentIn,
  RedeemIn,
  TermChangeIn,
} from './api'
import { dataOrThrow, keys, type ApiClient } from './serverState'

const mortgagePath = (id: number) => ({ path: { mortgage_id: id } })
const paymentPath = (id: number) => ({ path: { payment_id: id } })

/** A Mortgage as it stands today: its Ledger, Outstanding, Collateral and photos. */
export function mortgageQuery(client: ApiClient, id: number) {
  return queryOptions({
    queryKey: keys.mortgage(id),
    queryFn: () =>
      dataOrThrow(client.GET('/api/mortgages/{mortgage_id}', { params: mortgagePath(id) })),
  })
}

/** What it takes to close a Mortgage on a date (quoted, so also a future one). */
export function redemptionQuery(client: ApiClient, id: number, on: string) {
  return queryOptions({
    queryKey: [...keys.redemptions, id, on],
    queryFn: () =>
      dataOrThrow(
        client.GET('/api/mortgages/{mortgage_id}/redemption', {
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
      // The schema types the file as a string; it is sent as multipart form data.
      body: { photo: '' },
      bodySerializer: () => {
        const form = new FormData()
        form.append('photo', photo, 'photo.jpg')
        return form
      },
    }),
  )
}

/** A Preview of an unsaved change: which change it is, and how to ask for it. */
export interface PreviewRequest<T = MortgagePreview[]> {
  key: readonly unknown[]
  load: (client: ApiClient) => Promise<T>
}

/** The Preview of each change: what it would do, made and rolled back by the backend. */
export const previews = {
  edit: (id: number, edit: MortgageEdit): PreviewRequest => ({
    key: ['edit', id, edit],
    load: (client) =>
      dataOrThrow(
        client.POST('/api/mortgages/{mortgage_id}/edit-preview', {
          params: mortgagePath(id),
          body: edit,
        }),
      ),
  }),
  termChange: (id: number, change: TermChangeIn): PreviewRequest => ({
    key: ['term-change', id, change],
    load: (client) =>
      dataOrThrow(
        client.POST('/api/mortgages/{mortgage_id}/term-changes/preview', {
          params: mortgagePath(id),
          body: change,
        }),
      ),
  }),
  termChangeRemoval: (id: number, changeId: number): PreviewRequest => ({
    key: ['term-change-removal', id, changeId],
    load: (client) =>
      dataOrThrow(
        client.POST('/api/mortgages/{mortgage_id}/term-changes/{change_id}/remove-preview', {
          params: { path: { mortgage_id: id, change_id: changeId } },
        }),
      ),
  }),
  payment: (payment: PaymentIn): PreviewRequest => ({
    key: ['payment', payment],
    load: (client) => dataOrThrow(client.POST('/api/payments/preview', { body: payment })),
  }),
  void: (paymentId: number): PreviewRequest => ({
    key: ['void', paymentId],
    load: (client) =>
      dataOrThrow(
        client.POST('/api/payments/{payment_id}/void-preview', { params: paymentPath(paymentId) }),
      ),
  }),
  redeem: (id: number, redeem: RedeemIn): PreviewRequest => ({
    key: ['redeem', id, redeem],
    load: (client) =>
      dataOrThrow(
        client.POST('/api/mortgages/{mortgage_id}/redeem-preview', {
          params: mortgagePath(id),
          body: redeem,
        }),
      ),
  }),
  forfeit: (id: number, forfeit: ForfeitIn): PreviewRequest => ({
    key: ['forfeit', id, forfeit],
    load: (client) =>
      dataOrThrow(
        client.POST('/api/mortgages/{mortgage_id}/forfeit-preview', {
          params: mortgagePath(id),
          body: forfeit,
        }),
      ),
  }),
  reopen: (id: number): PreviewRequest => ({
    key: ['reopen', id],
    load: (client) =>
      dataOrThrow(
        client.POST('/api/mortgages/{mortgage_id}/reopen-preview', { params: mortgagePath(id) }),
      ),
  }),
  newMortgage: (mortgage: MortgageIn): PreviewRequest<NewMortgagePreview> => ({
    key: ['new-mortgage', mortgage],
    load: (client) => dataOrThrow(client.POST('/api/mortgages/preview', { body: mortgage })),
  }),
  collateral: (id: number, value: number | null): PreviewRequest<CollateralPreview> => ({
    key: ['collateral', id, value],
    load: (client) =>
      dataOrThrow(
        client.POST('/api/mortgages/{mortgage_id}/collateral-preview', {
          params: mortgagePath(id),
          body: { value },
        }),
      ),
  }),
}

/** Each change that can alter what Mortgages owe; save them through useLedgerChange. */
export const changes = {
  edit: (client: ApiClient, id: number, edit: MortgageEdit) =>
    dataOrThrow(client.PUT('/api/mortgages/{mortgage_id}', { params: mortgagePath(id), body: edit })),
  addTermChange: (client: ApiClient, id: number, change: TermChangeIn) =>
    dataOrThrow(
      client.POST('/api/mortgages/{mortgage_id}/term-changes', {
        params: mortgagePath(id),
        body: change,
      }),
    ),
  removeTermChange: (client: ApiClient, id: number, changeId: number) =>
    dataOrThrow(
      client.DELETE('/api/mortgages/{mortgage_id}/term-changes/{change_id}', {
        params: { path: { mortgage_id: id, change_id: changeId } },
      }),
    ),
  recordPayment: (client: ApiClient, payment: PaymentIn) =>
    dataOrThrow(client.POST('/api/payments', { body: payment })),
  voidPayment: (client: ApiClient, paymentId: number, reason: string) =>
    dataOrThrow(
      client.POST('/api/payments/{payment_id}/void', {
        params: paymentPath(paymentId),
        body: { reason },
      }),
    ),
  redeem: (client: ApiClient, id: number, redeem: RedeemIn) =>
    dataOrThrow(
      client.POST('/api/mortgages/{mortgage_id}/redeem', { params: mortgagePath(id), body: redeem }),
    ),
  forfeit: (client: ApiClient, id: number, forfeit: ForfeitIn) =>
    dataOrThrow(
      client.POST('/api/mortgages/{mortgage_id}/forfeit', {
        params: mortgagePath(id),
        body: forfeit,
      }),
    ),
  reopen: (client: ApiClient, id: number, reason: string) =>
    dataOrThrow(
      client.POST('/api/mortgages/{mortgage_id}/reopen', {
        params: mortgagePath(id),
        body: { reason },
      }),
    ),
  setCollateral: (client: ApiClient, id: number, value: number | null) =>
    dataOrThrow(
      client.PUT('/api/mortgages/{mortgage_id}/collateral', {
        params: mortgagePath(id),
        body: { value },
      }),
    ),
}
