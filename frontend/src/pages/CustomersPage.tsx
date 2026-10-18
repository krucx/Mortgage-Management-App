import { useCallback, useState } from 'react'
import { Link } from 'react-router'
import { api, CUSTOMER_SORTS, type CustomerRow, type CustomerSort } from '../api'
import { SortHeading } from '../components/SortHeading'
import { useListPage } from '../components/useListPage'
import { useConfirm } from '../components/useConfirm'
import { useDebounced } from '../components/useDebounced'
import { useUrlFilters } from '../components/useUrlFilters'
import { PersonLink, PersonList } from '../components/PersonLink'
import { useSearch } from '../components/useSearch'
import type { Sort } from '../sort'

/** All Customers in a paginated table, filterable by name or phone, or to those with an
 * Active Mortgage. */
export function CustomersPage() {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounced(query)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirm, confirmDialog] = useConfirm()
  const referrers = useSearch(debouncedQuery).filter((hit) => hit.kind === 'referrer')
  // In the URL, so the narrowed list can be shared (e.g. from the Dashboard).
  const [searchParams, setFilters] = useUrlFilters()
  const activeOnly = searchParams.get('active') === 'true'
  const fetchPage = useCallback(
    (page: number, sort: Sort<CustomerSort> | null) =>
      api.listCustomers(page, debouncedQuery, { hasActiveMortgage: activeOnly, sort }),
    [debouncedQuery, activeOnly],
  )
  // A new filter starts at page 1; deleting a page's last row steps back a page.
  const {
    listed: result,
    sorting,
    error: listError,
    reload,
    pager,
  } = useListPage(CUSTOMER_SORTS, fetchPage, {
    resetOn: [debouncedQuery, activeOnly],
  })
  const error = actionError ?? listError

  async function remove(row: CustomerRow) {
    setActionError(null)
    try {
      const { referred } = await api.getCustomer(row.id)
      const confirmed = await confirm({
        title: `Delete ${row.name}?`,
        body: (
          <>
            <p>This cannot be undone.</p>
            {referred.length > 0 && (
              <p>
                {row.name} referred {referred.map((person) => person.name).join(', ')}. Their
                Referrer will be cleared.
              </p>
            )}
          </>
        ),
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        danger: true,
      })
      if (!confirmed) return
      await api.deleteCustomer(row.id)
      await reload()
    } catch (err) {
      setActionError((err as Error).message)
    }
  }

  return (
    <section className="card wide">
      <div className="row spread">
        <h2>Customers</h2>
        <Link className="button" to="/customers/new">
          New Customer
        </Link>
      </div>
      <input
        autoFocus
        type="search"
        placeholder="Filter by name or phone"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <label className="inline">
        <input
          type="checkbox"
          checked={activeOnly}
          onChange={(event) => setFilters({ active: event.target.checked ? 'true' : null })}
        />
        Only Customers with an Active Mortgage
      </label>
      {error && <p className="status error">{error}</p>}

      {result && result.total === 0 ? (
        <p className="hint">
          {debouncedQuery || activeOnly ? 'No Customers match.' : 'No Customers yet.'}
        </p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th aria-label="Photo" />
                <SortHeading sorting={sorting} column="name">
                  Name
                </SortHeading>
                <SortHeading sorting={sorting} column="phone">
                  Contact numbers
                </SortHeading>
                <SortHeading sorting={sorting} column="address">
                  Address
                </SortHeading>
                <SortHeading sorting={sorting} column="referrer">
                  Referred by
                </SortHeading>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {result?.items.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.photo_url ? (
                      <img src={row.photo_url} alt="" className="thumb" />
                    ) : (
                      <span className="thumb placeholder" />
                    )}
                  </td>
                  <td>
                    <Link to={`/customers/${row.id}`}>{row.name}</Link>
                  </td>
                  <td>
                    {row.phone_1}
                    {row.phone_2 && (
                      <>
                        <br />
                        {row.phone_2}
                      </>
                    )}
                  </td>
                  <td>{row.address || '—'}</td>
                  <td>{row.referrer ? <PersonLink person={row.referrer} /> : '—'}</td>
                  <td>
                    <div className="row nowrap">
                      <Link className="button secondary small" to={`/customers/${row.id}/edit`}>
                        Edit
                      </Link>
                      <button
                        type="button"
                        className="danger small"
                        onClick={() => remove(row)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pager}

      {referrers.length > 0 && (
        <>
          <h3>Matching Referrers</h3>
          <PersonList people={referrers} empty="" />
        </>
      )}
      {confirmDialog}
    </section>
  )
}
