import { Link } from 'react-router'
import { formatDate, formatDayMonth } from '../format'
import { formatINR } from '../money'
import { lists } from '../requests'
import { useListPage } from './useListPage'

const KIND = { grace: 'Grace', discount: 'Discount', waived: 'Waived off' } as const

const NO_SORTS = [] as const

/** Every Grace, Discount and Waived Amount the Lender has given the Customer, still
 *  standing, newest first a page at a time with the total of them all; nothing at all
 *  when there are none. */
export function FavoursGiven({ customerId }: { customerId: number }) {
  const { listed, error, pager } = useListPage(NO_SORTS, lists.favours(customerId))

  if (error) {
    return (
      <>
        <h3>Favours Given</h3>
        <p className="status error">{error}</p>
      </>
    )
  }
  if (!listed || listed.total === 0) return null
  return (
    <>
      <h3>Favours Given</h3>
      <div className="table-scroll">
        <table className="favours" aria-label="Favours Given">
          <thead>
            <tr>
              <th>Date</th>
              <th>Mortgage</th>
              <th>Kind</th>
              <th className="num">Amount let off</th>
            </tr>
          </thead>
          <tbody>
            {listed.items.map((favour, i) => (
              <tr key={i}>
                <td>
                  {formatDate(favour.on)}
                  {favour.received_on && ` (received ${formatDayMonth(favour.received_on)})`}
                </td>
                <td>
                  <Link to={`/mortgages/${favour.mortgage.id}`}>{favour.mortgage.description}</Link>
                </td>
                <td>{KIND[favour.kind]}</td>
                <td className="num">{formatINR(favour.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={3}>
                Total
              </th>
              <td className="num">{formatINR(listed.let_off)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {pager}
    </>
  )
}
