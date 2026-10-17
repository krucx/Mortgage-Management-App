import { useState, type ReactNode } from 'react'
import { useSearch } from './useSearch'

/** Find a Customer by name or phone and pick them. */
export function CustomerChooser({
  onChoose,
  footer,
}: {
  onChoose: (customerId: number) => void
  footer?: ReactNode
}) {
  const [query, setQuery] = useState('')
  const hits = useSearch(query).filter((hit) => hit.kind === 'customer')

  return (
    <div className="stack">
      <label>
        Customer
        <input
          autoFocus
          type="search"
          placeholder="Search by name or phone"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {hits.length > 0 && (
        <ul className="plain results">
          {hits.map((hit) => (
            <li key={hit.id}>
              <button type="button" className="result" onClick={() => onChoose(hit.id)}>
                {hit.photo_url ? (
                  <img src={hit.photo_url} alt="" className="thumb" />
                ) : (
                  <span className="thumb placeholder" />
                )}
                <span>
                  <strong>{hit.name}</strong>
                  <br />
                  <span className="hint">{hit.phone}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {footer}
    </div>
  )
}
