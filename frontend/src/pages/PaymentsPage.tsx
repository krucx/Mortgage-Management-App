import { Fragment, useEffect, useState, type MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { api, PAYMENT_METHODS, type PaymentPage } from '../api'
import { Pager } from '../components/Pager'
import { PersonLink } from '../components/PersonLink'
import { useDebounced } from '../components/useDebounced'
import { formatDate } from '../format'
import { formatINR } from '../money'

/** All Payments received, newest first: the home page. */
export function PaymentsPage() {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounced(query)
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<PaymentPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  /** A click anywhere on a row opens the Payment, except on its own links. */
  function openRow(event: MouseEvent, paymentId: number) {
    if ((event.target as HTMLElement).closest('a, button')) return
    navigate(`/payments/${paymentId}`)
  }

  useEffect(() => {
    api
      .listPayments(page, debouncedQuery)
      .then(setResult)
      .catch((err: Error) => setError(err.message))
  }, [page, debouncedQuery])

  return (
    <section className="card wide">
      <div className="row spread">
        <h2>Payments</h2>
        <Link className="button" to="/payments/new">
          Record a Payment
        </Link>
      </div>
      <input
        autoFocus
        type="search"
        placeholder="Filter by Customer, Mortgage Name or reference"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setPage(1)
        }}
      />
      {error && <p className="status error">{error}</p>}
      {result && result.total === 0 ? (
        <p className="hint">{debouncedQuery ? 'No Payments match.' : 'No Payments yet.'}</p>
      ) : (
        result && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Mortgages</th>
                  <th>Method</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((payment) => (
                  <tr
                    key={payment.id}
                    className={`clickable${payment.voided ? ' voided' : ''}`}
                    title="Open this Payment"
                    onClick={(event) => openRow(event, payment.id)}
                  >
                    <td>
                      <Link to={`/payments/${payment.id}`}>{formatDate(payment.paid_on)}</Link>
                    </td>
                    <td>
                      <PersonLink person={payment.customer} />
                    </td>
                    <td>
                      {payment.mortgages.map((mortgage, index) => (
                        <Fragment key={mortgage.id}>
                          {index > 0 && ', '}
                          <Link to={`/mortgages/${mortgage.id}`}>{mortgage.name}</Link>
                        </Fragment>
                      ))}
                    </td>
                    <td>
                      {PAYMENT_METHODS[payment.method]}
                      {payment.reference && <span className="hint"> · {payment.reference}</span>}
                    </td>
                    <td className="num">
                      {payment.voided && <span className="badge status-forfeited">voided</span>}{' '}
                      {formatINR(payment.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      {result && (
        <Pager
          page={result.page}
          pageSize={result.page_size}
          total={result.total}
          shown={result.items.length}
          onPage={setPage}
        />
      )}
    </section>
  )
}
