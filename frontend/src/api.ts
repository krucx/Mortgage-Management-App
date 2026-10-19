// Request and response types are generated from the backend's OpenAPI schema into
// api.gen.ts (`npm run gen:types`); this file names them. The requests themselves are
// in requests.ts, through the typed client.
import type { components, operations } from './api.gen'

type Schemas = components['schemas']

/** The columns a list endpoint can sort by. */
type SortOf<Operation extends keyof operations> = NonNullable<
  NonNullable<operations[Operation]['parameters']['query']> extends { sort?: infer S } ? S : never
>
/** Every column of `Sort`, in the order given: one missing or not in the generated
 *  type fails to compile, so a column the backend adds or renames is never missed. */
function columnsOf<Sort extends string>(columns: Record<Sort, true>): readonly Sort[] {
  return Object.keys(columns) as Sort[]
}

export type CustomerSort = SortOf<'list_customers_api_customers_get'>
export const CUSTOMER_SORTS = columnsOf<CustomerSort>({
  name: true,
  phone: true,
  address: true,
  referrer: true,
})
export type MortgageSort = SortOf<'list_mortgages_api_mortgages_get'>
export const MORTGAGE_SORTS = columnsOf<MortgageSort>({
  name: true,
  customer: true,
  started: true,
  lent: true,
  outstanding: true,
  status: true,
})
export type PaymentSort = SortOf<'list_payments_api_payments_get'>
export const PAYMENT_SORTS = columnsOf<PaymentSort>({
  date: true,
  customer: true,
  mortgages: true,
  method: true,
  amount: true,
})
export type NoticeSort = SortOf<'read_notices_api_notices_get'>
export const NOTICE_SORTS = columnsOf<NoticeSort>({
  customer: true,
  accrues: true,
  mortgages: true,
  status: true,
})
export type CallListSort = SortOf<'read_call_list_api_call_list_get'>
export const CALL_LIST_SORTS = columnsOf<CallListSort>({
  customer: true,
  mortgage: true,
  why: true,
  outstanding: true,
})
export type ReadySort = SortOf<'ready_to_redeem_api_closures_ready_to_redeem_get'>
export const READY_SORTS = columnsOf<ReadySort>({ mortgage: true, customer: true, amount: true })

export type InterestMode = Schemas['InterestMode']
export type PartMonthRule = Schemas['PartMonthRule']
/** A Mortgage's rate, Interest Mode and Part-Month Rule; also the Default Terms in Settings. */
export type Terms = Schemas['Terms']

/** A Customer or standalone Referrer, as shown in lists and links. */
export type PersonSummary = Schemas['PersonSummary']
export type SearchHit = Schemas['SearchHit']
export type ReferrerChoice = NonNullable<Schemas['CustomerIn']['referrer']>
export type CustomerIn = Schemas['CustomerIn']
/** A Customer as listed in the Customers table. */
export type CustomerRow = Schemas['CustomerRow']
export type CustomerPage = Schemas['Page_CustomerRow_']
export type Customer = Schemas['Customer']
export type StandaloneReferrer = Schemas['StandaloneReferrer']

export type Purity = Schemas['MortgageIn']['purity_karat']
export const PURITIES: Purity[] = [24, 22, 20, 18, 14]

export type MortgageIn = Schemas['MortgageIn']
export type LedgerStep = Schemas['LedgerStep']

export type PaymentMethod = Schemas['PaymentMethod']
export type PaymentMethodName = Schemas['PaymentMethodName']
export type PaymentIn = Schemas['PaymentIn']
/** A Payment as listed on the Payments page. */
export type PaymentRow = Schemas['PaymentRow']
export type PaymentPage = Schemas['PaymentPage']
export type Payment = Schemas['Payment']

export type MortgageStatus = Schemas['MortgageStatus']
/** Principal plus unpaid interest on a date, before any Part-Month Rule charge. */
export type Outstanding = Schemas['Outstanding']
export type Mortgage = Schemas['Mortgage']
export type MortgageRow = Schemas['MortgageRow']
export type MortgagePage = Schemas['Page_MortgageRow_']

export type ProjectedPoint = Schemas['ProjectedPoint']
/** A Term Change in the coming year. */
export type ComingTermChange = Schemas['ComingTermChange']
export type ProjectedSeries = Schemas['ProjectedSeries']
export type Projection = Schemas['Projection']

/** A Ledger step that a change would alter: null on the side where it doesn't exist. */
export type LedgerChange = Schemas['LedgerChange']
export type PreviewSide = Schemas['PreviewSide']
/** One Mortgage before and after a change that has not been saved. */
export type MortgagePreview = Schemas['MortgagePreview']
export type NewMortgagePreview = Schemas['NewMortgagePreview']
export type CollateralPreview = Schemas['CollateralPreview']
/** What a Term Change says; anything left out carries over. */
export type TermChangeIn = Schemas['TermChangeIn']
/** The details of a Mortgage that can be corrected (not its Customer or Terms). */
export type MortgageEdit = Schemas['MortgageEdit']

/** Collateral Value: net weight at the Gold Rate, unless set by hand. */
export type Collateral = Schemas['Collateral']
export type GoldRate = Schemas['GoldRate']
export type BackupStatus = Schemas['BackupStatus']

/** One change in the History; edits have one entry per changed field. */
export type AuditEntry = Schemas['AuditEntry']

export type CallListSettings = Schemas['CallListSettings']
export type CallNote = Schemas['CallNote']
export type CallListRow = Schemas['CallListRow']
/** One Customer's Mortgages on the Call List. */
export type CallListGroup = Schemas['CallListGroup']
export type CallListPage = Schemas['CallListPage']

/** What it takes to close a Mortgage on a date. */
export type Redemption = Schemas['Redemption']
export type RedeemIn = Schemas['RedeemIn']
export type WaiveIn = Schemas['WaiveIn']
export type ForfeitIn = Schemas['ForfeitIn']
/** An Active Mortgage with nothing Outstanding: the jewellery is waiting to go back. */
export type ReadyToRedeem = Schemas['ReadyToRedeem']
export type Closure = Schemas['Closure']

/** The whole lending book at a glance. */
export type Dashboard = Schemas['Dashboard']
export type MonthlyPayments = Schemas['MonthlyPayments']
export type ProjectionHorizon = Schemas['ProjectionHorizon']
export type ComingMonth = Schemas['ComingMonth']
export type Receipt = Schemas['Receipt']
export type Notice = Schemas['Notice']
export type NoticeStatus = Notice['status']
export type MessageSettings = Schemas['MessageSettings']
export type MessagePlaceholders = Schemas['MessagePlaceholders']
