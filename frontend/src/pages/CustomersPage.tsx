import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api, type CustomerPage, type CustomerRow } from '../api'
import { Pager } from '../components/Pager'
import { useDebounced } from '../components/useDebounced'
import { PersonLink, PersonList } from '../components/PersonLink'
import { useSearch } from '../components/useSearch'

/** All Customers in a paginated table, filterable by name or phone. */
export function CustomersPage() {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounced(query)
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<CustomerPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const referrers = useSearch(debouncedQuery).filter((hit) => hit.kind === 'referrer')


  const load = useCallback(
    () =>
      api
        .listCustomers(page, debouncedQuery)
        .then((loaded) => {
          // Deleting the last row of a page leaves it empty; step back a page.
          if (loaded.items.length === 0 && page > 1) setPage(page - 1)
          else setResult(loaded)
        })
        .catch((err: Error) => setError(err.message)),
    [page, debouncedQuery],
  )

  useEffect(() => {
    load()
  }, [load])

  async function remove(row: CustomerRow) {
    setError(null)
    try {
      const { referred } = await api.getCustomer(row.id)
      const warning = referred.length
        ? `\n\n${row.name} referred ${referred.map((person) => person.name).join(', ')}. ` +
          'Their Referrer will be cleared.'
        : ''
      if (!window.confirm(`Delete ${row.name}? This cannot be undone.${warning}`)) return
      await api.deleteCustomer(row.id)
      await load()
    } catch (err) {
      setError((err as Error).message)
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
        onChange={(event) => {
          setQuery(event.target.value)
          setPage(1)
        }}
      />
      {error && <p className="status error">{error}</p>}

      {result && result.total === 0 ? (
        <p className="hint">{debouncedQuery ? 'No Customers match.' : 'No Customers yet.'}</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th aria-label="Photo" />
                <th>Name</th>
                <th>Contact numbers</th>
                <th>Address</th>
                <th>Referred by</th>
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

      {result && (
        <Pager
          page={result.page}
          pageSize={result.page_size}
          total={result.total}
          shown={result.items.length}
          onPage={setPage}
        />
      )}

      {referrers.length > 0 && (
        <>
          <h3>Matching Referrers</h3>
          <PersonList people={referrers} empty="" />
        </>
      )}
    </section>
  )
}
