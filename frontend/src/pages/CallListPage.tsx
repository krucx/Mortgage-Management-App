import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api, type CallListGroup, type CallListPage, type CallListRow } from '../api'
import { MarkCalled } from '../components/CallNotes'
import { Pager } from '../components/Pager'
import { PersonLink } from '../components/PersonLink'
import { SortButton, SortHeading } from '../components/SortHeading'
import { useUrlSort } from '../components/useUrlSort'
import { formatPercent } from '../format'
import { showOrStepBack } from '../paging'
import { sortedBy, type Sort } from '../sort'
import { formatINR } from '../money'

/** Why a Mortgage is on the Call List, in words. */
function reasonsOf(row: CallListRow): string[] {
  return row.reasons.map((reason) => {
    switch (reason) {
      case 'months_unpaid':
        return `${row.months_unpaid} months unpaid`
      case 'loan_to_value':
        return `Loan-to-Value ${formatPercent(row.loan_to_value ?? 0)}`
      case 'accrues_today':
        return 'Accrues today'
    }
  })
}

// Sorted a page at a time, in the browser.
const SORTS = ['customer', 'mortgage', 'why', 'outstanding'] as const
type CallSort = (typeof SORTS)[number]

const ROW_VALUES: Record<CallSort, (row: CallListRow) => string | number> = {
  customer: () => 0, // a group's rows all have the same Customer
  mortgage: (row) => row.mortgage_name,
  why: (row) => row.months_unpaid,
  outstanding: (row) => row.outstanding,
}

/** Each Customer's rows sorted, and the groups by their first row (or by Customer). */
function sortedGroups(groups: CallListGroup[], sort: Sort<CallSort> | null): CallListGroup[] {
  const sorted = groups.map((group) => ({ ...group, rows: sortedBy(group.rows, sort, ROW_VALUES) }))
  return sortedBy(sorted, sort, {
    customer: (group) => group.customer.name,
    mortgage: (group) => ROW_VALUES.mortgage(group.rows[0]),
    why: (group) => ROW_VALUES.why(group.rows[0]),
    outstanding: (group) => ROW_VALUES.outstanding(group.rows[0]),
  })
}

function ContactLinks({ phone }: { phone: string }) {
  return (
    <span className="contact">
      <a href={`tel:+91${phone}`}>{phone}</a>
      <a href={`https://wa.me/91${phone}`} target="_blank" rel="noreferrer">
        WhatsApp
      </a>
    </span>
  )
}

/** Today's Mortgages to phone about, worked out whenever the page opens. */
export function CallListPage() {
  const [listed, setListed] = useState<CallListPage | null>(null)
  const [page, setPage] = useState(1)
  const sorting = useUrlSort(SORTS)
  const groups = listed && sortedGroups(listed.items, sorting.sort)
  const [error, setError] = useState<string | null>(null)
  const [noting, setNoting] = useState<number | null>(null) // the Mortgage being marked called

  const load = useCallback(() => {
    api
      .getCallList(page)
      .then((result) => showOrStepBack(result, setListed, setPage), (err: Error) => setError(err.message))
  }, [page])

  useEffect(load, [load])

  return (
    <section className="card wide">
      <h2>Call List</h2>
      <p className="hint">
        Active Mortgages with too many Months Unpaid, a high Loan-to-Value, or accruing today.
        The thresholds are in <Link to="/settings">Settings</Link>.
      </p>
      {error && <p className="status error">{error}</p>}
      {listed && listed.total > 0 && (
        <div className="row spread">
          <p>
            {listed.mortgages} Mortgage{listed.mortgages === 1 ? '' : 's'} for {listed.total}{' '}
            Customer{listed.total === 1 ? '' : 's'}
          </p>
          <SortButton sorting={sorting} column="customer">
            Sort by Customer
          </SortButton>
        </div>
      )}
      {groups === null ? (
        !error && <p>Loading…</p>
      ) : listed?.total === 0 ? (
        <p className="hint">Nobody to call today.</p>
      ) : (
        groups.map((group) => (
          <div key={group.customer.id} className="call-group">
            <div className="row spread">
              <strong>
                <PersonLink person={group.customer} />
              </strong>
              <span className="row">
                <ContactLinks phone={group.phone_1} />
                {group.phone_2 && <ContactLinks phone={group.phone_2} />}
              </span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <SortHeading sorting={sorting} column="mortgage">
                      Mortgage
                    </SortHeading>
                    <SortHeading sorting={sorting} column="why" firstDescending>
                      Why
                    </SortHeading>
                    <SortHeading
                      sorting={sorting}
                      column="outstanding"
                      firstDescending
                      className="num"
                    >
                      Outstanding
                    </SortHeading>
                    <th aria-label="Called" />
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => (
                    <tr key={row.mortgage_id} className={row.called ? 'called' : undefined}>
                      <td>
                        <Link to={`/mortgages/${row.mortgage_id}`}>{row.mortgage_name}</Link>
                      </td>
                      <td>{reasonsOf(row).join(' · ')}</td>
                      <td className="num">{formatINR(row.outstanding)}</td>
                      <td>
                        {noting === row.mortgage_id ? (
                          <MarkCalled
                            mortgageId={row.mortgage_id}
                            mortgageName={row.mortgage_name}
                            onSaved={() => {
                              setNoting(null)
                              load()
                            }}
                            onCancel={() => setNoting(null)}
                          />
                        ) : row.called ? (
                          <span className="hint">
                            Called
                            {row.called.note ? `: ${row.called.note}` : ''}{' '}
                            <button
                              type="button"
                              className="secondary small"
                              onClick={() => setNoting(row.mortgage_id)}
                            >
                              Again…
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="small"
                            onClick={() => setNoting(row.mortgage_id)}
                          >
                            Mark called…
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
      {listed && (
        <Pager
          page={listed.page}
          pageSize={listed.page_size}
          total={listed.total}
          shown={listed.items.length}
          onPage={setPage}
        />
      )}
    </section>
  )
}
