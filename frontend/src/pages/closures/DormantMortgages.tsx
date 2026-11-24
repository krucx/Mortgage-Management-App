import { Link } from 'react-router'
import { PersonLink } from '../../components/PersonLink'
import { SortHeading } from '../../components/SortHeading'
import type { useDormantList } from './useClosureLists'

/** Dormant Mortgages, owing nothing, to be Redeemed (ADR 0012). */
export function DormantMortgages({
  listed: dormant,
  sorting,
  pager,
}: ReturnType<typeof useDormantList>) {
  return (
    <>
      <h3>
        Dormant{' '}
        {dormant && dormant.total > 0 && <span className="badge count">{dormant.total}</span>}
      </h3>
      <p className="hint">
        Active Mortgages that owe nothing, so their jewellery should already have gone back: usually
        a recording slip. Once you have checked, Redeem them; no Payment is needed.
      </p>
      {dormant === null ? (
        <p>Loading…</p>
      ) : dormant.total === 0 ? (
        <p className="hint">None: every Active Mortgage owes something.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <SortHeading sorting={sorting} column="mortgage">
                  Mortgage
                </SortHeading>
                <SortHeading sorting={sorting} column="customer">
                  Customer
                </SortHeading>
                <th aria-label="Redeem" />
              </tr>
            </thead>
            <tbody>
              {dormant.items.map((mortgage) => (
                <tr key={mortgage.id}>
                  <td>
                    <Link to={`/mortgages/${mortgage.id}`}>{mortgage.name}</Link>
                  </td>
                  <td>
                    <PersonLink person={mortgage.customer} />
                  </td>
                  <td>
                    <Link className="button small" to={`/mortgages/${mortgage.id}/redeem`}>
                      Redeem…
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pager}
    </>
  )
}
