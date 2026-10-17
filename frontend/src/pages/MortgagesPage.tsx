import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api, type MortgagePage } from '../api'
import { MortgageTable } from '../components/MortgageTable'
import { Pager } from '../components/Pager'
import { useDebounced } from '../components/useDebounced'

/** All Mortgages, newest first, filterable by Mortgage Name or Customer. */
export function MortgagesPage() {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounced(query)
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<MortgagePage | null>(null)
  const [error, setError] = useState<string | null>(null)


  useEffect(() => {
    api
      .listMortgages(page, debouncedQuery)
      .then(setResult)
      .catch((err: Error) => setError(err.message))
  }, [page, debouncedQuery])

  return (
    <section className="card wide">
      <div className="row spread">
        <h2>Mortgages</h2>
        <Link className="button" to="/mortgages/new">
          New Mortgage
        </Link>
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
