import type { ProjectedEvent, ProjectedPoint } from '../api'
import { formatDate } from '../format'
import { formatINR } from '../money'
import { formatRate } from '../terms'

export interface ChartSeries {
  label: string
  className: string // colours the lines and the key
  points: ProjectedPoint[]
}

const WIDTH = 640
const HEIGHT = 260
const PAD = { left: 74, right: 24, top: 50, bottom: 28 }
const DAY = 24 * 60 * 60 * 1000

const time = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`).getTime()

function eventLabel(event: ProjectedEvent): string {
  if (event.kind === 'capitalised') return `+${formatINR(event.amount)} capitalised`
  return event.terms ? `${formatRate(event.terms.monthly_rate_bps)} from here` : 'Terms change'
}

/**
 * A year ahead: each series' Redemption Amount (solid) and Principal (dashed), with
 * coming Term Changes and capitalisations marked on their dates.
 */
export function ProjectionChart({
  series,
  events,
}: {
  series: ChartSeries[]
  events: ProjectedEvent[]
}) {
  const first = series[0]?.points
  if (!first || first.length < 2) return null
  const start = time(first[0].on)
  const end = time(first[first.length - 1].on)
  const max = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.redemption_amount)))
  const x = (isoDate: string) =>
    PAD.left + ((time(isoDate) - start) / (end - start)) * (WIDTH - PAD.left - PAD.right)
  const y = (paise: number) => PAD.top + (1 - paise / max) * (HEIGHT - PAD.top - PAD.bottom)
  const line = (points: ProjectedPoint[], pick: (p: ProjectedPoint) => number) =>
    points.map((p) => `${x(p.on)},${y(pick(p))}`).join(' ')
  // Capitalisation adds to the Principal on one day: draw it as a step on that day,
  // not a slope between the monthly points either side.
  const capitalisedOn = events.filter((e) => e.kind === 'capitalised').map((e) => e.on)
  const principalLine = (points: ProjectedPoint[]) =>
    points
      .flatMap((point, i) => {
        const next = points[i + 1]
        const at = [`${x(point.on)},${y(point.principal)}`]
        const day =
          next && next.principal > point.principal
            ? capitalisedOn.find((on) => on > point.on && on <= next.on)
            : undefined
        if (day) at.push(`${x(day)},${y(point.principal)}`, `${x(day)},${y(next.principal)}`)
        return at
      })
      .join(' ')
  const ticks = [0, 0.5, 1].map((share) => Math.round(max * share))
  // The same event can come from several series: mark it once.
  const marked = events.filter(
    (event, index) =>
      events.findIndex((e) => e.on === event.on && e.kind === event.kind) === index &&
      time(event.on) > start &&
      time(event.on) <= end + DAY,
  )

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="The year ahead">
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
        {marked.map((event, index) => (
          <g key={`${event.on}-${event.kind}`} className={`marker ${event.kind}`}>
            <line x1={x(event.on)} x2={x(event.on)} y1={PAD.top - 4} y2={HEIGHT - PAD.bottom} />
            <text
              x={x(event.on)}
              y={PAD.top - 10 - (index % 3) * 13}
              textAnchor={x(event.on) > WIDTH * 0.7 ? 'end' : 'start'}
            >
              {eventLabel(event)}
            </text>
            <title>
              {formatDate(event.on)}: {eventLabel(event)}
            </title>
          </g>
        ))}
        {series.map((s) => (
          <g key={s.label} className={s.className}>
            <polyline points={principalLine(s.points)} className="series principal" />
            <polyline points={line(s.points, (p) => p.redemption_amount)} className="series" />
          </g>
        ))}
      </svg>
      <figcaption className="row">
        {series.map((s) => (
          <span key={s.label} className={`key ${s.className}`}>
            {s.label}
          </span>
        ))}
        <span className="hint">
          Solid: Redemption Amount · dashed: Principal
          {marked.length > 0 && ' · dotted: Term Changes and capitalisation'}
        </span>
      </figcaption>
    </figure>
  )
}
