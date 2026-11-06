// Lesson 2's build exercise, solved: copy to frontend/src/pages/TryPage.tsx and add
// <Route path="/try/meera" element={<TryPage />} /> to App.tsx. Then delete both again.
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { formatDate } from '../format'
import { formatINR } from '../money'
import { mortgageQuery } from '../requests'
import { useServerState } from '../serverState'

/** A throwaway page: what Meera's chain owes today. */
export function TryPage() {
  const { client } = useServerState()
  const { data: chain, error } = useQuery(mortgageQuery(client, 2))

  if (!chain) return error ? <p className="status error">{error.message}</p> : <p>Loading…</p>

  return (
    <section className="card">
      <h2>{chain.name}</h2>
      <dl className="summary">
        <div className="summary-row">
          <dt>Outstanding on {formatDate(chain.as_of)}</dt>
          <dd>
            <strong>{formatINR(chain.outstanding.total)}</strong>
          </dd>
        </div>
      </dl>
      <Link to={`/mortgages/${chain.id}`}>Back to the Mortgage</Link>
    </section>
  )
}
