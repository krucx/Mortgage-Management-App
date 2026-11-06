import type { SimulatedPoint } from '../api'
import { formatDate } from '../format'
import { formatINR } from '../money'
import { time } from './chart'

const WIDTH = 640
const HEIGHT = 240
const PAD = { left: 74, right: 24, top: 44, bottom: 28 }

/** A Simulation's Outstanding from its start, with the day it closes on marked. */
export function SimulationChart({
  points,
  closedOn,
}: {
  points: SimulatedPoint[]
  closedOn: string
}) {
  if (points.length < 2) return null
  const first = points[0].on
  const last = points[points.length - 1].on
  const [start, end] = [time(first), time(last)]
  const max = Math.max(1, ...points.map((p) => p.outstanding))
  const x = (isoDate: string) =>
    PAD.left + ((time(isoDate) - start) / (end - start)) * (WIDTH - PAD.left - PAD.right)
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
        <path
          // Straight between the dates worked out: a curve would show figures it never owes.
          d={points.map((p, i) => `${i ? 'L' : 'M'}${x(p.on)},${y(p.outstanding)}`).join(' ')}
          className="series outstanding"
        />
      </svg>
      <figcaption className="row">
        <span className="key outstanding">Outstanding</span>
        <span className="hint">What would redeem it each day (the Interest to Date included)</span>
      </figcaption>
    </figure>
  )
}
