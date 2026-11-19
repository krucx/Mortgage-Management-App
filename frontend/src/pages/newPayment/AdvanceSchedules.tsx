import type { AdvanceSchedule, MortgagePreview } from '../../api'
import { formatDate } from '../../format'
import { formatINR } from '../../money'

/** Each Mortgage's Advance in the draft, part by part as the Preview replays it (with
 *  every part in place), and what that comes to. A refused Advance has no schedule: the
 *  Preview's refusal says why. */
export function AdvanceSchedules({
  previews,
  names,
}: {
  previews: MortgagePreview[]
  names: Map<number, string>
}) {
  const schedules = previews.flatMap((p) =>
    p.advance ? [{ mortgageId: p.mortgage_id, schedule: p.advance }] : [],
  )
  if (schedules.length === 0) return null
  return (
    <div className="stack advance-schedules">
      {schedules.map(({ mortgageId, schedule }) => (
        <section key={mortgageId} aria-label={`Advance on ${names.get(mortgageId) ?? ''}`}>
          <h3>
            Advance on {names.get(mortgageId)}:{' '}
            {formatINR(schedule.parts.reduce((sum, part) => sum + part.amount, 0))} over{' '}
            {schedule.parts.length} {schedule.parts.length === 1 ? 'month' : 'months'}
          </h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Accrual Date</th>
                  <th className="num">Part</th>
                  <th className="num">Month's interest</th>
                  <th className="num">Pays interest</th>
                  <th className="num">Pays Principal</th>
                  <th className="num">Principal after</th>
                  <th className="num">Unpaid interest after</th>
                </tr>
              </thead>
              <tbody>
                {schedule.parts.map((part) => (
                  <tr key={part.on} className={part.principal_paid ? 'warn' : undefined}>
                    <td>{formatDate(part.on)}</td>
                    <td className="num">{formatINR(part.amount)}</td>
                    <td className="num">{formatINR(part.interest)}</td>
                    <td className="num">{formatINR(part.interest_paid)}</td>
                    <td className="num">
                      {part.principal_paid ? formatINR(part.principal_paid) : '—'}
                    </td>
                    <td className="num">{formatINR(part.principal_after)}</td>
                    <td className="num">
                      {part.unpaid_interest_after ? formatINR(part.unpaid_interest_after) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Verdict schedule={schedule} />
        </section>
      ))}
    </div>
  )
}

function Verdict({ schedule }: { schedule: AdvanceSchedule }) {
  const { parts } = schedule
  switch (schedule.verdict) {
    case 'reduces_principal': {
      const reducing = parts.filter((part) => part.principal_paid)
      const by = reducing.reduce((sum, part) => sum + part.principal_paid, 0)
      return (
        <p className="status warning">
          {reducing.length} {reducing.length === 1 ? 'part' : 'parts'} would reduce Principal by{' '}
          {formatINR(by)} in all. You can still save.
        </p>
      )
    }
    case 'falls_short': {
      const short = parts.filter((part) => part.unpaid_interest_after).at(-1)!
      return (
        <p className="hint">
          The parts fall short of the interest: {formatINR(short.unpaid_interest_after)} would still
          be unpaid after {formatDate(short.on)}.
        </p>
      )
    }
    case 'exact':
      return <p className="status ok">Each part pays exactly its month's interest.</p>
  }
}
