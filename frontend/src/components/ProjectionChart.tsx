import type { ComingTermChange, ProjectedPoint } from '../api'
import { formatDate } from '../format'
import { formatINR } from '../money'
import { describeTerms, formatRate } from '../terms'

export interface ChartSeries {
  label: string
  className: string // colours the line and the key
  points: ProjectedPoint[]
}

const WIDTH = 640
const HEIGHT = 240
const PAD = { left: 74, right: 24, top: 44, bottom: 28 }

const time = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`).getTime()
const owed = (point: ProjectedPoint) => point.principal + point.unpaid_interest

/** A smooth path through the points that never overshoots them (monotone cubic). */
function smoothPath(xy: [number, number][]): string {
  if (xy.length < 2) return ''
  const slopes = xy.slice(1).map(([x, y], i) => (y - xy[i][1]) / (x - xy[i][0]))
  const tangents = xy.map((_, i) => {
    if (i === 0) return slopes[0]
    if (i === xy.length - 1) return slopes[i - 1]
    const [before, after] = [slopes[i - 1], slopes[i]]
    return before * after <= 0 ? 0 : (2 * before * after) / (before + after)
  })
  let path = `M${xy[0][0]},${xy[0][1]}`
  for (let i = 0; i < xy.length - 1; i++) {
    const [x0, y0] = xy[i]
    const [x1, y1] = xy[i + 1]
    const third = (x1 - x0) / 3
    path += ` C${x0 + third},${y0 + tangents[i] * third} ${x1 - third},${y1 - tangents[i + 1] * third} ${x1},${y1}`
  }
  return path
}

/** A year ahead: the amount owed for each series, with coming Term Changes marked. */
export function ProjectionChart({
  series,
  termChanges,
}: {
  series: ChartSeries[]
  termChanges: ComingTermChange[]
}) {
  const first = series[0]?.points
  if (!first || first.length < 2) return null
  const start = time(first[0].on)
  const end = time(first[first.length - 1].on)
  const max = Math.max(1, ...series.flatMap((s) => s.points.map(owed)))
  const x = (isoDate: string) =>
    PAD.left + ((time(isoDate) - start) / (end - start)) * (WIDTH - PAD.left - PAD.right)
  const y = (paise: number) => PAD.top + (1 - paise / max) * (HEIGHT - PAD.top - PAD.bottom)
  const ticks = [0, 0.5, 1].map((share) => Math.round(max * share))
  // The same Term Change can come from several series: mark it once.
  const marked = termChanges.filter(
    (change, index) =>
      termChanges.findIndex((c) => c.on === change.on) === index &&
      time(change.on) > start &&
      time(change.on) <= end,
  )

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Amount owed over the next 12 months">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} className="grid" />
            <text x={PAD.left - 6} y={y(tick) + 4} textAnchor="end">
              {formatINR(tick)}
            </text>
          </g>
        ))}
        {[0, 3, 6, 9, 12].map((months) => {
          const point = first.find((p) => p.months === months)
          if (!point) return null
          return (
            <text
              key={months}
              x={x(point.on)}
              y={HEIGHT - 8}
              textAnchor={months === 12 ? 'end' : months === 0 ? 'start' : 'middle'}
            >
              {months === 0 ? 'Today' : `+${months}m`}
            </text>
          )
        })}
        {marked.map((change, index) => (
          <g key={change.on} className="marker">
            <line x1={x(change.on)} x2={x(change.on)} y1={PAD.top} y2={HEIGHT - PAD.bottom} />
            <text
              x={x(change.on)}
              y={PAD.top - 8 - (index % 2) * 14} // above the lines, never on them
              textAnchor={x(change.on) > WIDTH * 0.7 ? 'end' : 'start'}
            >
              {formatRate(change.terms.monthly_rate_bps)} from {formatDate(change.on)}
            </text>
            <title>
              From {formatDate(change.on)}: {describeTerms(change.terms)}
            </title>
          </g>
        ))}
        {series.map((s) => (
          <path
            key={s.label}
            d={smoothPath(s.points.map((p) => [x(p.on), y(owed(p))]))}
            className={`series ${s.className}`}
          />
        ))}
      </svg>
      <figcaption className="row">
        {series.map((s) => (
          <span key={s.label} className={`key ${s.className}`}>
            {s.label}
          </span>
        ))}
        <span className="hint">Amount owed (Principal and unpaid interest)</span>
      </figcaption>
    </figure>
  )
}
