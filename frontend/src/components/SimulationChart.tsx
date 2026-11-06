import type { SimulatedPayment, SimulatedPoint } from '../api'
import { formatDate } from '../format'
import { formatINR } from '../money'
import { time } from './chart'

const WIDTH = 640
const HEIGHT = 240
const PAD = { left: 74, right: 24, top: 44, bottom: 28 }

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
  const [start, end] = [time(first), time(last)]
  const max = Math.max(1, ...all.map((p) => p.outstanding))
  const x = (isoDate: string) =>
    PAD.left + ((time(isoDate) - start) / (end - start || 1)) * (WIDTH - PAD.left - PAD.right)
  const y = (paise: number) => PAD.top + (1 - paise / max) * (HEIGHT - PAD.top - PAD.bottom)
  // In whole rupees, so none shows paise
  const ticks = [0, 0.5, 1].map((share) => Math.round((max * share) / 100) * 100)

  return (
    <figure className="chart">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Outstanding from ${formatDate(first)} to ${formatDate(last)}`}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} className="grid" />
            <text x={PAD.left - 6} y={y(tick) + 4} textAnchor="end">
              {formatINR(tick)}
            </text>
          </g>
        ))}
        <text x={x(first)} y={HEIGHT - 8} textAnchor="start">
          {formatDate(first)}
        </text>
        <text x={x(last)} y={HEIGHT - 8} textAnchor="end">
          {formatDate(last)}
        </text>
        {/* Not past the line's end: a plan may pay it off sooner */}
        {closedOn <= last && (
          <g className="marker">
            <line x1={x(closedOn)} x2={x(closedOn)} y1={PAD.top} y2={HEIGHT - PAD.bottom} />
            <text
              x={x(closedOn)}
              y={PAD.top - 8}
              textAnchor={x(closedOn) > WIDTH * 0.7 ? 'end' : 'start'}
            >
              Closed on {formatDate(closedOn)}
            </text>
          </g>
        )}
        {lines.map((line, index) => {
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
        })}
      </svg>
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
