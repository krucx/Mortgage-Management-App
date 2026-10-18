import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { PersonList } from '../components/PersonLink'
import { referrerQuery } from '../requests'
import { useServerState } from '../serverState'

export function ReferrerPage() {
  const id = Number(useParams().id)
  const { client } = useServerState()
  const { data: referrer, error } = useQuery(referrerQuery(client, id))

  if (!referrer) return error ? <p className="status error">{error.message}</p> : <p>Loading…</p>

  return (
    <section className="card">
      <h2>
        {referrer.name} <span className="badge">Referrer</span>
      </h2>
      <dl>
        <dt>Address</dt>
        <dd>{referrer.address || '—'}</dd>
        <dt>Phone</dt>
        <dd>{referrer.phone}</dd>
      </dl>
      <h3>Customers they referred</h3>
      <PersonList people={referrer.referred} empty="Nobody yet." />
    </section>
  )
}
