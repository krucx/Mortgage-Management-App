import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api, type Customer, type MortgagePage } from '../api'
import { History } from '../components/History'
import { MortgageTable } from '../components/MortgageTable'
import { Pager } from '../components/Pager'
import { PeopleInline, PersonLink, PersonList } from '../components/PersonLink'
import { Photo } from '../components/Photo'

export function CustomerPage() {
  const id = Number(useParams().id)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [active, setActive] = useState<MortgagePage | null>(null)
  const [activePage, setActivePage] = useState(1)
  const [closed, setClosed] = useState<MortgagePage | null>(null)
  const [closedPage, setClosedPage] = useState(1)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .getCustomer(id)
      .then(setCustomer)
      .catch((err: Error) => setError(err.message))
  }, [id])

  useEffect(() => {
    api
      .listMortgages(activePage, '', { customerId: id, status: 'active' })
      .then(setActive)
      .catch((err: Error) => setError(err.message))
  }, [id, activePage])

  // Redeemed and Forfeited, tucked away below the Active ones.
  useEffect(() => {
    api
      .listMortgages(closedPage, '', { customerId: id, closed: true })
      .then(setClosed)
      .catch((err: Error) => setError(err.message))
  }, [id, closedPage])

  const loadHistory = useCallback(() => api.customerHistory(id), [id])

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

      <div className="row spread">
        <h3>Mortgages</h3>
        <Link className="button small" to={`/mortgages/new?customer=${customer.id}`}>
          New Mortgage
        </Link>
      </div>
      {active === null || closed === null ? (
        <p>Loading…</p>
      ) : active.total + closed.total === 0 ? (
        <p className="hint">No Mortgages yet.</p>
      ) : (
        <>
          {active.total === 0 ? (
            <p className="hint">No Active Mortgages.</p>
          ) : (
            <PagedMortgages listed={active} onPage={setActivePage} />
          )}
          {closed.total > 0 && (
            <details className="tucked">
              <summary>Closed ({closed.total})</summary>
              <PagedMortgages listed={closed} onPage={setClosedPage} />
            </details>
          )}
        </>
      )}

      <h3>Customers they referred</h3>
      <PersonList people={customer.referred} empty="Nobody yet." />

      <h3>History</h3>
      <History load={loadHistory} showMortgage title={`History of ${customer.name}`} />
    </section>
  )
}

function PagedMortgages({
  listed,
  onPage,
}: {
  listed: MortgagePage
  onPage: (page: number) => void
}) {
  return (
    <>
      <MortgageTable rows={listed.items} showCustomer={false} />
      <Pager
        page={listed.page}
        pageSize={listed.page_size}
        total={listed.total}
        shown={listed.items.length}
        onPage={onPage}
      />
    </>
  )
}
