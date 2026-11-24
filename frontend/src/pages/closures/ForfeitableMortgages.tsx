import { Link } from 'react-router'
import { PersonLink } from '../../components/PersonLink'
import { SortHeading } from '../../components/SortHeading'
import { formatDate } from '../../format'
import { formatINR } from '../../money'
import { tickedFirst } from '../../sort'
import type { useForfeitableList } from './useClosureLists'

/** Active Mortgages still owing something, to tick for Forfeiting or Waiving off. */
export function ForfeitableMortgages({
  listed,
  sorting,
  pager,
  selected,
  onToggle,
}: ReturnType<typeof useForfeitableList> & {
  selected: Set<number>
  onToggle: (id: number) => void
}) {
  const forfeitable = listed?.items ?? []
  return (
    <>
      <h3>Forfeit or Waive off</h3>
      <p className="hint">
        Choose Active Mortgages to Forfeit, when the Customer has defaulted, or to Waive off, when
        you let off what is left and hand the jewellery back.
      </p>
      {listed === null ? (
        <p>Loading…</p>
      ) : forfeitable.length === 0 ? (
        <p className="hint">No Active Mortgages with anything Outstanding.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th aria-label="Choose" />
                <SortHeading sorting={sorting} column="name">
                  Mortgage
                </SortHeading>
                <SortHeading sorting={sorting} column="customer">
                  Customer
                </SortHeading>
                <SortHeading sorting={sorting} column="started" firstDescending>
                  Started
                </SortHeading>
                <SortHeading sorting={sorting} column="outstanding" firstDescending className="num">
                  Outstanding today
                </SortHeading>
              </tr>
            </thead>
            <tbody>
              {/* The ticked ones first, so the Mortgages to close are together. */}
              {tickedFirst(forfeitable, selected).map((m) => (
                <tr key={m.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Choose ${m.name}`}
                      checked={selected.has(m.id)}
                      onChange={() => onToggle(m.id)}
                    />
                  </td>
                  <td>
                    <Link to={`/mortgages/${m.id}`}>{m.name}</Link>
                  </td>
                  <td>
                    <PersonLink person={m.customer} />
                  </td>
                  <td>{formatDate(m.start_date)}</td>
                  <td className="num">{formatINR(m.outstanding_total)}</td>
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
