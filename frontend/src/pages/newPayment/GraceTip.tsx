import { Fragment } from 'react'
import type { GraceOffer } from '../../api'
import { Tip } from '../../components/ReasonTip'
import { formatDayMonth } from '../../format'
import { formatINR } from '../../money'
import type { Accrual } from './accrual'

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
export function GraceTip({
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
          Received {formatDayMonth(receivedOn)}, with a {days}-day Grace Period after each Accrual
          Date.
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

/** A last Accrual Date: yellow when the date received is within the Grace Period after
 *  it, gray when past it (plain with no Grace Period). */
export function AccrualDate({
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
