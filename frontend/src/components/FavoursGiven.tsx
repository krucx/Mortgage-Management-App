import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { formatDate, formatDayMonth } from '../format'
import { formatINR } from '../money'
import { favoursGivenQuery } from '../requests'
import { useServerState } from '../serverState'

const KIND = { grace: 'Grace', discount: 'Discount', waived: 'Waived off' } as const

/** Every Grace, Discount and Waived Amount the Lender has given the Customer, still
 *  standing, newest first with their total; nothing at all when there are none. */
export function FavoursGiven({ customerId }: { customerId: number }) {
  const { client } = useServerState()
  const { data, error } = useQuery(favoursGivenQuery(client, customerId))

  if (error) {
    return (
      <>
        <h3>Favours Given</h3>
        <p className="status error">{error.message}</p>
      </>
    )
  }
  if (!data || data.favours.length === 0) return null
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
            {data.favours.map((favour, i) => (
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
              <td className="num">{formatINR(data.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  )
}
