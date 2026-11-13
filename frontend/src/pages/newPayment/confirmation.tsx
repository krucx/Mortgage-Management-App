import type { PaymentIn } from '../../api'
import { Summary, type ConfirmOptions } from '../../components/ConfirmDialog'
import type { Preview } from '../../components/usePreview'
import { formatDate } from '../../format'
import { formatINR } from '../../money'
import { RedeemedInFull } from './RedeemedInFull'

/** What Save asks to confirm: the Payment, and the Mortgages it pays in full Redeemed. */
export function paymentConfirmation(
  payment: PaymentIn,
  preview: Preview,
  shown: {
    customerName: string
    /** The date row(s): a Grace Payment's both dates and what it lets off. */
    dateRows: [string, string][]
    method: string
    names: Map<number, string>
  },
): ConfirmOptions {
  const { customerName, dateRows, method, names } = shown
  // The Mortgages it pays their whole Outstanding: the Preview has them Redeemed.
  const redeemed = (preview.previews?.mortgages ?? []).flatMap((p) =>
    p.after.closure?.kind === 'redeemed' ? [{ ...p, closure: p.after.closure }] : [],
  )
  return {
    ...(redeemed.length > 0 && {
      confirmLabel: 'Redeem',
      cancelLabel: 'Go back',
    }),
    title:
      redeemed.length > 0
        ? 'Redeem and hand back the jewellery?'
        : `Record a Payment of ${formatINR(payment.amount)}${payment.allocations.some((a) => a.discount > 0) ? ' cash and Discount' : ''}?`,
    body: (
      <>
        {redeemed.map((p) => (
          <p key={p.mortgage_id}>
            <RedeemedInFull name={p.mortgage_name} closure={p.closure} />
          </p>
        ))}
        <Summary
          rows={[
            ['From', customerName],
            ...dateRows,
            ['Method', method],
            ...payment.allocations.map((a): [string, string] => [
              names.get(a.mortgage_id) ?? '',
              `${formatINR(a.amount)} cash${a.discount ? ` + ${formatINR(a.discount)} Discount` : ''}` +
                (redeemed.some((p) => p.mortgage_id === a.mortgage_id) ? ' · Redeems it' : ''),
            ]),
          ]}
        />
      </>
    ),
  }
}

/** The date row(s) the confirmation shows: a Grace Payment's both dates and what it lets
 *  off. */
export function confirmationDateRows(
  paidOn: string,
  receivedOn: string | null,
  letOff: number | null,
): [string, string][] {
  if (!receivedOn) return [['Received', formatDate(paidOn)]]
  return [
    ['Dated', formatDate(paidOn)],
    ['Received', formatDate(receivedOn)],
    ...(letOff !== null ? [['Grace', `${formatINR(letOff)} let off`] as [string, string]] : []),
  ]
}

/** Confirm a Discount over the limit (named if it could be read), listing each one. */
export const largeDiscountConfirmation = (
  limit: number | null,
  rows: [string, string][],
): ConfirmOptions => ({
  title: limit === null ? 'Confirm a Discount?' : `Confirm a Discount over ${formatINR(limit)}?`,
  body: <Summary rows={rows} />,
  confirmLabel: 'Continue',
})

/** Offer to reduce Discounts that are over what their Mortgages have left. */
export const reduceDiscountConfirmation = (rows: [string, string][]): ConfirmOptions => ({
  title: 'Reduce Discount to the remaining balance?',
  body: <Summary rows={rows} />,
  confirmLabel: 'Reduce and continue',
})
