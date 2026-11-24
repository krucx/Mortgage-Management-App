import { useQuery } from '@tanstack/react-query'
import { useNumericId } from '../useNumericId'

import { NotLoaded } from '../components/NotLoaded'
import { PersonList } from '../components/PersonLink'
import { referrerQuery } from '../requests'
import { useServerState } from '../serverState'

export function ReferrerPage() {
  const id = useNumericId()
  const { client } = useServerState()
  const { data: referrer, error } = useQuery(referrerQuery(client, id))

  if (!referrer) return <NotLoaded error={error} missing={`Referrer ${id}`} />

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
