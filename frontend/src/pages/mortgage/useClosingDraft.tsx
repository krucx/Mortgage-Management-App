import { useState } from 'react'
import type { Closure, Mortgage, PaymentMethod } from '../../api'
import { Summary, type ConfirmOptions } from '../../components/ConfirmDialog'
import { usePaymentMethods } from '../../components/usePaymentMethods'
import { useClosing, type Closing } from '../../components/useClosing'
import { formatDate, todayIso } from '../../format'
import { formatINR, rupeesToPaise } from '../../money'

export type ClosingKind = Closing['kind']

/** A Mortgage in a draft: what the confirmation names. The Customer is known when one
 *  Mortgage is closed from its own page. */
export type DraftMortgage = { id: number; name: string; customer?: { name: string } }

/** A form field as an input takes it. */
type Binding = {
  value: string
  onChange: (event: { target: { value: string } }) => void
}

type Closures = (mortgageId: number) => Closure | null | undefined

/**
 * The Lender's draft of a Closing of `mortgages` as a `kind` (Redeem, Waive off or
 * Forfeit): the fields every kind asks (date, note, method, reference, and an amount for
 * each Mortgage), when they make a Closing, the request body each kind sends, and the
 * confirmation it asks. It hands back bindings for the form's inputs and what useClosing
 * gives: the Preview, saving, and each Mortgage's Closure as the Preview has it.
 * `kind` is null until the Lender has chosen one.
 */
export function useClosingDraft({
  kind,
  mortgages,
  onSaved,
}: {
  kind: ClosingKind | null
  mortgages: DraftMortgage[]
  /** Given the Mortgages as they are once closed. */
  onSaved: (closed: Mortgage[]) => void
}) {
  const [on, setOn] = useState(todayIso())
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  // Each Mortgage's amount in rupees as typed: what the final Payment is for a Waive,
  // the Recovered Amount for a Forfeit. Kept apart, as they mean different things.
  const [waiveAmounts, setWaiveAmounts] = useState<Record<number, string>>({})
  const [forfeitAmounts, setForfeitAmounts] = useState<Record<number, string>>({})
  const methods = usePaymentMethods()

  const amounts = kind === 'forfeit' ? forfeitAmounts : waiveAmounts
  const setAmounts = kind === 'forfeit' ? setForfeitAmounts : setWaiveAmounts
  const entered = mortgages.length > 0 && mortgages.every((m) => (amounts[m.id] ?? '') !== '')
  const paymentReference = reference.trim() || null

  const closing: Closing | null =
    !kind || !on
      ? null
      : kind === 'redeem'
        ? {
            kind,
            redeem: {
              redeemed_on: on,
              method,
              reference: paymentReference,
              mortgage_ids: mortgages.map((m) => m.id),
            },
          }
        : !entered
          ? null
          : kind === 'waive'
            ? {
                kind,
                waive: {
                  waived_on: on,
                  method,
                  reference: paymentReference,
                  note,
                  mortgages: mortgages.map((m) => ({
                    mortgage_id: m.id,
                    amount_paid: rupeesToPaise(amounts[m.id]),
                  })),
                },
              }
            : {
                kind,
                forfeit: {
                  forfeited_on: on,
                  note,
                  mortgages: mortgages.map((m) => ({
                    mortgage_id: m.id,
                    recovered_amount: rupeesToPaise(amounts[m.id]),
                  })),
                },
              }

  const { closureOf, ...closed } = useClosing({
    closing,
    confirm: () =>
      confirmation({
        kind: kind ?? 'redeem',
        mortgages,
        on,
        note,
        method: methods?.[method] ?? '',
        reference: paymentReference,
        closureOf,
      }),
    saved: onSaved,
  })

  return {
    ...closed,
    closureOf,
    /** What saving would send; null while the fields don't make one. */
    closing,
    on: { value: on, onChange: (event) => setOn(event.target.value) } satisfies Binding,
    note: { value: note, onChange: (event) => setNote(event.target.value) } satisfies Binding,
    reference: {
      value: reference,
      onChange: (event) => setReference(event.target.value),
    } satisfies Binding,
    /** The final Payment's method, as PaymentMethodSelect takes it. */
    method: { value: method, onChange: setMethod },
    /** The payment method names, for the method's select. */
    methods,
    /** The amount field of one Mortgage. */
    amountOf: (mortgageId: number): Binding => ({
      value: amounts[mortgageId] ?? '',
      onChange: (event) => setAmounts({ ...amounts, [mortgageId]: event.target.value }),
    }),
    /** Whether a Waive takes any final Payment, so the method and reference are wanted. */
    paying: kind === 'waive' && mortgages.some((m) => rupeesToPaise(amounts[m.id] ?? '') > 0),
  }
}

/** The confirmation of a Closing: one Mortgage's own rows, or a row for each of several. */
function confirmation({
  kind,
  mortgages,
  on,
  note,
  method,
  reference,
  closureOf,
}: {
  kind: ClosingKind
  mortgages: DraftMortgage[]
  on: string
  note: string
  method: string
  reference: string | null
  closureOf: Closures
}): ConfirmOptions {
  const [first] = mortgages
  const many = mortgages.length > 1
  const subject = many ? `${mortgages.length} Mortgages` : first.name
  const reason = note.trim() || '—'
  const closures = mortgages.map((m) => closureOf(m.id))
  const sum = (amountOf: (closure: Closure | null | undefined) => number | null | undefined) =>
    closures.reduce<number>((total, closure) => total + (amountOf(closure) ?? 0), 0)
  const jewellery = (
    <p className="hint">
      Return the jewellery {!many && first.customer ? `to ${first.customer.name}` : 'for each'}.
    </p>
  )
  const rowPerMortgage = (describe: (closure: Closure | null | undefined) => string) =>
    mortgages.map((m, i): [string, string] => [m.name, describe(closures[i])])

  if (kind === 'waive') {
    const closure = closures[0]
    return {
      title: `Waive off ${subject}?`,
      body: (
        <>
          <Summary
            rows={
              many
                ? [
                    ['Waived on', formatDate(on)],
                    ...rowPerMortgage(
                      (c) =>
                        `Received ${formatINR(c?.payment_amount ?? 0)}, waived ${formatINR(c?.waived_amount ?? 0)}`,
                    ),
                    ['Total waived off', formatINR(sum((c) => c?.waived_amount))],
                    ['Reason', reason],
                  ]
                : [
                    ['Waived on', formatDate(on)],
                    [`Outstanding on ${formatDate(on)}`, formatINR(closure?.outstanding ?? 0)],
                    [
                      'Final Payment',
                      closure?.payment_amount
                        ? `${formatINR(closure.payment_amount)} · ${method}` +
                          (reference ? ` · ${reference}` : '')
                        : 'None',
                    ],
                    [
                      'Waived off',
                      <strong key="waived">{formatINR(closure?.waived_amount ?? 0)}</strong>,
                    ],
                    ['Reason', reason],
                  ]
            }
          />
          {jewellery}
        </>
      ),
      confirmLabel: 'Confirm Waiver',
    }
  }

  if (kind === 'redeem') {
    return {
      title: `Redeem ${subject}?`,
      body: (
        <>
          <Summary
            rows={
              many
                ? [
                    ['Redeemed on', formatDate(on)],
                    ...rowPerMortgage((c) => formatINR(c?.payment_amount ?? 0)),
                    ['Method', method + (reference ? ` · ${reference}` : '')],
                  ]
                : [
                    ['Redeemed on', formatDate(on)],
                    ['Final Payment', formatINR(closures[0]?.payment_amount ?? 0)],
                    ['Method', method + (reference ? ` · ${reference}` : '')],
                  ]
            }
          />
          {jewellery}
        </>
      ),
      confirmLabel: 'Confirm Redemption',
    }
  }

  const total = sum((c) => c?.profit_loss)
  return {
    title: `Forfeit ${subject}?`,
    body: (
      <Summary
        rows={
          many
            ? [
                ['Forfeited on', formatDate(on)],
                ...rowPerMortgage(
                  (c) =>
                    `Recovered ${formatINR(c?.recovered_amount ?? 0)} of ${formatINR(c?.outstanding ?? 0)}`,
                ),
                [total >= 0 ? 'Total profit' : 'Total loss', formatINR(Math.abs(total))],
              ]
            : [
                ['Forfeited on', formatDate(on)],
                [`Outstanding on ${formatDate(on)}`, formatINR(closures[0]?.outstanding ?? 0)],
                ['Recovered Amount', formatINR(closures[0]?.recovered_amount ?? 0)],
                ['Profit / loss', formatINR(closures[0]?.profit_loss ?? 0)],
                ['Note', reason],
              ]
        }
      />
    ),
    confirmLabel: 'Confirm Forfeiture',
    danger: true,
  }
}
