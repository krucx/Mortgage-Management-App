import { useState } from 'react'
import type { ComingMonth, MonthlyPayments } from '../api'
import { monthName } from '../format'
import { formatINR } from '../money'

const WIDTH = 640
const HEIGHT = 220
const PAD = { left: 74, right: 8, top: 28, bottom: 28 }
const GAP = 2 // surface between neighbouring bars
const RADIUS = 4 // rounded data end; the baseline end stays square
const DOT = 4 // radius of an interest-charged marker (8px across)

/** The scale's top: the amount rounded up to 1, 2 or 5 times a power of ten rupees, so
 *  the gridlines fall on round amounts. */
function roundUp(paise: number): number {
  const rupees = Math.max(1, paise / 100)
  const power = 10 ** Math.floor(Math.log10(rupees))
  const step = [1, 2, 5, 10].find((m) => m * power >= rupees) ?? 10
  return step * power * 100
}

/** A bar from the baseline up to `top`, rounded only at the top. */
function barPath(x: number, width: number, top: number, base: number): string {
  const r = Math.min(RADIUS, width / 2, base - top)
  return (
    `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} ` +
    `H${x + width - r} Q${x + width},${top} ${x + width},${top + r} V${base} Z`
  )
}

/** One column: a month received, or a coming month's estimate and interest charged. */
type Column =
  | { kind: 'received'; month: string; amount: number }
  | { kind: 'coming'; month: string; amount: number; interest: number }

function describe(column: Column): string {
  const name = monthName(column.month)
  return column.kind === 'received'
    ? `${name}: ${formatINR(column.amount)} received`
    : `${name}: about ${formatINR(column.amount)} (estimate), ${formatINR(column.interest)} interest charged`
}

/**
 * The Payments received each month, oldest first, continued by the coming months: the
 * estimated Payments (the Trend) and the interest the Active Mortgages will be charged
 * (exact).
 */
export function PaymentsByMonthChart({
  months,
  coming = [],
}: {
  months: MonthlyPayments[]
  coming?: ComingMonth[]
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const columns: Column[] = [
    ...months.map((m): Column => ({ kind: 'received', ...m })),
    ...coming.map(
      (m): Column => ({
        kind: 'coming',
        month: m.month,
        amount: m.payments_estimate,
        interest: m.interest_charged,
      }),
    ),
  ]
  if (columns.length === 0) return null
  const max = roundUp(
    Math.max(...columns.map((c) => Math.max(c.amount, c.kind === 'coming' ? c.interest : 0))),
  )
  const slot = (WIDTH - PAD.left - PAD.right) / columns.length
  const base = HEIGHT - PAD.bottom
  const y = (paise: number) => PAD.top + (1 - paise / max) * (base - PAD.top)
  const ticks = [0, 0.5, 1].map((share) => Math.round(max * share))
  const todayX = PAD.left + months.length * slot
  // With two years of months, every other one is named.
  const named = (i: number) => columns.length <= 12 || i % 2 === 0
  const shown = hovered === null ? null : columns[hovered]

  return (
    <figure className="chart payments-by-month">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={
          `Payments received in each of the last ${months.length} months` +
          (coming.length ? `, then estimates for the next ${coming.length}` : '')
        }
        onMouseLeave={() => setHovered(null)}
      >
        <defs>
          <pattern
            id="estimate-hatch"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="6" className="hatch" />
          </pattern>
        </defs>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} className="grid" />
            <text x={PAD.left - 6} y={y(tick) + 4} textAnchor="end">
              {formatINR(tick)}
            </text>
          </g>
        ))}
        {columns.map((column, i) => {
          const x = PAD.left + i * slot
          const first = i === 0 || column.month.endsWith('-01')
          return (
            <g
              key={column.month}
              className={`bar ${column.kind}${hovered === i ? ' hovered' : ''}`}
              tabIndex={0}
              aria-label={describe(column)}
              onMouseEnter={() => setHovered(i)}
              onFocus={() => setHovered(i)}
              onBlur={() => setHovered(null)}
            >
              {/* The whole column is the hover target, not just the bar. */}
              <rect x={x} y={PAD.top} width={slot} height={base - PAD.top} className="hit" />
              {column.amount > 0 && (
                <path
                  d={barPath(x + GAP / 2, slot - GAP, y(column.amount), base)}
                  className="mark"
                />
              )}
              {column.kind === 'coming' && column.interest > 0 && (
                <circle cx={x + slot / 2} cy={y(column.interest)} r={DOT} className="charged" />
              )}
              {named(i) && (
                <text x={x + slot / 2} y={HEIGHT - 8} textAnchor="middle">
                  {first ? monthName(column.month).replace(' 20', " '") : monthName(column.month, true)}
                </text>
              )}
            </g>
          )
        })}
        {coming.length > 0 && (
          <g className="today">
            <line x1={todayX} x2={todayX} y1={PAD.top - 6} y2={base} />
            {/* Out of the way of a tooltip, which uses the same line. */}
            {hovered === null && (
              <text x={todayX + 4} y={PAD.top - 10}>
                Coming months
              </text>
            )}
          </g>
        )}
        {shown && hovered !== null && (
          <text
            className="tooltip"
            x={Math.min(Math.max(PAD.left + (hovered + 0.5) * slot, PAD.left + 150), WIDTH - 150)}
            y={12}
            textAnchor="middle"
          >
            {describe(shown)}
          </text>
        )}
      </svg>
      {coming.length > 0 && (
        <figcaption className="row">
          <span className="key received">Received</span>
          <span className="key estimate">Payments, estimate (3-month average)</span>
          <span className="key charged">Interest charged on Active Mortgages (exact)</span>
        </figcaption>
      )}
      <details className="chart-table">
        <summary className="hint">Show as a table</summary>
        <table>
          <thead>
            <tr>
              <th>Month</th>
              <th className="num">Payments</th>
              {coming.length > 0 && <th className="num">Interest charged</th>}
            </tr>
          </thead>
          <tbody>
            {columns.map((column) => (
              <tr key={column.month}>
                <th scope="row">{monthName(column.month)}</th>
                <td className="num">
                  {column.kind === 'coming' ? `about ${formatINR(column.amount)}` : formatINR(column.amount)}
                </td>
                {coming.length > 0 && (
                  <td className="num">
                    {column.kind === 'coming' ? formatINR(column.interest) : '—'}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
