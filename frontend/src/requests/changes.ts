import type {
  ForfeitAllIn,
  MortgageEdit,
  PaymentIn,
  RedeemAllIn,
  TermChangeIn,
  WaiveAllIn,
} from '../api'
import { dataOrThrow, type ApiClient } from '../serverState'
import { mortgagePath, paymentPath } from './paths'

/** Each change that can alter what Mortgages owe; save them through useLedgerChange. */
export const changes = {
  edit: (client: ApiClient, id: number, edit: MortgageEdit) =>
    dataOrThrow(
      client.PUT('/api/mortgages/{mortgage_id}', { params: mortgagePath(id), body: edit }),
    ),
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
  redeemAll: (client: ApiClient, redeem: RedeemAllIn) =>
    dataOrThrow(client.POST('/api/closures/redeem', { body: redeem })),
  waiveAll: (client: ApiClient, waive: WaiveAllIn) =>
    dataOrThrow(client.POST('/api/closures/waive', { body: waive })),
  forfeitAll: (client: ApiClient, forfeit: ForfeitAllIn) =>
    dataOrThrow(client.POST('/api/closures/forfeit', { body: forfeit })),
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
