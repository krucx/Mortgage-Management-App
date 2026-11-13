import type { GraceOffer } from '../../api'
import { formatDayMonth, todayIso } from '../../format'
import { GraceTip } from './GraceTip'

/** The date the Payment was received, with the Grace Period's hint under it. */
export function DateReceivedField({
  paidOn,
  onPaidOn,
  receivedOn,
  received,
  offers,
  names,
}: {
  paidOn: string
  onPaidOn: (date: string) => void
  receivedOn: string | null
  received: string
  offers: GraceOffer[]
  names: Map<number, string>
}) {
  // The Grace Period's hint goes under the date, outside its label.
  return (
    <div className="field">
      <label>
        Date received
        <input
          type="date"
          required
          max={todayIso()}
          value={paidOn}
          onChange={(event) => onPaidOn(event.target.value)}
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
            <GraceTip offers={offers} receivedOn={received} names={names} /> lets off something:
            choose a date under Last Accrual Date.
          </span>
        )
      )}
    </div>
  )
}
