import { Fragment, useState } from 'react'
import { Link } from 'react-router'
import { CALL_LIST_SORTS, type CallListGroup, type CallListRow } from '../api'
import { MarkCalled } from '../components/CallNotes'
import { PersonLink } from '../components/PersonLink'
import { SortHeading } from '../components/SortHeading'
import { useListPage } from '../components/useListPage'
import { ChatIcon } from '../components/WhatsApp'
import { formatPercent } from '../format'
import { sender } from '../messaging'
import { formatINR } from '../money'
import { lists } from '../requests'

type Reason = CallListRow['reasons'][number]

/** Each reason a Mortgage is listed, as a status marker: its short label and full wording. */
function reasonsOf(row: CallListRow): { reason: Reason; short: string; full: string }[] {
  return row.reasons.map((reason) => {
    switch (reason) {
      case 'months_unpaid':
        return { reason, short: `${row.months_unpaid} mo`, full: `${row.months_unpaid} months unpaid` }
      case 'loan_to_value': {
        const ltv = formatPercent(row.loan_to_value ?? 0)
        return { reason, short: ltv, full: `Loan-to-Value ${ltv}` }
      }
      case 'accrues_today':
        return { reason, short: 'Today', full: 'Accrues today' }
    }
  })
}

const REASON_NAMES: [Reason, string][] = [
  ['months_unpaid', 'Months Unpaid'],
  ['loan_to_value', 'Loan-to-Value too high'],
  ['accrues_today', 'Accrues today'],
]

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
    </svg>
  )
}

/** A number to ring, and to message on WhatsApp, on one line. */
function Reach({ phone }: { phone: string }) {
  return (
    <span className="reach">
      <a className="button secondary small" href={`tel:+91${phone}`} aria-label={`Call ${phone}`}>
        <PhoneIcon />
        {phone}
      </a>
      <button
        type="button"
        className="secondary small icon-only"
        aria-label={`WhatsApp ${phone}`}
        title="WhatsApp"
        onClick={() => sender.chat(phone)}
      >
        <ChatIcon />
      </button>
    </span>
  )
}

/** Today's Mortgages to phone about, worked out whenever the page opens: a row per
 *  Mortgage, grouped by Customer. */
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
          <ul className="reason-legend" aria-label="What the markers mean">
            {REASON_NAMES.map(([reason, name]) => (
              <li key={reason}>
                <span className={`reason ${reason}`}>{name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {groups === null ? (
        !error && <p>Loading…</p>
      ) : listed?.total === 0 ? (
        <p className="hint">Nobody to call today.</p>
      ) : (
        <div className="table-scroll">
          <table className="call-table">
            <thead>
              <tr>
                <SortHeading sorting={sorting} column="customer">
                  Customer
                </SortHeading>
                <SortHeading sorting={sorting} column="mortgage">
                  Mortgage
                </SortHeading>
                <SortHeading sorting={sorting} column="why" firstDescending>
                  Why
                </SortHeading>
                <SortHeading sorting={sorting} column="outstanding" firstDescending className="num">
                  Outstanding
                </SortHeading>
                <th>Called today</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <CustomerRows
                  key={group.customer.id}
                  group={group}
                  noting={noting}
                  onNote={setNoting}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pager}
    </section>
  )
}

/** One Customer's Mortgages, a row each, with the Customer once beside them. */
function CustomerRows({
  group,
  noting,
  onNote,
}: {
  group: CallListGroup
  noting: number | null
  onNote: (mortgageId: number | null) => void
}) {
  const { customer, rows } = group
  const owed = rows.reduce((sum, row) => sum + row.outstanding, 0)
  const notingHere = rows.some((row) => row.mortgage_id === noting)
  const count = `${rows.length} Mortgage${rows.length === 1 ? '' : 's'}`
  return rows.map((row, index) => (
    <Fragment key={row.mortgage_id}>
      <tr className={index === 0 ? 'group-start' : undefined}>
        {index === 0 && (
          <td className="call-customer" rowSpan={rows.length + (notingHere ? 1 : 0)}>
            <div className="call-who">
              <strong>
                <PersonLink person={customer} />
              </strong>
              <span className="hint">
                {/* All their Active Mortgages, on the Mortgages page */}
                <Link to={`/mortgages?customer=${customer.id}`}>{count}</Link> ·{' '}
                <span className="num">{formatINR(owed)}</span>
              </span>
              <Reach phone={group.phone_1} />
              {group.phone_2 && <Reach phone={group.phone_2} />}
            </div>
          </td>
        )}
        <td>
          <Link to={`/mortgages/${row.mortgage_id}`}>{row.mortgage_name}</Link>
        </td>
        <td>
          <span className="reasons">
            {reasonsOf(row).map(({ reason, short, full }) => (
              <span key={reason} className={`reason ${reason}`} aria-label={full} title={full}>
                <span aria-hidden="true">{short}</span>
              </span>
            ))}
          </span>
        </td>
        <td className="num">{formatINR(row.outstanding)}</td>
        <td>
          {row.called ? (
            <div className="called-cell">
              <span className="called-mark">
                <span aria-hidden="true">✓</span> Called
              </span>
              {row.called.note && <span className="hint">{row.called.note}</span>}
              {noting !== row.mortgage_id && (
                <button type="button" className="link" onClick={() => onNote(row.mortgage_id)}>
                  Again…
                </button>
              )}
            </div>
          ) : (
            noting !== row.mortgage_id && (
              <button type="button" className="small" onClick={() => onNote(row.mortgage_id)}>
                Mark called…
              </button>
            )
          )}
        </td>
      </tr>
      {noting === row.mortgage_id && (
        <tr className="call-noting">
          <td colSpan={4}>
            <MarkCalled
              mortgageId={row.mortgage_id}
              mortgageName={row.mortgage_name}
              // Marking called makes the Call List stale itself.
              onSaved={() => onNote(null)}
              onCancel={() => onNote(null)}
            />
          </td>
        </tr>
      )}
    </Fragment>
  ))
}
