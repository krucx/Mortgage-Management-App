import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api, type CallListGroup, type CallListRow } from '../api'
import { MarkCalled } from '../components/CallNotes'
import { PersonLink } from '../components/PersonLink'
import { formatPercent } from '../format'
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
  const [groups, setGroups] = useState<CallListGroup[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [noting, setNoting] = useState<number | null>(null) // the Mortgage being marked called

  const load = useCallback(() => {
    api.getCallList().then(setGroups, (err: Error) => setError(err.message))
  }, [])

  useEffect(load, [load])

  return (
    <section className="card wide">
      <h2>Call List</h2>
      <p className="hint">
        Active Mortgages with too many Months Unpaid, a high Loan-to-Value, or accruing today.
        The thresholds are in <Link to="/settings">Settings</Link>.
      </p>
      {error && <p className="status error">{error}</p>}
      {groups === null ? (
        !error && <p>Loading…</p>
      ) : groups.length === 0 ? (
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
                    <th>Mortgage</th>
                    <th>Why</th>
                    <th className="num">Outstanding</th>
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
    </section>
  )
}
