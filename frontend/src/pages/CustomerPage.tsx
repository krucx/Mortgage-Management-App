import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api, type Customer } from '../api'
import { PeopleInline, PersonLink, PersonList } from '../components/PersonLink'
import { Photo } from '../components/Photo'

export function CustomerPage() {
  const id = Number(useParams().id)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .getCustomer(id)
      .then(setCustomer)
      .catch((err: Error) => setError(err.message))
  }, [id])

  if (error) return <p className="status error">{error}</p>
  if (!customer) return <p>Loading…</p>

  return (
    <section className="card">
      <div className="row spread">
        <h2>{customer.name}</h2>
        <Link className="button secondary" to={`/customers/${customer.id}/edit`}>
          Edit
        </Link>
      </div>

      {customer.shares_phone_with.length > 0 && (
        <p className="status warning">
          A contact number is also used by <PeopleInline people={customer.shares_phone_with} />
        </p>
      )}

      <div className="with-photo">
        <Photo url={customer.photo_url} alt={customer.name} />
        <dl>
          <dt>Address</dt>
          <dd>{customer.address || '—'}</dd>
          <dt>Contact numbers</dt>
          <dd>
            {customer.phone_1}
            {customer.phone_2 && `, ${customer.phone_2}`}
          </dd>
          <dt>Referred by</dt>
          <dd>{customer.referrer ? <PersonLink person={customer.referrer} /> : '—'}</dd>
        </dl>
      </div>

      <h3>Customers they referred</h3>
      <PersonList people={customer.referred} empty="Nobody yet." />
    </section>
  )
}
