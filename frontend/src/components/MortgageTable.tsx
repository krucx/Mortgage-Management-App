import { Link } from 'react-router'
import type { MortgageRow } from '../api'
import { formatDate } from '../format'
import { formatINR } from '../money'
import { PersonLink } from './PersonLink'

export function MortgageTable({
  rows,
  showCustomer = true,
}: {
  rows: MortgageRow[]
  showCustomer?: boolean
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Mortgage</th>
            {showCustomer && <th>Customer</th>}
            <th>Started</th>
            <th className="num">Principal lent</th>
            <th className="num">Outstanding today</th>
            <th>Status</th>
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
