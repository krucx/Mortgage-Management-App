import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api, MORTGAGE_SORTS, type Customer, type MortgagePage, type MortgageSort } from '../api'
import { History } from '../components/History'
import { MortgageTable } from '../components/MortgageTable'
import { Pager } from '../components/Pager'
import { PeopleInline, PersonLink, PersonList } from '../components/PersonLink'
import { Photo } from '../components/Photo'
import { useUrlSort, type Sorting } from '../components/useUrlSort'

export function CustomerPage() {
  const id = Number(useParams().id)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [active, setActive] = useState<MortgagePage | null>(null)
  const [activePage, setActivePage] = useState(1)
  const [closed, setClosed] = useState<MortgagePage | null>(null)
  const [closedPage, setClosedPage] = useState(1)
  const activeSorting = useUrlSort(MORTGAGE_SORTS, { onChange: () => setActivePage(1) })
  const closedSorting = useUrlSort(MORTGAGE_SORTS, {
    param: 'closed_sort',
    onChange: () => setClosedPage(1),
  })
  const activeSort = activeSorting.sort
  const closedSort = closedSorting.sort
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .getCustomer(id)
      .then(setCustomer)
      .catch((err: Error) => setError(err.message))
  }, [id])

  useEffect(() => {
    api
      .listMortgages(activePage, '', { customerId: id, status: 'active', sort: activeSort })
      .then(setActive)
      .catch((err: Error) => setError(err.message))
  }, [id, activePage, activeSort])

  // Redeemed and Forfeited, tucked away below the Active ones.
  useEffect(() => {
    api
      .listMortgages(closedPage, '', { customerId: id, closed: true, sort: closedSort })
      .then(setClosed)
      .catch((err: Error) => setError(err.message))
  }, [id, closedPage, closedSort])

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
            <PagedMortgages listed={active} onPage={setActivePage} sorting={activeSorting} />
          )}
          {closed.total > 0 && (
            <details className="tucked">
              <summary>Closed ({closed.total})</summary>
              <PagedMortgages listed={closed} onPage={setClosedPage} sorting={closedSorting} />
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
  sorting,
}: {
  listed: MortgagePage
  onPage: (page: number) => void
  sorting: Sorting<MortgageSort>
}) {
  return (
    <>
      <MortgageTable rows={listed.items} showCustomer={false} sorting={sorting} />
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
