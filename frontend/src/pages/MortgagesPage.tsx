import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { MORTGAGE_SORTS, type MortgageStatus } from '../api'
import { MortgageTable } from '../components/MortgageTable'
import { useListPage } from '../components/useListPage'
import { useDebounced } from '../components/useDebounced'
import { useUrlFilters } from '../components/useUrlFilters'
import { isMonth } from '../format'
import { customerQuery, lists } from '../requests'
import { useServerState } from '../serverState'

const STATUSES: MortgageStatus[] = ['active', 'redeemed', 'waived', 'forfeited']

/** All Mortgages, newest first, filterable by Mortgage Name, Customer or their Primary
 * Number, status and the month they were closed in. */
export function MortgagesPage() {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounced(query)
  // The filters live in the URL, so a narrowed list can be shared or bookmarked: a
  // status (all = any status) and a month closed in (e.g. the Dashboard's Closed in
  // April). With only a month, any status; with neither, Active.
  const [searchParams, setFilters] = useUrlFilters()
  const closedParam = searchParams.get('closed_in') ?? ''
  const closedIn = isMonth(closedParam) ? closedParam : ''
  const statusParam = searchParams.get('status')
  const statusFilter: MortgageStatus | '' =
    statusParam === 'all'
      ? ''
      : (STATUSES.find((s) => s === statusParam) ?? (closedIn ? '' : 'active'))
  const closedFilter = statusFilter === 'active' ? '' : closedIn
  // One Customer's only (e.g. from the Call List's count of their Mortgages).
  const customerId = Number(searchParams.get('customer')) || undefined
  const { client } = useServerState()
  const customer = useQuery({ ...customerQuery(client, customerId ?? 0), enabled: !!customerId }).data
  // Any change of filter starts again at page 1.
  const {
    listed: result,
    sorting,
    error,
    pager,
  } = useListPage(
    MORTGAGE_SORTS,
    lists.mortgages({
      query: debouncedQuery,
      customerId,
      status: statusFilter || undefined,
      closedIn: closedFilter || undefined,
    }),
  )

  function setFilter(name: 'status' | 'closed_in', value: string) {
    setFilters({ [name]: value || null })
  }

  return (
    <section className="card wide">
      <div className="row spread">
        <h2>Mortgages</h2>
        <Link className="button" to="/mortgages/new">
          New Mortgage
        </Link>
      </div>
      <div className="row">
        {(
          [
            ['active', 'Active'],
            ['redeemed', 'Redeemed'],
            ['waived', 'Waived off'],
            ['forfeited', 'Forfeited'],
            ['', 'All'],
          ] as const
        ).map(([value, label]) => (
          <label key={label} className="inline">
            <input
              type="radio"
              name="status-filter"
              checked={statusFilter === value}
              onChange={() => setFilter('status', value || 'all')}
            />
            {label}
          </label>
        ))}
        {statusFilter !== 'active' && (
          <label className="inline">
            Closed in
            <input
              type="month"
              value={closedIn}
              onChange={(event) => setFilter('closed_in', event.target.value)}
            />
          </label>
        )}
      </div>
      {customerId && (
        <p className="row filter-note">
          <span>
            Only {customer ? <Link to={`/customers/${customerId}`}>{customer.name}</Link> : 'one Customer'}
            's Mortgages
          </span>
          <button type="button" className="secondary small" onClick={() => setFilters({ customer: null })}>
            Show every Customer
          </button>
        </p>
      )}
      <input
        autoFocus
        type="search"
        aria-label="Filter Mortgages"
        placeholder="Filter by Mortgage Name, Customer or Primary Number"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {error && <p className="status error">{error}</p>}
      {result && result.total === 0 ? (
        <p className="hint">
          {debouncedQuery || closedFilter || customerId ? 'No Mortgages match.' : 'No Mortgages yet.'}
        </p>
      ) : (
        result && <MortgageTable rows={result.items} sorting={sorting} />
      )}
      {pager}
    </section>
  )
}
