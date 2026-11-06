import type { ComingTermChange, ProjectedPoint } from '../api'
import { formatDate } from '../format'
import { describeTerms, formatRate } from '../terms'
import { smoothPath } from './chart'
import { type AxisLabel, ChartFrame } from './ChartFrame'

export interface ChartSeries {
  label: string
  className: string // colours the line and the key
  points: ProjectedPoint[]
}

/** A year ahead: the Outstanding of each series, with coming Term Changes marked. */
export function ProjectionChart({
  series,
  termChanges,
}: {
  series: ChartSeries[]
  termChanges: ComingTermChange[]
}) {
  const first = series[0]?.points
  if (!first || first.length < 2) return null
  const from = first[0].on
  const to = first[first.length - 1].on
  const max = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.outstanding)))
  const axis = [0, 3, 6, 9, 12].flatMap((months): AxisLabel[] => {
    const point = first.find((p) => p.months === months)
    if (!point) return []
    return [
      {
        on: point.on,
        label: months === 0 ? 'Today' : `+${months}m`,
        anchor: months === 12 ? 'end' : months === 0 ? 'start' : 'middle',
      },
    ]
  })
  // The same Term Change can come from several series: mark it once.
  const marked = termChanges.filter(
    (change, index) =>
      termChanges.findIndex((c) => c.on === change.on) === index &&
      change.on > from &&
      change.on <= to,
  )

  return (
    <figure className="chart">
      <ChartFrame
        label="Outstanding over the next 12 months"
        from={from}
        to={to}
        max={max}
        axis={axis}
        markers={marked.map((change) => ({
          on: change.on,
          label: `${formatRate(change.terms.monthly_rate_bps)} from ${formatDate(change.on)}`,
          title: `From ${formatDate(change.on)}: ${describeTerms(change.terms)}`,
        }))}
      >
        {({ x, y }) =>
          series.map((s) => (
            <path
              key={s.label}
              d={smoothPath(s.points.map((p) => [x(p.on), y(p.outstanding)]))}
              className={`series ${s.className}`}
            />
          ))
        }
      </ChartFrame>
      <figcaption className="row">
        {series.map((s) => (
          <span key={s.label} className={`key ${s.className}`}>
            {s.label}
          </span>
        ))}
        <span className="hint">Outstanding (the Interest to Date included)</span>
      </figcaption>
    </figure>
  )
}
