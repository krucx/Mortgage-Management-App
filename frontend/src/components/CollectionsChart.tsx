import { useState } from 'react'
import type { MonthlyCollection } from '../api'
import { monthName } from '../format'
import { formatINR } from '../money'

const WIDTH = 640
const HEIGHT = 220
const PAD = { left: 74, right: 8, top: 28, bottom: 28 }
const GAP = 2 // surface between neighbouring bars
const RADIUS = 4 // rounded data end; the baseline end stays square

/** A bar from the baseline up to `top`, rounded only at the top. */
function barPath(x: number, width: number, top: number, base: number): string {
  const r = Math.min(RADIUS, width / 2, base - top)
  return (
    `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} ` +
    `H${x + width - r} Q${x + width},${top} ${x + width},${top + r} V${base} Z`
  )
}

/** The Payments received each month, oldest first. */
export function CollectionsChart({ months }: { months: MonthlyCollection[] }) {
  const [hovered, setHovered] = useState<number | null>(null)
  if (months.length === 0) return null
  const max = Math.max(1, ...months.map((m) => m.amount))
  const slot = (WIDTH - PAD.left - PAD.right) / months.length
  const base = HEIGHT - PAD.bottom
  const y = (paise: number) => PAD.top + (1 - paise / max) * (base - PAD.top)
  const ticks = [0, 0.5, 1].map((share) => Math.round(max * share))
  const shown = hovered === null ? null : months[hovered]

  return (
    <figure className="chart collections">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Payments received in each of the last 12 months"
        onMouseLeave={() => setHovered(null)}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} className="grid" />
            <text x={PAD.left - 6} y={y(tick) + 4} textAnchor="end">
              {formatINR(tick)}
            </text>
          </g>
        ))}
        {months.map((m, i) => {
          const x = PAD.left + i * slot
          const first = i === 0 || m.month.endsWith('-01')
          return (
            <g
              key={m.month}
              className={`bar${hovered === i ? ' hovered' : ''}`}
              tabIndex={0}
              aria-label={`${monthName(m.month)}: ${formatINR(m.amount)}`}
              onMouseEnter={() => setHovered(i)}
              onFocus={() => setHovered(i)}
              onBlur={() => setHovered(null)}
            >
              {/* The whole column is the hover target, not just the bar. */}
              <rect x={x} y={PAD.top} width={slot} height={base - PAD.top} className="hit" />
              {m.amount > 0 && (
                <path d={barPath(x + GAP / 2, slot - GAP, y(m.amount), base)} className="mark" />
              )}
              <text x={x + slot / 2} y={HEIGHT - 8} textAnchor="middle">
                {first ? monthName(m.month).replace(' 20', " '") : monthName(m.month, true)}
              </text>
            </g>
          )
        })}
        {shown && hovered !== null && (
          <text
            className="tooltip"
            x={Math.min(Math.max(PAD.left + (hovered + 0.5) * slot, PAD.left + 60), WIDTH - 60)}
            y={PAD.top - 10}
            textAnchor="middle"
          >
            {monthName(shown.month)}: {formatINR(shown.amount)}
          </text>
        )}
      </svg>
      <details className="chart-table">
        <summary className="hint">Show as a table</summary>
        <table>
          <tbody>
            {months.map((m) => (
              <tr key={m.month}>
                <th scope="row">{monthName(m.month)}</th>
                <td className="num">{formatINR(m.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
