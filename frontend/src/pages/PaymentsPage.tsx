import { Fragment, useEffect, useState, type MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { api, PAYMENT_METHODS, PAYMENT_SORTS, type PaymentPage } from '../api'
import { Pager } from '../components/Pager'
import { PersonLink } from '../components/PersonLink'
import { SortHeading } from '../components/SortHeading'
import { useUrlSort } from '../components/useUrlSort'
import { useDebounced } from '../components/useDebounced'
import { useUrlFilters } from '../components/useUrlFilters'
import { formatDate, isMonth, todayIso } from '../format'
import { formatINR } from '../money'

const YEAR = /^\d{4}$/

/** When the Payments were received: any time, one month (YYYY-MM) or one year. */
type Period = { kind: 'any' } | { kind: 'month'; month: string } | { kind: 'year'; year: string }

/** The period in the page's URL (e.g. from the Dashboard's Interest collected in April). */
function periodIn(params: URLSearchParams): Period {
  const month = params.get('month') ?? ''
  const year = params.get('year') ?? ''
  if (isMonth(month)) return { kind: 'month', month }
  if (YEAR.test(year)) return { kind: 'year', year }
  return { kind: 'any' }
}

/** The last ten years, newest first, and `chosen` if it is older. */
function years(chosen: string): string[] {
  const now = Number(todayIso().slice(0, 4))
  const recent = Array.from({ length: 10 }, (_, i) => String(now - i))
  return recent.includes(chosen) ? recent : [...recent, chosen]
}

/** All Payments received, newest first, filterable by who, what and when. */
export function PaymentsPage() {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounced(query)
  const [page, setPage] = useState(1)
  // The filters live in the URL, so a narrowed list can be shared or bookmarked.
  const [searchParams, setFilters] = useUrlFilters()
  const period = periodIn(searchParams)
  const month = period.kind === 'month' ? period.month : undefined
  const year = period.kind === 'year' ? period.year : undefined
  const includeVoided = searchParams.get('include_voided') !== 'false'
  const sorting = useUrlSort(PAYMENT_SORTS, { onChange: () => setPage(1) })
  const { sort } = sorting
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
      .listPayments(page, debouncedQuery, {
        month,
        year,
        includeVoided,
        sort,
      })
      .then(setResult)
      .catch((err: Error) => setError(err.message))
  }, [page, debouncedQuery, month, year, includeVoided, sort])

  function choosePeriod(next: Period) {
    setFilters({
      month: next.kind === 'month' ? next.month : null,
      year: next.kind === 'year' ? next.year : null,
    })
    setPage(1)
  }

  function chooseIncludeVoided(include: boolean) {
    setFilters({ include_voided: include ? null : 'false' })
    setPage(1)
  }
  const thisMonth = todayIso().slice(0, 7)

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
      <div className="row">
        <label className="inline">
          Received
          <select
            value={period.kind}
            onChange={(event) => {
              const kind = event.target.value as Period['kind']
              choosePeriod(
                kind === 'month'
                  ? { kind, month: thisMonth }
                  : kind === 'year'
                    ? { kind, year: thisMonth.slice(0, 4) }
                    : { kind },
              )
            }}
          >
            <option value="any">at any time</option>
            <option value="month">in the month</option>
            <option value="year">in the year</option>
          </select>
        </label>
        {period.kind === 'month' && (
          <input
            type="month"
            aria-label="Month"
            required
            value={period.month}
            onChange={(event) =>
              isMonth(event.target.value) &&
              choosePeriod({ kind: 'month', month: event.target.value })
            }
          />
        )}
        {period.kind === 'year' && (
          <select
            aria-label="Year"
            value={period.year}
            onChange={(event) => choosePeriod({ kind: 'year', year: event.target.value })}
          >
            {years(period.year).map((year) => (
              <option key={year}>{year}</option>
            ))}
          </select>
        )}
        <label className="inline">
          <input
            type="checkbox"
            checked={includeVoided}
            onChange={(event) => chooseIncludeVoided(event.target.checked)}
          />
          Show Voided Payments
        </label>
      </div>
      {result && result.interest_paid != null && (
        <p>
          {result.total} Payment{result.total === 1 ? '' : 's'}, paying{' '}
          <strong>{formatINR(result.interest_paid)}</strong> of interest
          {includeVoided && ' (Voided ones paid none)'}
        </p>
      )}
      {error && <p className="status error">{error}</p>}
      {result && result.total === 0 ? (
        <p className="hint">
          {debouncedQuery || period.kind !== 'any' || !includeVoided
            ? 'No Payments match.'
            : 'No Payments yet.'}
        </p>
      ) : (
        result && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <SortHeading sorting={sorting} column="date" firstDescending>
                    Date
                  </SortHeading>
                  <SortHeading sorting={sorting} column="customer">
                    Customer
                  </SortHeading>
                  <SortHeading sorting={sorting} column="mortgages">
                    Mortgages
                  </SortHeading>
                  <SortHeading sorting={sorting} column="method">
                    Method
                  </SortHeading>
                  <SortHeading sorting={sorting} column="amount" firstDescending className="num">
                    Amount
                  </SortHeading>
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
                    <td>{formatDate(payment.paid_on)}</td>
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
