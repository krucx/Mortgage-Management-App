import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { api, MORTGAGE_SORTS, type Customer, type MortgagePage, type MortgageSort } from '../api'
import { History } from '../components/History'
import { MortgageTable } from '../components/MortgageTable'
import { PeopleInline, PersonLink, PersonList } from '../components/PersonLink'
import { Photo } from '../components/Photo'
import { useListPage } from '../components/useListPage'
import type { Sorting } from '../components/useUrlSort'
import { lists } from '../requests'

export function CustomerPage() {
  const id = Number(useParams().id)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const activeList = useListPage(
    MORTGAGE_SORTS,
    lists.mortgages({ customerId: id, status: 'active' }),
  )
  // Redeemed and Forfeited, tucked away below the Active ones.
  const closedList = useListPage(MORTGAGE_SORTS, lists.mortgages({ customerId: id, closed: true }), {
    sortParam: 'closed_sort',
  })
  const active = activeList.listed
  const closed = closedList.listed
  const listError = activeList.error ?? closedList.error

  useEffect(() => {
    api
      .getCustomer(id)
      .then(setCustomer)
      .catch((err: Error) => setError(err.message))
  }, [id])

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
      {listError ? (
        <p className="status error">{listError}</p>
      ) : active === null || closed === null ? (
        <p>Loading…</p>
      ) : active.total + closed.total === 0 ? (
        <p className="hint">No Mortgages yet.</p>
      ) : (
        <>
          {active.total === 0 ? (
            <p className="hint">No Active Mortgages.</p>
          ) : (
            <PagedMortgages list={activeList} listed={active} />
          )}
          {closed.total > 0 && (
            <details className="tucked">
              <summary>Closed ({closed.total})</summary>
              <PagedMortgages list={closedList} listed={closed} />
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

/** One of the Customer's lists of Mortgages, with its sortable headings and pager. */
function PagedMortgages({
  list,
  listed,
}: {
  list: { sorting: Sorting<MortgageSort>; pager: ReactNode }
  listed: MortgagePage
}) {
  return (
    <>
      <MortgageTable rows={listed.items} showCustomer={false} sorting={list.sorting} />
      {list.pager}
    </>
  )
}
