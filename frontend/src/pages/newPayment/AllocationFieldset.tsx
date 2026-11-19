import { Link } from 'react-router'
import type { GraceOffer, MortgageRow } from '../../api'
import { dayBefore, formatDate, formatDayMonth } from '../../format'
import { formatINR, paiseToRupees, rupeesToPaise } from '../../money'
import { tickedFirst } from '../../sort'
import { type AllocationMode, DEFAULT_ADVANCE_MONTHS, MAX_ADVANCE_MONTHS } from './allocation'
import { accrualOf } from './accrual'
import { AccrualDate } from './GraceTip'

type Texts = Record<number, string>

/** The Mortgages to pay and how the Payment is allocated across them: pick the ticked
 *  ones, the mode, and per Mortgage the amount, percentage, Discount, and any Advance
 *  with the months it is over. On a phone each Mortgage is a card of labelled fields. */
export function AllocationFieldset({
  mode,
  onSwitchMode,
  mortgages,
  payable,
  owingNothing,
  chosen,
  selected,
  onToggle,
  amounts,
  redeemed,
  onPayUnpaidInterest,
  paidOn,
  receivedOn,
  received,
  onDateIt,
  graceDays,
  offers,
  offersKnown,
  amountText,
  onAmountText,
  percentText,
  onPercentText,
  discountText,
  onDiscountText,
  advanceText,
  onAdvance,
  monthsText,
  onMonthsText,
}: {
  mode: AllocationMode
  onSwitchMode: (mode: AllocationMode) => void
  mortgages: MortgageRow[] | null
  payable: MortgageRow[]
  owingNothing: MortgageRow[]
  chosen: MortgageRow[]
  selected: Set<number>
  onToggle: (id: number) => void
  amounts: number[] | null
  /** By chosen Mortgage: paid in full, so Redeemed by this Payment. */
  redeemed: boolean[]
  onPayUnpaidInterest: (mortgageId: number) => void
  paidOn: string
  receivedOn: string | null
  received: string
  /** Date the Payment `paidOn`, received on `received`: the Grace choice. */
  onDateIt: (paidOn: string, receivedOn: string) => void
  graceDays: number | null
  offers: GraceOffer[]
  offersKnown: boolean
  amountText: Texts
  onAmountText: (text: Texts) => void
  percentText: Texts
  onPercentText: (text: Texts) => void
  discountText: Texts
  onDiscountText: (text: Texts) => void
  advanceText: Texts
  onAdvance: (mortgageId: number, text: string) => void
  monthsText: Texts
  onMonthsText: (text: Texts) => void
}) {
  return (
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
              onChange={() => onSwitchMode(value)}
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
          <table className="allocations">
            <thead>
              <tr>
                <th aria-label="Include" />
                <th>Mortgage</th>
                <th>Last Accrual Date</th>
                <th className="num">Outstanding on {formatDate(paidOn)}</th>
                {mode === 'percent' && <th className="num">%</th>}
                <th className="num">Allocation</th>
                <th className="num">Discount</th>
                <th className="num">Advance</th>
                <th>Months</th>
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
                const advance = rupeesToPaise(advanceText[m.id])
                const months = Number(monthsText[m.id] ?? DEFAULT_ADVANCE_MONTHS)
                const closing = index >= 0 && redeemed[index]
                return (
                  <tr key={m.id}>
                    <td className="include">
                      <input
                        type="checkbox"
                        aria-label={`Include ${m.name}`}
                        checked={selected.has(m.id)}
                        onChange={() => onToggle(m.id)}
                      />
                    </td>
                    <td className="mortgage">
                      <Link to={`/mortgages/${m.id}`}>{m.name}</Link>
                    </td>
                    <td data-label="Last Accrual Date">
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
                          onClick={() => onDateIt(graceOn, received)}
                        >
                          Date it {formatDayMonth(graceOn)}
                          {offer && ` · ${formatINR(offer.let_off)} let off`}
                        </button>
                      )}
                    </td>
                    <td className="num" data-label={`Outstanding on ${formatDate(paidOn)}`}>
                      {formatINR(m.outstanding_total)}
                    </td>
                    {mode === 'percent' && (
                      <td className="num" data-label="%">
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
                              onPercentText({ ...percentText, [m.id]: event.target.value })
                            }
                          />
                        )}
                      </td>
                    )}
                    <td className="num" data-label="Allocation">
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
                            onAmountText({ ...amountText, [m.id]: event.target.value })
                          }
                        />
                      ) : amount === null ? (
                        '—'
                      ) : (
                        formatINR(amount)
                      )}
                      {/* Never the Interest to Date: paid now, the first part would pay
                          less interest and its surplus Principal. */}
                      {advance > 0 && m.unpaid_interest > 0 && amount !== m.unpaid_interest && (
                        <button
                          type="button"
                          className="link shortcut"
                          onClick={() => onPayUnpaidInterest(m.id)}
                        >
                          Pay the unpaid interest ({formatINR(m.unpaid_interest)})
                        </button>
                      )}
                    </td>
                    <td className="num" data-label="Discount">
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
                            onDiscountText({ ...discountText, [m.id]: event.target.value })
                          }
                        />
                      )}
                    </td>
                    <td className="num" data-label="Advance">
                      {index < 0 ? (
                        '—'
                      ) : (
                        <>
                          {/* Being closed, it has no interest to come; one already
                              entered can still be cleared. */}
                          <input
                            type="number"
                            className="small-input"
                            aria-label={`Advance for ${m.name}`}
                            min="0"
                            step="0.01"
                            disabled={closing && advance === 0}
                            title={
                              closing ? 'Paid in full here, so Redeemed: no Advance' : undefined
                            }
                            value={advanceText[m.id] ?? ''}
                            onChange={(event) => onAdvance(m.id, event.target.value)}
                          />
                          {!closing && m.month_interest > 0 && (
                            <button
                              type="button"
                              className="link shortcut"
                              title="Months × the interest its next Accrual Date charges"
                              onClick={() =>
                                onAdvance(m.id, paiseToRupees(months * m.month_interest))
                              }
                            >
                              Fill {months} × {formatINR(m.month_interest)}
                            </button>
                          )}
                        </>
                      )}
                    </td>
                    <td data-label="Months">
                      {index < 0 ? (
                        '—'
                      ) : (
                        <select
                          aria-label={`Months for ${m.name}`}
                          value={months}
                          onChange={(event) =>
                            onMonthsText({ ...monthsText, [m.id]: event.target.value })
                          }
                        >
                          {Array.from({ length: MAX_ADVANCE_MONTHS }, (_, i) => (
                            <option key={i + 1} value={i + 1}>
                              {i + 1}
                            </option>
                          ))}
                        </select>
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
        Within each Mortgage the Allocation pays unpaid interest first, then the Interest to Date,
        then Principal. Its Discount applies after the cash Allocation in the same order. An Advance
        is held for the Mortgage's interest: split equally over its next Accrual Dates after the
        date received, each part is applied only once its date arrives.
        {graceDays !== null &&
          ` An Accrual Date in yellow has the date received within the ${graceDays}-day Grace Period after it, and its Mortgage, if ticked, a button to date the Payment the day before; in gray, past it.`}
      </p>
      {owingNothing.map((m) => (
        <p key={m.id} className="hint">
          <Link to={`/mortgages/${m.id}/redeem`}>{m.name} owes nothing: Redeem it →</Link>
        </p>
      ))}
    </fieldset>
  )
}
