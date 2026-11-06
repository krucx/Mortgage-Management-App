import type { SimulatedPayment, SimulatedPoint } from '../api'
import { formatDate } from '../format'
import { formatINR } from '../money'
import { ChartFrame } from './ChartFrame'

/** One Simulation's line: its Outstanding, with its planned Payments as dots. */
export interface SimulationLine {
  label: string // its Terms, when two are compared
  points: SimulatedPoint[]
  payments: SimulatedPayment[]
}

const CLASSES = ['outstanding', 'compared']

/** Each Simulation's Outstanding from its start, with the day it closes on marked. */
export function SimulationChart({
  lines,
  closedOn,
}: {
  lines: SimulationLine[]
  closedOn: string
}) {
  const all = lines.flatMap((line) => line.points)
  if (all.length < 2) return null
  const dates = all.map((p) => p.on).sort()
  const first = dates[0]
  const last = dates[dates.length - 1]
  const max = Math.max(1, ...all.map((p) => p.outstanding))

  return (
    <figure className="chart">
      <ChartFrame
        label={`Outstanding from ${formatDate(first)} to ${formatDate(last)}`}
        from={first}
        to={last}
        max={max}
        axis={[
          { on: first, label: formatDate(first), anchor: 'start' },
          { on: last, label: formatDate(last), anchor: 'end' },
        ]}
        // Not past the line's end: a plan may pay it off sooner
        markers={closedOn <= last ? [{ on: closedOn, label: `Closed on ${formatDate(closedOn)}` }] : []}
      >
        {({ x, y }) =>
          lines.map((line, index) => {
            const outstandingOn = new Map(line.points.map((p) => [p.on, p.outstanding]))
            return (
              <g key={index} className={CLASSES[index]}>
                <path
                  // Straight between the dates worked out: a curve would show figures it never owes.
                  d={line.points
                    .map((p, i) => `${i ? 'L' : 'M'}${x(p.on)},${y(p.outstanding)}`)
                    .join(' ')}
                  className={`series ${CLASSES[index]}`}
                />
                {line.payments.map((payment, i) => {
                  // Where the line stands at the end of that day, the Payment made
                  const after = outstandingOn.get(payment.on)
                  return after === undefined ? null : (
                    <circle
                      key={i}
                      cx={x(payment.on)}
                      cy={y(after)}
                      r={3.5}
                      className={`payment ${CLASSES[index]}`}
                    >
                      <title>
                        {formatINR(payment.amount)} paid on {formatDate(payment.on)}
                      </title>
                    </circle>
                  )
                })}
              </g>
            )
          })
        }
      </ChartFrame>
      <figcaption className="row">
        {lines.map((line, index) => (
          <span key={index} className={`key ${CLASSES[index]}`}>
            {lines.length > 1 ? `Outstanding, ${line.label}` : 'Outstanding'}
          </span>
        ))}
        <span className="hint">
          What would redeem it each day (the Interest to Date included)
          {lines.some((line) => line.payments.length) && '; each dot a planned Payment'}
        </span>
      </figcaption>
    </figure>
  )
}
