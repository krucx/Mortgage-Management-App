import { useState } from 'react'
import { Link } from 'react-router'
import { CALL_LIST_SORTS, type CallListRow } from '../api'
import { MarkCalled } from '../components/CallNotes'
import { PersonLink } from '../components/PersonLink'
import { SortButton, SortHeading } from '../components/SortHeading'
import { useListPage } from '../components/useListPage'
import { formatPercent } from '../format'
import { sender } from '../messaging'
import { formatINR } from '../money'
import { lists } from '../requests'

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

function ContactLinks({ phone }: { phone: string }) {
  return (
    <span className="contact">
      <a href={`tel:+91${phone}`}>{phone}</a>
      <button type="button" className="link" onClick={() => sender.chat(phone)}>
        WhatsApp
      </button>
    </span>
  )
}

/** Today's Mortgages to phone about, worked out whenever the page opens. */
export function CallListPage() {
  // Sorted on the server across every page: each Customer's rows, then the Customers.
  const { listed, sorting, error, pager } = useListPage(CALL_LIST_SORTS, lists.callList())
  const groups = listed?.items ?? null
  const [noting, setNoting] = useState<number | null>(null) // the Mortgage being marked called

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
                              // Marking called makes the Call List stale itself.
                              setNoting(null)
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
      {pager}
    </section>
  )
}
