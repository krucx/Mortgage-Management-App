import { useState } from 'react'
import { Link } from 'react-router'
import { ReferrerBadge } from '../components/PersonLink'
import { useSearch } from '../components/useSearch'
import { personPath } from '../paths'

export function CustomersPage() {
  const [query, setQuery] = useState('')
  const hits = useSearch(query)

  return (
    <section className="card">
      <div className="row spread">
        <h2>Customers</h2>
        <Link className="button" to="/customers/new">
          New Customer
        </Link>
      </div>
      <input
        autoFocus
        type="search"
        placeholder="Search by name or phone"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {query.trim() && hits.length === 0 && <p className="hint">No matches.</p>}
      <ul className="plain results">
        {hits.map((hit) => (
          <li key={`${hit.kind}-${hit.id}`}>
            <Link to={personPath(hit)} className="result">
              {hit.photo_url ? (
                <img src={hit.photo_url} alt="" className="thumb" />
              ) : (
                <span className="thumb placeholder" />
              )}
              <span>
                <strong>{hit.name}</strong>
                <ReferrerBadge person={hit} />
                <br />
                <span className="hint">{hit.phone}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
