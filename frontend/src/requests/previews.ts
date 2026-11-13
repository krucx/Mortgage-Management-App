import type {
  CollateralPreview,
  ForfeitAllIn,
  GraceOffer,
  MortgageEdit,
  MortgageIn,
  NewMortgagePreview,
  PaymentIn,
  PreviewOfChange,
  RedeemAllIn,
  TermChangeIn,
  WaiveAllIn,
} from '../api'
import { dataOrThrow, type ApiClient } from '../serverState'
import { mortgagePath, paymentPath } from './paths'

/** A Preview of an unsaved change: which change it is, and how to ask for it. */
export interface PreviewRequest<T = PreviewOfChange> {
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
  /** For a Payment drafted on the date it was received: each earlier date the Grace
   *  Period allows that lets off anything, the one gracing the most Mortgages first. */
  graceOffers: (payment: PaymentIn): PreviewRequest<GraceOffer[]> => ({
    key: ['grace-offer', payment],
    load: (client) => dataOrThrow(client.POST('/api/payments/grace-offer', { body: payment })),
  }),
  void: (paymentId: number): PreviewRequest => ({
    key: ['void', paymentId],
    load: (client) =>
      dataOrThrow(
        client.POST('/api/payments/{payment_id}/void-preview', { params: paymentPath(paymentId) }),
      ),
  }),
  redeemAll: (redeem: RedeemAllIn): PreviewRequest => ({
    key: ['redeem-all', redeem],
    load: (client) => dataOrThrow(client.POST('/api/closures/redeem-preview', { body: redeem })),
  }),
  waiveAll: (waive: WaiveAllIn): PreviewRequest => ({
    key: ['waive-all', waive],
    load: (client) => dataOrThrow(client.POST('/api/closures/waive-preview', { body: waive })),
  }),
  forfeitAll: (forfeit: ForfeitAllIn): PreviewRequest => ({
    key: ['forfeit-all', forfeit],
    load: (client) => dataOrThrow(client.POST('/api/closures/forfeit-preview', { body: forfeit })),
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
