import { Fragment, useState, type MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { PAYMENT_SORTS } from '../api'
import { usePaymentMethods } from '../components/usePaymentMethods'
import { PersonLink } from '../components/PersonLink'
import { SortHeading } from '../components/SortHeading'
import { useListPage } from '../components/useListPage'
import { useDebounced } from '../components/useDebounced'
import { useUrlFilters } from '../components/useUrlFilters'
import { formatDate, isMonth, todayIso } from '../format'
import { formatINR } from '../money'
import { lists } from '../requests'

const YEAR = /^\d{4}$/

/** When the Payments were received: any time, one month (YYYY-MM) or one year. */
type Period = { kind: 'any' } | { kind: 'month'; month: string } | { kind: 'year'; year: string }

/** The last ten years, newest first, and `chosen` if it is older. */
function years(chosen: string): string[] {
  const now = Number(todayIso().slice(0, 4))
  const recent = Array.from({ length: 10 }, (_, i) => String(now - i))
  return recent.includes(chosen) ? recent : [...recent, chosen]
}

/** All Payments received, newest first, filterable by who, what and when. */
export function PaymentsPage() {
  const methods = usePaymentMethods()
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounced(query)
  // The filters live in the URL, so a narrowed list can be shared or bookmarked.
  const [searchParams, setFilters] = useUrlFilters()
  // The period in the URL (e.g. from the Dashboard's Interest collected in April): a
  // valid month wins, then a valid year.
  const monthParam = searchParams.get('month') ?? ''
  const yearParam = searchParams.get('year') ?? ''
  const month = isMonth(monthParam) ? monthParam : undefined
  const year = !month && YEAR.test(yearParam) ? yearParam : undefined
  const period: Period = month
    ? { kind: 'month', month }
    : year
      ? { kind: 'year', year }
      : { kind: 'any' }
  const includeVoided = searchParams.get('include_voided') !== 'false'
  // Any change of filter starts again at page 1.
  const {
    listed: result,
    sorting,
    error,
    pager,
  } = useListPage(
    PAYMENT_SORTS,
    lists.payments({ query: debouncedQuery, month, year, includeVoided }),
  )
  const navigate = useNavigate()

  /** A click anywhere on a row opens the Payment, except on its own links. */
  function openRow(event: MouseEvent, paymentId: number) {
    if ((event.target as HTMLElement).closest('a, button')) return
    navigate(`/payments/${paymentId}`)
  }

  function choosePeriod(next: Period) {
    setFilters({
      month: next.kind === 'month' ? next.month : null,
      year: next.kind === 'year' ? next.year : null,
    })
  }

  function chooseIncludeVoided(include: boolean) {
    setFilters({ include_voided: include ? null : 'false' })
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
        aria-label="Filter Payments"
        placeholder="Filter by Customer, Mortgage Name or reference"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
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
                      {methods?.[payment.method]}
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
      {pager}
    </section>
  )
}
