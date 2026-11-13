import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { type Customer, type PaymentIn, type PaymentMethod } from '../../api'
import { PreviewSection } from '../../components/BeforeAfter'
import { useConfirm } from '../../components/useConfirm'
import { PaymentMethodSelect } from '../../components/PaymentMethodSelect'
import { usePaymentMethods } from '../../components/usePaymentMethods'
import { usePreview } from '../../components/usePreview'
import { useProposedChange } from '../../components/useProposedChange'
import { todayIso } from '../../format'
import { formatINR, paiseToRupees, rupeesToPaise } from '../../money'
import { percentagesOf } from '../../allocate'
import { changes, everyMortgageQuery, previews, settings } from '../../requests'
import { useLedgerChange, useServerState } from '../../serverState'
import { AllocationFieldset } from './AllocationFieldset'
import {
  type AllocationMode,
  allocationAmounts,
  allocationProblems,
  discountCaps,
  owesSomething,
  suggestEqually,
} from './allocation'
import { useSelection } from './useSelection'
import { AmountReceivedField } from './AmountReceivedField'
import {
  confirmationDateRows,
  largeDiscountConfirmation,
  paymentConfirmation,
  reduceDiscountConfirmation,
} from './confirmation'
import { DateReceivedField } from './DateReceivedField'

/** The Payment form for a chosen Customer: the date, amount and method, which Mortgages
 *  to pay and how to allocate across them, then the Preview and Save. */
export function PaymentForm({
  customer,
  preselected,
}: {
  customer: Customer
  preselected?: number
}) {
  const navigate = useNavigate()
  const [paidOn, setPaidOn] = useState(todayIso())
  // The Grace mark: when it was received, once dated earlier under the Grace Period.
  const [receivedOn, setReceivedOn] = useState<string | null>(null)
  const [totalText, setTotalText] = useState('')
  const [mode, setMode] = useState<AllocationMode>('equal')
  const [amountText, setAmountText] = useState<Record<number, string>>({})
  const [discountText, setDiscountText] = useState<Record<number, string>>({})
  const [percentText, setPercentText] = useState<Record<number, string>>({})
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const methods = usePaymentMethods()
  const [reference, setReference] = useState('')
  const [confirmCap, capDialog] = useConfirm()
  const changeLedger = useLedgerChange()

  // Each Active Mortgage's Outstanding on the Payment date (it may be back-dated).
  const { client, queryClient } = useServerState()
  const listed = useQuery({
    ...everyMortgageQuery(client, { customerId: customer.id, status: 'active', asOf: paidOn }),
    enabled: paidOn !== '',
    placeholderData: (previous) => previous,
  })
  const mortgages = listed.data?.items ?? null
  const [selected, setSelected] = useSelection(mortgages, preselected)
  // Whether the date received is within the Grace Period of each Mortgage's Accrual Date.
  const graceDays = useQuery(settings.gracePeriod(client)).data?.grace_period_days ?? null

  const payable = (mortgages ?? []).filter(owesSomething)
  const owingNothing = (mortgages ?? []).filter((m) => !owesSomething(m))
  const chosen = payable.filter((m) => selected.has(m.id))
  const outstanding = chosen.map((m) => m.outstanding_total)
  const totalOutstanding = outstanding.reduce((a, b) => a + b, 0)
  const total = rupeesToPaise(totalText)
  const discounts = chosen.map((m) => rupeesToPaise(discountText[m.id]))
  const discountTotal = discounts.reduce((a, b) => a + b, 0)

  // Why they can't all be paid in full: the first chosen one that can't be Redeemed then
  // (not yet known while the rows for a new date load).
  const notRedeemable = listed.isPlaceholderData
    ? undefined
    : chosen.find((m) => m.not_redeemable)?.not_redeemable

  const draft = { mode, total, discountTotal, chosen, outstanding, amountText, percentText }
  const amounts = allocationAmounts(draft)
  const problems = allocationProblems(draft, amounts)
  // What saving would send; previewed (and refused, if it would be) by the backend.
  const proposed: PaymentIn | null =
    problems.length || !amounts
      ? null
      : {
          customer_id: customer.id,
          paid_on: paidOn,
          received_on: receivedOn,
          amount: total,
          method,
          reference: reference.trim() || null,
          allocations: chosen
            .map((m, i) => ({ mortgage_id: m.id, amount: amounts[i], discount: discounts[i] }))
            .filter((allocation) => allocation.amount > 0 || allocation.discount > 0),
        }

  // When it was received: the date entered, unless dated earlier under the Grace Period.
  const received = receivedOn ?? paidOn
  // The earlier dates the Grace Period allows, drafted on the date it was received; not
  // shown while they load, so a date offered for another draft is never taken.
  const grace = usePreview(
    proposed && previews.graceOffers({ ...proposed, paid_on: received, received_on: null }),
  )
  const offers = (!grace.loading && grace.previews) || []
  // Whether the dates offered are known for this draft: then a date not among them lets
  // off nothing.
  const offersKnown = !!proposed && !grace.loading && !grace.error
  const taken = receivedOn ? offers.find((offer) => offer.paid_on === paidOn) : undefined
  // A Grace mark the draft has outgrown (its date now lets off nothing, or is no longer
  // offered) is dropped, going back to the date received.
  // (Set while rendering, as React allows for a component's own state.)
  if (receivedOn && proposed && !grace.loading && !grace.error && !taken) {
    setPaidOn(receivedOn)
    setReceivedOn(null)
  }
  const letOff = taken?.let_off ?? null
  const names = new Map(chosen.map((m) => [m.id, m.name]))
  const dateRows = confirmationDateRows(paidOn, receivedOn, letOff)

  /** Switching to a manual mode starts from the current equal Allocations. */
  function switchMode(next: AllocationMode) {
    const equal = suggestEqually(total, outstanding)
    if (next === 'amount' && equal)
      setAmountText(Object.fromEntries(chosen.map((m, i) => [m.id, paiseToRupees(equal[i])])))
    if (next === 'percent' && total > 0 && equal)
      setPercentText(
        Object.fromEntries(
          percentagesOf(equal, total).map((pct, i) => [chosen[i].id, String(pct)]),
        ),
      )
    setMode(next)
  }

  /** Each chosen Mortgage's whole Outstanding, by amount. */
  function fillOutstanding() {
    setAmountText(Object.fromEntries(chosen.map((m, i) => [m.id, paiseToRupees(outstanding[i])])))
    setTotalText(paiseToRupees(totalOutstanding))
    setDiscountText(Object.fromEntries(chosen.map((m) => [m.id, ''])))
    setMode('amount')
  }

  function toggle(id: number) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const { preview, submit, saving, canSave, error, confirmDialog } = useProposedChange({
    change: proposed,
    preview: (payment) => previews.payment(payment),
    confirm: (payment, preview) =>
      paymentConfirmation(payment, preview, {
        customerName: customer.name,
        dateRows,
        method: (methods?.[method] ?? '') + (reference.trim() ? ` · ${reference.trim()}` : ''),
        names,
      }),
    beforeConfirm: async (payment, previewed) => {
      const mortgages = new Map(
        (previewed.previews?.mortgages ?? []).map((m) => [m.mortgage_id, m]),
      )
      const large = payment.allocations.filter(
        (allocation) => mortgages.get(allocation.mortgage_id)?.over_threshold,
      )
      if (large.length === 0) return true
      let limit: number | null = null
      try {
        limit = (await queryClient.fetchQuery(settings.discountConfirmationLimit(client)))
          .discount_confirmation_limit
      } catch {
        // Still confirm (the Preview already says it is over the threshold); just
        // without naming it.
      }
      return confirmCap(
        largeDiscountConfirmation(
          limit,
          large.map((allocation): [string, string] => [
            names.get(allocation.mortgage_id) ?? '',
            formatINR(allocation.discount),
          ]),
        ),
      )
    },
    save: (asked) => changeLedger((client) => changes.recordPayment(client, asked)),
    saved: (payment) => navigate(`/payments/${payment.id}/receipt`),
  })

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!proposed || !canSave) return
    const { capped, over } = discountCaps(proposed, preview.previews?.mortgages ?? [])
    if (over.length > 0) {
      const accepted = await confirmCap(
        reduceDiscountConfirmation(
          over.map((allocation): [string, string] => [
            names.get(allocation.mortgage_id) ?? '',
            `${formatINR(allocation.discount)} → ${formatINR(capped.get(allocation.mortgage_id) ?? 0)}`,
          ]),
        ),
      )
      if (!accepted) return
      // Just updates the draft: the Lender saves it with Save, as any other edit.
      setDiscountText(
        Object.fromEntries(
          [...capped].map(([mortgageId, discount]) => [mortgageId, paiseToRupees(discount)]),
        ),
      )
      return
    }
    await submit(event)
  }

  return (
    <>
      <form onSubmit={handleSubmit}>
        <div className="grid-3">
          <DateReceivedField
            paidOn={paidOn}
            onPaidOn={(date) => {
              setPaidOn(date)
              setReceivedOn(null) // a date chosen by hand is an ordinary Payment's
            }}
            receivedOn={receivedOn}
            received={received}
            offers={offers}
            names={names}
          />
          <AmountReceivedField
            totalText={totalText}
            onTotalText={setTotalText}
            required={discountTotal === 0}
            fullOutstanding={chosen.length > 0 ? totalOutstanding : null}
            notRedeemable={notRedeemable}
            loading={listed.isPlaceholderData}
            onPayFull={fillOutstanding}
          />
          <label>
            Method
            <PaymentMethodSelect methods={methods} value={method} onChange={setMethod} />
          </label>
        </div>

        <AllocationFieldset
          mode={mode}
          onSwitchMode={switchMode}
          mortgages={mortgages}
          payable={payable}
          owingNothing={owingNothing}
          chosen={chosen}
          selected={selected}
          onToggle={toggle}
          amounts={amounts}
          paidOn={paidOn}
          receivedOn={receivedOn}
          received={received}
          onDateIt={(paid, from) => {
            setReceivedOn(from)
            setPaidOn(paid)
          }}
          graceDays={graceDays}
          offers={offers}
          offersKnown={offersKnown}
          amountText={amountText}
          onAmountText={setAmountText}
          percentText={percentText}
          onPercentText={setPercentText}
          discountText={discountText}
          onDiscountText={setDiscountText}
        />

        <label>
          Reference (optional)
          <input
            placeholder="e.g. UPI transaction ID"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
          />
        </label>

        {(total > 0 || discountTotal > 0) && problems.length > 0 && (
          <ul className="problems">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
        {proposed && (
          <>
            <h3>What changes</h3>
            <PreviewSection preview={preview} />
          </>
        )}
        <div className="row">
          <button type="submit" disabled={!canSave}>
            {saving
              ? 'Saving…'
              : `Record Payment${total > 0 ? ` of ${formatINR(total)}` : ''}${discountTotal > 0 ? ` with ${formatINR(discountTotal)} Discount` : ''}`}
          </button>
        </div>
        {(error ?? listed.error) && (
          <p className="status error">{error ?? listed.error?.message}</p>
        )}
        {confirmDialog}
        {capDialog}
      </form>
    </>
  )
}
