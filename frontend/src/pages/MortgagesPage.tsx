import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api, type MortgagePage, type MortgageStatus } from '../api'
import { MortgageTable } from '../components/MortgageTable'
import { Pager } from '../components/Pager'
import { useDebounced } from '../components/useDebounced'

/** All Mortgages, newest first, filterable by Mortgage Name or Customer. */
export function MortgagesPage() {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounced(query)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<MortgageStatus | ''>('active')
  const [result, setResult] = useState<MortgagePage | null>(null)
  const [error, setError] = useState<string | null>(null)


  useEffect(() => {
    api
      .listMortgages(page, debouncedQuery, { status: statusFilter || undefined })
      .then(setResult)
      .catch((err: Error) => setError(err.message))
  }, [page, debouncedQuery, statusFilter])

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
            ['forfeited', 'Forfeited'],
            ['', 'All'],
          ] as const
        ).map(([value, label]) => (
          <label key={label} className="inline">
            <input
              type="radio"
              name="status-filter"
              checked={statusFilter === value}
              onChange={() => {
                setStatusFilter(value)
                setPage(1)
              }}
            />
            {label}
          </label>
        ))}
      </div>
      <input
        autoFocus
        type="search"
        placeholder="Filter by Mortgage Name or Customer"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setPage(1)
        }}
      />
      {error && <p className="status error">{error}</p>}
      {result && result.total === 0 ? (
        <p className="hint">{debouncedQuery ? 'No Mortgages match.' : 'No Mortgages yet.'}</p>
      ) : (
        result && <MortgageTable rows={result.items} />
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
    </section>
  )
}
