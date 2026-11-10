import { useQuery } from '@tanstack/react-query'
import { Fragment, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import {
  type Closure,
  type Customer,
  type GraceOffer,
  type MortgageRow,
  type PaymentIn,
  type PaymentMethod,
} from '../api'
import { PreviewSection } from '../components/BeforeAfter'
import { Summary } from '../components/ConfirmDialog'
import { CustomerChooser } from '../components/CustomerChooser'
import { useConfirm } from '../components/useConfirm'
import { PaymentMethodSelect } from '../components/PaymentMethodSelect'
import { usePaymentMethods } from '../components/usePaymentMethods'
import { usePreview } from '../components/usePreview'
import { useProposedChange } from '../components/useProposedChange'
import { ReasonTip, Tip } from '../components/ReasonTip'
import {
  dayBefore,
  daysBetween,
  formatDate,
  formatDayMonth,
  formatDays,
  lastAccrualDate,
  todayIso,
} from '../format'
import { formatINR, paiseToRupees, rupeesToPaise } from '../money'
import { allocateEqually, amountsFromPercentages, percentagesOf } from '../allocate'
import { changes, customerQuery, everyMortgageQuery, previews, settings } from '../requests'
import { useLedgerChange, useServerState } from '../serverState'
import { tickedFirst } from '../sort'

type AllocationMode = 'equal' | 'amount' | 'percent'

/** Owing nothing (Dormant, ADR 0012), a Mortgage can't take a Payment, only be Redeemed. */
const owesSomething = (m: MortgageRow) => m.outstanding_total > 0

/**
 * Equal shares as a suggestion only, each up to its cap. More than all of them can take
 * is still split equally: whether a Payment is too large is for the preview to say, as
 * saving would.
 */
function suggestEqually(total: number, caps: number[]): number[] | null {
  return (
    allocateEqually(total, caps) ??
    allocateEqually(
      total,
      caps.map(() => Infinity),
    )
  )
}

/**
 * Record a lump-sum Payment: pick the Customer, choose their Mortgages, enter the total,
 * review the suggested Allocations, adjust them if needed, save.
 */
export function NewPaymentPage() {
  const [params, setParams] = useSearchParams()
  const customerId = Number(params.get('customer')) || undefined
  const preselected = Number(params.get('mortgage')) || undefined
  const { client } = useServerState()
  const customer = useQuery({ ...customerQuery(client, customerId ?? 0), enabled: !!customerId })
    .data

  return (
    <section className="card wide">
      <h2>Record a Payment</h2>
      {customerId && customer?.id === customerId ? (
        <>
          <div className="row spread">
            <span>
              From{' '}
              <Link to={`/customers/${customer.id}`}>
                <strong>{customer.name}</strong>
              </Link>{' '}
              <span className="hint">{customer.phone_1}</span>
            </span>
            <button type="button" className="secondary small" onClick={() => setParams({})}>
              Change Customer
            </button>
          </div>
          <PaymentForm customer={customer} preselected={preselected} />
        </>
      ) : (
        <CustomerChooser onChoose={(id) => setParams({ customer: String(id) })} />
      )}
    </section>
  )
}

function PaymentForm({ customer, preselected }: { customer: Customer; preselected?: number }) {
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
  // The ticked Mortgages: at first the preselected one (or all owing something);
  // when the list changes (another date), those still in it stay ticked.
  const [selection, setSelection] = useState<{ of: MortgageRow[] | null; ids: Set<number> }>({
    of: null,
    ids: new Set(),
  })
  if (mortgages && selection.of !== mortgages) {
    // (Set while rendering, as React allows for a component's own state.)
    const ids = mortgages.filter(owesSomething).map((m) => m.id)
    setSelection({
      of: mortgages,
      ids: selection.of
        ? new Set(ids.filter((id) => selection.ids.has(id)))
        : new Set(preselected && ids.includes(preselected) ? [preselected] : ids),
    })
  }
  const selected = selection.ids
  const setSelected = (ids: Set<number>) => setSelection({ of: mortgages, ids })
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

  const amounts: number[] | null =
    total === 0
      ? chosen.map(() => 0)
      : mode === 'equal'
      ? suggestEqually(total, outstanding)
      : mode === 'amount'
        ? chosen.map((m) => rupeesToPaise(amountText[m.id]))
        : amountsFromPercentages(
            total,
            chosen.map((m) => Number(percentText[m.id] || '0')),
            outstanding,
          )
  const allocated = amounts?.reduce((a, b) => a + b, 0) ?? 0

  const problems: string[] = []
  if (chosen.length === 0) problems.push('Choose at least one Mortgage.')
  if (total < 0 || discountTotal < 0) problems.push('Amounts cannot be negative.')
  if (total === 0 && discountTotal === 0) problems.push('Enter cash received or a Discount.')
  if (mode === 'percent' && chosen.some((m) => Number(percentText[m.id] || '0') < 0))
    problems.push('Percentages cannot be negative.')
  if (amounts?.some((amount) => amount < 0)) problems.push('Allocations cannot be negative.')
  if (total > 0 && mode === 'percent' && amounts === null)
    problems.push('The percentages must add up to 100.')
  if (amounts && total > 0 && allocated !== total)
    problems.push(`The Allocations add up to ${formatINR(allocated)}, not ${formatINR(total)}.`)
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
  // As the confirmation shows the date: a Grace Payment's both dates and what it lets off.
  const dateRows: [string, string][] = receivedOn
    ? [
        ['Dated', formatDate(paidOn)],
        ['Received', formatDate(receivedOn)],
        ...(letOff !== null ? [['Grace', `${formatINR(letOff)} let off`] as [string, string]] : []),
      ]
    : [['Received', formatDate(paidOn)]]

  /** Switching to a manual mode starts from the current equal Allocations. */
  function switchMode(next: AllocationMode) {
    const equal = suggestEqually(total, outstanding)
    if (next === 'amount' && equal)
      setAmountText(Object.fromEntries(chosen.map((m, i) => [m.id, paiseToRupees(equal[i])])))
    if (next === 'percent' && total > 0 && equal)
      setPercentText(
        Object.fromEntries(percentagesOf(equal, total).map((pct, i) => [chosen[i].id, String(pct)])),
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
    confirm: (payment, preview) => {
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
                ['From', customer.name],
                ...dateRows,
                [
                  'Method',
                  (methods?.[method] ?? '') + (reference.trim() ? ` · ${reference.trim()}` : ''),
                ],
                ...payment.allocations.map((a): [string, string] => [
                  chosen.find((m) => m.id === a.mortgage_id)?.name ?? '',
                  `${formatINR(a.amount)} cash${a.discount ? ` + ${formatINR(a.discount)} Discount` : ''}` +
                    (redeemed.some((p) => p.mortgage_id === a.mortgage_id)
                      ? ' · Redeems it'
                      : ''),
                ]),
              ]}
            />
          </>
        ),
      }
    },
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
        limit = (
          await queryClient.fetchQuery(settings.discountConfirmationLimit(client))
        ).discount_confirmation_limit
      } catch {
        // Still confirm (the Preview already says it is over the threshold); just
        // without naming it.
      }
      return confirmCap({
        title: limit === null ? 'Confirm a Discount?' : `Confirm a Discount over ${formatINR(limit)}?`,
        body: (
          <Summary
            rows={large.map((allocation): [string, string] => [
              chosen.find((m) => m.id === allocation.mortgage_id)?.name ?? '',
              formatINR(allocation.discount),
            ])}
          />
        ),
        confirmLabel: 'Continue',
      })
    },
    save: (asked) => changeLedger((client) => changes.recordPayment(client, asked)),
    saved: (payment) => navigate(`/payments/${payment.id}/receipt`),
  })

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!proposed || !canSave) return
    const mortgages = new Map((preview.previews?.mortgages ?? []).map((m) => [m.mortgage_id, m]))
    const capped = new Map(
      proposed.allocations.map((allocation) => [
        allocation.mortgage_id,
        Math.min(allocation.discount, mortgages.get(allocation.mortgage_id)?.discount_room ?? 0),
      ]),
    )
    const over = proposed.allocations.filter(
      (allocation) => (capped.get(allocation.mortgage_id) ?? 0) < allocation.discount,
    )
    if (over.length > 0) {
      const accepted = await confirmCap({
        title: 'Reduce Discount to the remaining balance?',
        body: (
          <Summary
            rows={over.map((allocation): [string, string] => [
              chosen.find((m) => m.id === allocation.mortgage_id)?.name ?? '',
              `${formatINR(allocation.discount)} → ${formatINR(capped.get(allocation.mortgage_id) ?? 0)}`,
            ])}
          />
        ),
        confirmLabel: 'Reduce and continue',
      })
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
          {/* The Grace Period's hint goes under the date, outside its label. */}
          <div className="field">
            <label>
              Date received
              <input
                type="date"
                required
                max={todayIso()}
                value={paidOn}
                onChange={(event) => {
                  setPaidOn(event.target.value)
                  setReceivedOn(null) // a date chosen by hand is an ordinary Payment's
                }}
              />
            </label>
            {receivedOn ? (
              <span className="hint">
                <span>
                  Dated {formatDayMonth(paidOn)}, received {formatDayMonth(receivedOn)}
                </span>
                {offers.length > 0 && (
                  <>
                    {' · '}
                    <GraceTip offers={offers} receivedOn={received} names={names} />
                  </>
                )}
              </span>
            ) : (
              offers.length > 0 && (
                <span className="hint">
                  <GraceTip offers={offers} receivedOn={received} names={names} /> lets off
                  something: choose a date under Last Accrual Date.
                </span>
              )
            )}
          </div>
          <label>
            Amount received (₹)
            <input
              type="number"
              required={discountTotal === 0}
              min="0"
              step="0.01"
              value={totalText}
              onChange={(event) => setTotalText(event.target.value)}
            />
            {chosen.length > 0 && (
              <button
                type="button"
                className="link"
                // Not on the last date's figures while the new date's rows load
                disabled={!!notRedeemable || listed.isPlaceholderData}
                onClick={fillOutstanding}
              >
                Pay the full Outstanding ({formatINR(totalOutstanding)})
              </button>
            )}
            {chosen.length > 0 && notRedeemable && (
              <span>
                <ReasonTip reason={notRedeemable}>Can't pay it in full</ReasonTip>
              </span>
            )}
          </label>
          <label>
            Method
            <PaymentMethodSelect methods={methods} value={method} onChange={setMethod} />
          </label>
        </div>

        <fieldset>
          <legend>Allocate across Mortgages</legend>
          <div className="row">
            {(
              [
                ['equal', 'Equally (suggested)'],
                ['amount', 'By amount'],
                ['percent', 'By percentage'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="inline">
                <input
                  type="radio"
                  name="allocation-mode"
                  checked={mode === value}
                  onChange={() => switchMode(value)}
                />
                {label}
              </label>
            ))}
          </div>

          {mortgages === null ? (
            <p>Loading…</p>
          ) : mortgages.length === 0 ? (
            <p className="hint">No Active Mortgages on {formatDate(paidOn)}.</p>
          ) : payable.length === 0 ? (
            <p className="hint">Nothing Outstanding on {formatDate(paidOn)}.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th aria-label="Include" />
                    <th>Mortgage</th>
                    <th>Last Accrual Date</th>
                    <th className="num">Outstanding on {formatDate(paidOn)}</th>
                    {mode === 'percent' && <th className="num">%</th>}
                    <th className="num">Allocation</th>
                    <th className="num">Discount</th>
                  </tr>
                </thead>
                <tbody>
                  {/* The ticked ones first, so the Mortgages being paid are together. */}
                  {tickedFirst(payable, selected).map((m) => {
                    const index = chosen.findIndex((c) => c.id === m.id)
                    const amount = index >= 0 && amounts ? amounts[index] : null
                    const accrual = accrualOf(m.start_date, received, graceDays)
                    // A ticked Mortgage within the Grace Period may be dated the day before.
                    const graceOn = index >= 0 && accrual?.within ? dayBefore(accrual.on) : null
                    const offer = offers.find((o) => o.paid_on === graceOn)
                    return (
                      <tr key={m.id}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Include ${m.name}`}
                            checked={selected.has(m.id)}
                            onChange={() => toggle(m.id)}
                          />
                        </td>
                        <td>
                          <Link to={`/mortgages/${m.id}`}>{m.name}</Link>
                        </td>
                        <td>
                          {accrual ? (
                            <AccrualDate
                              accrual={accrual}
                              receivedOn={received}
                              graceDays={graceDays}
                            />
                          ) : (
                            '—'
                          )}
                          {graceOn && (
                            <button
                              type="button"
                              className="grace-choice"
                              aria-pressed={receivedOn !== null && paidOn === graceOn}
                              disabled={offersKnown && !offer}
                              title={
                                offersKnown && !offer
                                  ? 'Dated then, this Payment lets off nothing'
                                  : undefined
                              }
                              onClick={() => {
                                setReceivedOn(received)
                                setPaidOn(graceOn)
                              }}
                            >
                              Date it {formatDayMonth(graceOn)}
                              {offer && ` · ${formatINR(offer.let_off)} let off`}
                            </button>
                          )}
                        </td>
                        <td className="num">{formatINR(m.outstanding_total)}</td>
                        {mode === 'percent' && (
                          <td className="num">
                            {index >= 0 && (
                              <input
                                type="number"
                                className="small-input"
                                aria-label={`Percentage for ${m.name}`}
                                min="0"
                                max="100"
                                step="0.01"
                                value={percentText[m.id] ?? ''}
                                onChange={(event) =>
                                  setPercentText({ ...percentText, [m.id]: event.target.value })
                                }
                              />
                            )}
                          </td>
                        )}
                        <td className="num">
                          {index < 0 ? (
                            '—'
                          ) : mode === 'amount' ? (
                            <input
                              type="number"
                              className="small-input"
                              aria-label={`Amount for ${m.name}`}
                              min="0"
                              step="0.01"
                              value={amountText[m.id] ?? ''}
                              onChange={(event) =>
                                setAmountText({ ...amountText, [m.id]: event.target.value })
                              }
                            />
                          ) : amount === null ? (
                            '—'
                          ) : (
                            formatINR(amount)
                          )}
                        </td>
                        <td className="num">
                          {index < 0 ? (
                            '—'
                          ) : (
                            <input
                              type="number"
                              className="small-input"
                              aria-label={`Discount for ${m.name}`}
                              min="0"
                              step="0.01"
                              value={discountText[m.id] ?? ''}
                              onChange={(event) =>
                                setDiscountText({ ...discountText, [m.id]: event.target.value })
                              }
                            />
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="hint">
            Within each Mortgage the Allocation pays unpaid interest first, then the Interest
            to Date, then Principal. Its Discount applies after the cash Allocation in the
            same order.
            {graceDays !== null &&
              ` An Accrual Date in yellow has the date received within the ${graceDays}-day Grace Period after it, and its Mortgage, if ticked, a button to date the Payment the day before; in gray, past it.`}
          </p>
          {owingNothing.map((m) => (
            <p key={m.id} className="hint">
              <Link to={`/mortgages/${m.id}/redeem`}>{m.name} owes nothing: Redeem it →</Link>
            </p>
          ))}
        </fieldset>

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

/** Which of the Payment's Mortgages a Grace choice graces: all of them, or some only. */
function gracedOf(offer: GraceOffer, names: Map<number, string>): string {
  const graced = offer.mortgages.filter((m) => m.graced)
  if (graced.length === offer.mortgages.length)
    return graced.length === 1
      ? (names.get(graced[0].mortgage_id) ?? '')
      : graced.length === 2
        ? 'both'
        : `all ${graced.length}`
  return `${graced.map((m) => names.get(m.mortgage_id)).join(', ')} only`
}

/** A Grace choice, e.g. "Date it 4 Nov · graces both · ₹660 let off" (with one Mortgage,
 *  just the date and what it lets off). */
const describeChoice = (offer: GraceOffer, names: Map<number, string>) =>
  [
    `Date it ${formatDayMonth(offer.paid_on)}`,
    ...(offer.mortgages.length > 1 ? [`graces ${gracedOf(offer, names)}`] : []),
    `${formatINR(offer.let_off)} let off`,
  ].join(' · ')

/** "Grace" with a tooltip working out the choices: each Mortgage's Accrual Date, then
 *  what each earlier date graces, the one gracing the most first. */
function GraceTip({
  offers,
  receivedOn,
  names,
}: {
  offers: GraceOffer[]
  receivedOn: string
  names: Map<number, string>
}) {
  const { days, mortgages } = offers[0]
  return (
    <Tip
      tone="grace"
      tip={
        <>
          Received {formatDayMonth(receivedOn)}, with a {days}-day Grace Period after each
          Accrual Date.
          <span className="grace-calc">
            {mortgages.map((m) => (
              <Fragment key={m.mortgage_id}>
                <span>{names.get(m.mortgage_id)}</span>
                <span>
                  {m.accrual_on
                    ? `Accrual Date ${formatDayMonth(m.accrual_on)}`
                    : 'No Accrual Date yet'}
                </span>
              </Fragment>
            ))}
          </span>
          {offers.map((offer, index) => (
            <span key={offer.paid_on} className="grace-choice-line">
              {index === 0 && offers.length > 1 ? 'To grace the most: ' : ''}
              {describeChoice(offer, names)}
            </span>
          ))}
        </>
      }
    >
      Grace
    </Tip>
  )
}

type Accrual = { on: string; within: boolean | null } // within: null with no Grace Period

/** A Mortgage's last Accrual Date by `receivedOn`, and whether that is within the Grace
 *  Period after it; null before its first. */
function accrualOf(start: string, receivedOn: string, graceDays: number | null): Accrual | null {
  const on = lastAccrualDate(start, receivedOn)
  if (!on) return null
  return { on, within: graceDays === null ? null : daysBetween(on, receivedOn) <= graceDays }
}

/** A last Accrual Date: yellow when the date received is within the Grace Period after
 *  it, gray when past it (plain with no Grace Period). */
function AccrualDate({
  accrual,
  receivedOn,
  graceDays,
}: {
  accrual: Accrual
  receivedOn: string
  graceDays: number | null
}) {
  const { on, within } = accrual
  if (within === null) return <span className="accrual">{formatDayMonth(on)}</span>
  return (
    <span
      className={`accrual ${within ? 'in-grace' : 'past-grace'}`}
      title={`${formatDayMonth(receivedOn)} is ${within ? 'within' : 'past'} the ${graceDays}-day Grace Period after ${formatDayMonth(on)}`}
    >
      {formatDayMonth(on)}
    </span>
  )
}

/** What paying a Mortgage's whole Outstanding does, for the Redeem question. */
function RedeemedInFull({ name, closure }: { name: string; closure: Closure }) {
  const charge =
    closure.interest_to_date > 0
      ? `, including ${formatDays(closure.interest_to_date_days)} of Interest to Date`
      : ''
  return `This pays the full Outstanding of ${name} (${formatINR(closure.outstanding)}${charge}).`
}
