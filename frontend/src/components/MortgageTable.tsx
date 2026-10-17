import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { MortgageRow, MortgageSort } from '../api'
import { formatDate } from '../format'
import { formatINR } from '../money'
import { PersonLink } from './PersonLink'
import { SortHeading } from './SortHeading'
import type { Sorting } from './useUrlSort'

export function MortgageTable({
  rows,
  showCustomer = true,
  sorting,
}: {
  rows: MortgageRow[]
  showCustomer?: boolean
  /** Sortable headings, when given. */
  sorting?: Sorting<MortgageSort>
}) {
  const heading = (
    column: MortgageSort,
    label: ReactNode,
    { num = false, firstDescending = false } = {},
  ) =>
    sorting ? (
      <SortHeading
        sorting={sorting}
        column={column}
        firstDescending={firstDescending}
        className={num ? 'num' : undefined}
      >
        {label}
      </SortHeading>
    ) : (
      <th className={num ? 'num' : undefined}>{label}</th>
    )
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {heading('name', 'Mortgage')}
            {showCustomer && heading('customer', 'Customer')}
            {heading('started', 'Started', { firstDescending: true })}
            {heading('lent', 'Principal lent', { num: true, firstDescending: true })}
            {heading('outstanding', 'Outstanding today', { num: true, firstDescending: true })}
            {heading('status', 'Status')}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <Link to={`/mortgages/${row.id}`}>{row.name}</Link>
              </td>
              {showCustomer && (
                <td>
                  <PersonLink person={row.customer} />
                </td>
              )}
              <td>{formatDate(row.start_date)}</td>
              <td className="num">{formatINR(row.amount_lent)}</td>
              <td className="num">{formatINR(row.outstanding_total)}</td>
              <td>
                <span className={`badge status-${row.status}`}>{row.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
