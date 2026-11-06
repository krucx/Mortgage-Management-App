import type { ReactNode } from 'react'
import { formatINR } from '../money'
import { time } from './chart'

const WIDTH = 640
const HEIGHT = 240
const PAD = { left: 74, right: 24, top: 44, bottom: 28 }

/** Where a date and an amount (paise) fall in the frame. */
export interface Scales {
  x: (isoDate: string) => number
  y: (paise: number) => number
}

/** A label on the date axis. */
export interface AxisLabel {
  on: string
  label: string
  anchor: 'start' | 'middle' | 'end'
}

/** A dashed vertical line on a date, labelled above the lines. */
export interface DatedMarker {
  on: string
  label: string
  title?: string // the tooltip
}

/** Gridlines at nought, half and the top of the scale, in whole rupees so none shows paise. */
export function Gridlines({
  max,
  y,
  left,
  right,
}: {
  max: number // the scale's top, in paise
  y: (paise: number) => number
  left: number // the x the lines start at; the ₹ labels sit just left of it
  right: number
}) {
  return [0, 0.5, 1]
    .map((share) => Math.round((max * share) / 100) * 100)
    .map((tick, i) => (
      <g key={i}>
        <line x1={left} x2={right} y1={y(tick)} y2={y(tick)} className="grid" />
        <text x={left - 6} y={y(tick) + 4} textAnchor="end">
          {formatINR(tick)}
        </text>
      </g>
    ))
}

/**
 * The frame of an Outstanding-over-dates chart: from `from` to `to` on x, nought to `max`
 * on y, with its ₹ gridlines, date axis labels and dated markers. The chart's own lines
 * are its children, drawn on the scales given.
 */
export function ChartFrame({
  label,
  from,
  to,
  max,
  axis,
  markers,
  children,
}: {
  label: string
  from: string
  to: string
  max: number
  axis: AxisLabel[]
  markers: DatedMarker[]
  children: (scales: Scales) => ReactNode
}) {
  const [start, end] = [time(from), time(to)]
  const x = (isoDate: string) =>
    PAD.left + ((time(isoDate) - start) / (end - start || 1)) * (WIDTH - PAD.left - PAD.right)
  const y = (paise: number) => PAD.top + (1 - paise / max) * (HEIGHT - PAD.top - PAD.bottom)

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={label}>
      <Gridlines max={max} y={y} left={PAD.left} right={WIDTH - PAD.right} />
      {axis.map((a, i) => (
        <text key={i} x={x(a.on)} y={HEIGHT - 8} textAnchor={a.anchor}>
          {a.label}
        </text>
      ))}
      {markers.map((marker, index) => (
        <g key={marker.on} className="marker">
          <line x1={x(marker.on)} x2={x(marker.on)} y1={PAD.top} y2={HEIGHT - PAD.bottom} />
          <text
            x={x(marker.on)}
            y={PAD.top - 8 - (index % 2) * 14} // above the lines, never on them
            textAnchor={x(marker.on) > WIDTH * 0.7 ? 'end' : 'start'}
          >
            {marker.label}
          </text>
          {marker.title && <title>{marker.title}</title>}
        </g>
      ))}
      {children({ x, y })}
    </svg>
  )
}
