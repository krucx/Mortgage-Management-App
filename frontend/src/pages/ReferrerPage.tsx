import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { api, type StandaloneReferrer } from '../api'
import { PersonList } from '../components/PersonLink'

export function ReferrerPage() {
  const id = Number(useParams().id)
  const [referrer, setReferrer] = useState<StandaloneReferrer | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .getReferrer(id)
      .then(setReferrer)
      .catch((err: Error) => setError(err.message))
  }, [id])

  if (error) return <p className="status error">{error}</p>
  if (!referrer) return <p>Loading…</p>

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
