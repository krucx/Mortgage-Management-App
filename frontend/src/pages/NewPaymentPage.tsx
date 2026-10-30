import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import {
  type Customer,
  type MortgageRow,
  type Payment,
  type PaymentIn,
  type PaymentMethod,
  type Redemption,
} from '../api'
import { PreviewSection } from '../components/BeforeAfter'
import { Summary } from '../components/ConfirmDialog'
import { CustomerChooser } from '../components/CustomerChooser'
import { RedeemPaidOff } from '../components/RedeemPaidOff'
import { PaymentMethodSelect } from '../components/PaymentMethodSelect'
import { usePaymentMethods } from '../components/usePaymentMethods'
import { useProposedChange } from '../components/useProposedChange'
import { Owed, type Quote } from '../components/Owed'
import { useQuotes } from '../components/useQuotes'
import { formatDate, todayIso } from '../format'
import { formatINR, rupeesToPaise } from '../money'
import { allocateEqually, amountsFromPercentages, percentagesOf } from '../allocate'
import { changes, customerQuery, everyMortgageQuery, previews } from '../requests'
import { useLedgerChange, useServerState } from '../serverState'
import { tickedFirst } from '../sort'

type AllocationMode = 'equal' | 'amount' | 'percent'

/** A Mortgage Ready to Redeem can't take a Payment: it is offered for Redemption
 *  instead. */
const canTakePayment = (m: MortgageRow) => !m.ready_to_redeem

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
  const [totalText, setTotalText] = useState('')
  const [mode, setMode] = useState<AllocationMode>('equal')
  const [amountText, setAmountText] = useState<Record<number, string>>({})
  const [percentText, setPercentText] = useState<Record<number, string>>({})
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const methods = usePaymentMethods()
  const [reference, setReference] = useState('')
  const changeLedger = useLedgerChange()
  // After saving: Mortgages this Payment paid off, offered for Redemption.
  const [paidOff, setPaidOff] = useState<{ payment: Payment; mortgages: MortgageRow[] }>()

  // Each Active Mortgage's Outstanding on the Payment date (it may be back-dated).
  const { client } = useServerState()
  const listed = useQuery({
    ...everyMortgageQuery(client, { customerId: customer.id, status: 'active', asOf: paidOn }),
    enabled: paidOn !== '',
    placeholderData: (previous) => previous,
  })
  const mortgages = listed.data?.items ?? null
  // The ticked Mortgages: at first the preselected one (or all that can take a Payment);
  // when the list changes (another date), those still in it stay ticked.
  const [selection, setSelection] = useState<{ of: MortgageRow[] | null; ids: Set<number> }>({
    of: null,
    ids: new Set(),
  })
  if (mortgages && selection.of !== mortgages) {
    // (Set while rendering, as React allows for a component's own state.)
    const ids = mortgages.filter(canTakePayment).map((m) => m.id)
    setSelection({
      of: mortgages,
      ids: selection.of
        ? new Set(ids.filter((id) => selection.ids.has(id)))
        : new Set(preselected && ids.includes(preselected) ? [preselected] : ids),
    })
  }
  const selected = selection.ids
  const setSelected = (ids: Set<number>) => setSelection({ of: mortgages, ids })

  const payable = (mortgages ?? []).filter(canTakePayment)
  const awaitingRedemption = (mortgages ?? []).filter((m) => !canTakePayment(m))
  const chosen = payable.filter((m) => selected.has(m.id))
  const outstanding = chosen.map((m) => m.outstanding_total)
  const totalOutstanding = outstanding.reduce((a, b) => a + b, 0)
  const total = rupeesToPaise(totalText || '0')

  // What each one would take to Redeem on the Payment date, or why it can't be.
  const quoteOf = useQuotes(payable, paidOn)
  const quotes = chosen.map((m) => quoteOf(m.id))
  // The chosen Mortgages' Redemption Amounts, once every one of them has one.
  const redemptions = quotes.every((q) => typeof q === 'object') ? (quotes as Redemption[]) : null
  const redemptionTotal = redemptions?.reduce((sum, q) => sum + q.total, 0) ?? null
  // Why they can't all be paid in full: the first chosen one that has no quote.
  const unquotable = quotes.find((q) => typeof q === 'string')
  // The most each one can take: its Redemption Amount (paying all of it Redeems it), or
  // its Outstanding while that is loading or where there is none on the Payment date.
  const caps = quotes.map((quote, i) => (typeof quote === 'object' ? quote.total : outstanding[i]))

  const amounts: number[] | null =
    mode === 'equal'
      ? suggestEqually(total, caps)
      : mode === 'amount'
        ? chosen.map((m) => rupeesToPaise(amountText[m.id] || '0'))
        : amountsFromPercentages(
            total,
            chosen.map((m) => Number(percentText[m.id] || '0')),
            caps,
          )
  const allocated = amounts?.reduce((a, b) => a + b, 0) ?? 0

  const problems: string[] = []
  if (chosen.length === 0) problems.push('Choose at least one Mortgage.')
  if (total <= 0) problems.push('Enter the amount received.')
  if (mode === 'percent' && chosen.some((m) => Number(percentText[m.id] || '0') < 0))
    problems.push('Percentages cannot be negative.')
  if (amounts?.some((amount) => amount < 0)) problems.push('Allocations cannot be negative.')
  if (mode === 'percent' && amounts === null) problems.push('The percentages must add up to 100.')
  if (amounts && total > 0 && allocated !== total)
    problems.push(`The Allocations add up to ${formatINR(allocated)}, not ${formatINR(total)}.`)
  // Until each one's Redemption Amount is known, paying it in full can't be told apart.
  if (quotes.some((quote) => quote === undefined))
    problems.push('Working out the Redemption Amounts…')

  // The chosen Mortgages paid their whole Redemption Amount: paying it Redeems them.
  const redeeming = chosen.filter((m, i) => {
    const quote = quoteOf(m.id)
    return amounts !== null && typeof quote === 'object' && amounts[i] === quote.total
  })

  // What saving would send; previewed (and refused, if it would be) by the backend.
  const proposed: PaymentIn | null =
    problems.length || !amounts
      ? null
      : {
          customer_id: customer.id,
          paid_on: paidOn,
          amount: total,
          method,
          reference: reference.trim() || null,
          allocations: chosen
            .map((m, i) => ({ mortgage_id: m.id, amount: amounts[i] }))
            .filter((allocation) => allocation.amount > 0),
          redeeming: redeeming.map((m) => m.id),
        }

  /** Switching to a manual mode starts from the current equal Allocations. */
  function switchMode(next: AllocationMode) {
    const equal = suggestEqually(total, caps)
    if (next === 'amount' && equal)
      setAmountText(Object.fromEntries(chosen.map((m, i) => [m.id, String(equal[i] / 100)])))
    if (next === 'percent' && total > 0 && equal)
      setPercentText(
        Object.fromEntries(percentagesOf(equal, total).map((pct, i) => [chosen[i].id, String(pct)])),
      )
    setMode(next)
  }

  /** Each chosen Mortgage's whole Redemption Amount, by amount. */
  function fillRedemptionAmounts(redemptions: Redemption[], total: number) {
    setAmountText(Object.fromEntries(chosen.map((m, i) => [m.id, String(redemptions[i].total / 100)])))
    setTotalText(String(total / 100))
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
    confirm: (payment) => ({
      ...(redeeming.length > 0 && {
        confirmLabel: 'Redeem',
        cancelLabel: 'Go back',
      }),
      title:
        redeeming.length > 0
          ? 'Redeem and hand back the jewellery?'
          : `Record a Payment of ${formatINR(payment.amount)}?`,
      body: (
        <>
          {redeeming.map((m) => (
            <p key={m.id}>
              <RedeemedInFull name={m.name} quote={quoteOf(m.id)} />
            </p>
          ))}
          <Summary
            rows={[
              ['From', customer.name],
              ['Received', formatDate(paidOn)],
              [
                'Method',
                (methods?.[method] ?? '') + (reference.trim() ? ` · ${reference.trim()}` : ''),
              ],
              ...payment.allocations.map((a): [string, string] => [
                chosen.find((m) => m.id === a.mortgage_id)?.name ?? '',
                formatINR(a.amount) +
                  (redeeming.some((m) => m.id === a.mortgage_id) ? ' · Redeems it' : ' · paid'),
              ]),
            ]}
          />
        </>
      ),
    }),
    save: (asked) => changeLedger((client) => changes.recordPayment(client, asked)),
    saved: (payment) => {
      // Any it left Ready to Redeem are offered for Redemption.
      if (payment.ready_to_redeem.length)
        setPaidOff({ payment, mortgages: payment.ready_to_redeem })
      else navigate(`/payments/${payment.id}/receipt`)
    },
  })

  return (
    <>
      <form onSubmit={submit}>
        <div className="grid-3">
          <label>
            Date received
            <input
              type="date"
              required
              max={todayIso()}
              value={paidOn}
              onChange={(event) => setPaidOn(event.target.value)}
            />
          </label>
          <label>
            Amount received (₹)
            <input
              type="number"
              required
              min="0.01"
              step="0.01"
              value={totalText}
              onChange={(event) => setTotalText(event.target.value)}
            />
            {chosen.length > 0 && (
              <button
                type="button"
                className="link"
                onClick={() => setTotalText(String(totalOutstanding / 100))}
              >
                The full Outstanding on the chosen Mortgages ({formatINR(totalOutstanding)})
              </button>
            )}
            {chosen.length > 0 && (
              <button
                type="button"
                className="link"
                disabled={!redemptions || redemptionTotal === null}
                onClick={() =>
                  redemptions &&
                  redemptionTotal !== null &&
                  fillRedemptionAmounts(redemptions, redemptionTotal)
                }
              >
                Pay the full Redemption Amount
                {redemptionTotal !== null && ` (${formatINR(redemptionTotal)})`}
              </button>
            )}
            {chosen.length > 0 && unquotable && (
              <span className="hint">Can't pay it in full: {unquotable}</span>
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
                    <th className="num">Outstanding on {formatDate(paidOn)}</th>
                    <th className="num">To redeem on {formatDate(paidOn)}</th>
                    {mode === 'percent' && <th className="num">%</th>}
                    <th className="num">Allocation</th>
                  </tr>
                </thead>
                <tbody>
                  {/* The ticked ones first, so the Mortgages being paid are together. */}
                  {tickedFirst(payable, selected).map((m) => {
                    const index = chosen.findIndex((c) => c.id === m.id)
                    const amount = index >= 0 && amounts ? amounts[index] : null
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
                        <td className="num">{formatINR(m.outstanding_total)}</td>
                        <td className="num">
                          <Owed quote={quoteOf(m.id)} />
                        </td>
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
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="hint">
            Within each Mortgage the Allocation pays unpaid interest first, then Principal.
          </p>
          {/* They take only their Redemption's final Payment, made on the Redeem tab. */}
          {awaitingRedemption.length > 0 && (
            <p className="hint">
              <Link to="/closures">
                {awaitingRedemption.length === 1
                  ? "1 of this Customer's Mortgages is Ready to Redeem →"
                  : `${awaitingRedemption.length} of this Customer's Mortgages are Ready to Redeem →`}
              </Link>
            </p>
          )}
        </fieldset>

        <label>
          Reference (optional)
          <input
            placeholder="e.g. UPI transaction ID"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
          />
        </label>

        {total > 0 && problems.length > 0 && (
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
            {saving ? 'Saving…' : `Record Payment${total > 0 ? ` of ${formatINR(total)}` : ''}`}
          </button>
        </div>
        {(error ?? listed.error) && (
          <p className="status error">{error ?? listed.error?.message}</p>
        )}
        {confirmDialog}
      </form>
      {/* Its own form, so outside the Payment's: forms cannot nest. */}
      {paidOff && (
        <RedeemPaidOff
          payment={paidOff.payment}
          mortgages={paidOff.mortgages}
          onDone={() => navigate(`/payments/${paidOff.payment.id}/receipt`)}
        />
      )}
    </>
  )
}

/** What paying a Mortgage's whole Redemption Amount does, for the Redeem question. */
function RedeemedInFull({ name, quote }: { name: string; quote: Quote }) {
  if (typeof quote !== 'object') return null
  const charge =
    quote.part_month_charge > 0 ? `, including a ${quote.part_month_days}-day part-month charge` : ''
  return `This pays the full Redemption Amount of ${name} (${formatINR(quote.total)}${charge}).`
}
