import { useEffect, useState } from 'react'
import { Link } from 'react-router'
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
                  <th aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {result.items.map((payment) => (
                  <tr key={payment.id} className={payment.voided ? 'voided' : undefined}>
                    <td>{formatDate(payment.paid_on)}</td>
                    <td>
                      <PersonLink person={payment.customer} />
                    </td>
                    <td>{payment.mortgage_names.join(', ')}</td>
                    <td>
                      {PAYMENT_METHODS[payment.method]}
                      {payment.reference && <span className="hint"> · {payment.reference}</span>}
                    </td>
                    <td className="num">
                      {payment.voided && <span className="badge status-forfeited">voided</span>}{' '}
                      {formatINR(payment.amount)}
                    </td>
                    <td>
                      <Link className="button secondary small" to={`/payments/${payment.id}`}>
                        Open
                      </Link>
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
