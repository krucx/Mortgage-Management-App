import { Fragment, useState } from 'react'
import { Link } from 'react-router'
import { CALL_LIST_SORTS, type CallListGroup, type CallListRow } from '../api'
import { MarkCalled } from '../components/CallNotes'
import { PersonLink } from '../components/PersonLink'
import { SortButton, SortHeading } from '../components/SortHeading'
import { useListPage } from '../components/useListPage'
import { formatPercent } from '../format'
import { sender } from '../messaging'
import { formatINR } from '../money'
import { lists } from '../requests'

/** Why a Customer is on the Call List, across their Mortgages: the most Months Unpaid,
 *  the highest Loan-to-Value, and whether any accrues today. */
function reasonsOfCustomer(rows: CallListRow[]): string[] {
  const listedFor = (reason: CallListRow['reasons'][number]) =>
    rows.filter((row) => row.reasons.includes(reason))
  const unpaid = listedFor('months_unpaid')
  const tooHigh = listedFor('loan_to_value')
  return [
    unpaid.length > 0 && `${Math.max(...unpaid.map((r) => r.months_unpaid))} months unpaid`,
    tooHigh.length > 0 &&
      `Loan-to-Value ${formatPercent(Math.max(...tooHigh.map((r) => r.loan_to_value ?? 0)))}`,
    listedFor('accrues_today').length > 0 && 'Accrues today',
  ].filter((reason): reason is string => Boolean(reason))
}

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

/** Today's Mortgages to phone about, worked out whenever the page opens: one row per
 *  Customer, which opens to show their Mortgages. */
export function CallListPage() {
  // Sorted on the server across every page: each Customer's rows, then the Customers.
  const { listed, sorting, error, pager } = useListPage(CALL_LIST_SORTS, lists.callList())
  const groups = listed?.items ?? null
  const [open, setOpen] = useState<Set<number>>(new Set()) // Customers shown expanded
  const [noting, setNoting] = useState<number | null>(null) // the Mortgage being marked called

  function toggle(customerId: number) {
    const next = new Set(open)
    if (next.has(customerId)) next.delete(customerId)
    else next.add(customerId)
    setOpen(next)
  }

  return (
    <section className="card wide">
      <h2>Call List</h2>
      <p className="hint">
        Active Mortgages with too many Months Unpaid, a high Loan-to-Value, or accruing today.
        The thresholds are in <Link to="/settings">Settings</Link>.
      </p>
      {error && <p className="status error">{error}</p>}
      {listed && listed.total > 0 && groups && (
        <div className="row spread">
          <p>
            {listed.mortgages} Mortgage{listed.mortgages === 1 ? '' : 's'} for {listed.total}{' '}
            Customer{listed.total === 1 ? '' : 's'}
          </p>
          <div className="row">
            <SortButton sorting={sorting} column="mortgage">
              Sort Mortgages by name
            </SortButton>
            <button
              type="button"
              className="secondary small"
              onClick={() => setOpen(new Set(groups.map((g) => g.customer.id)))}
            >
              Expand all
            </button>
            <button type="button" className="secondary small" onClick={() => setOpen(new Set())}>
              Collapse all
            </button>
          </div>
        </div>
      )}
      {groups === null ? (
        !error && <p>Loading…</p>
      ) : listed?.total === 0 ? (
        <p className="hint">Nobody to call today.</p>
      ) : (
        <div className="table-scroll">
          <table className="call-table">
            {/* Fixed widths, so opening a Customer never moves the columns. */}
            <colgroup>
              <col className="w-customer" />
              <col className="w-why" />
              <col className="w-owed" />
              <col className="w-called" />
              <col className="w-contact" />
            </colgroup>
            <thead>
              <tr>
                <SortHeading sorting={sorting} column="customer">
                  Customer
                </SortHeading>
                <SortHeading sorting={sorting} column="why" firstDescending>
                  Why
                </SortHeading>
                <SortHeading sorting={sorting} column="outstanding" firstDescending className="num">
                  Outstanding
                </SortHeading>
                <th>Called today</th>
                <th>Contact</th>
              </tr>
            </thead>
            {groups.map((group) => (
              <CustomerRows
                key={group.customer.id}
                group={group}
                expanded={open.has(group.customer.id)}
                onToggle={() => toggle(group.customer.id)}
                noting={noting}
                onNote={setNoting}
              />
            ))}
          </table>
        </div>
      )}
      {pager}
    </section>
  )
}

/** One Customer on the Call List: a summary row, and their Mortgages when expanded. */
function CustomerRows({
  group,
  expanded,
  onToggle,
  noting,
  onNote,
}: {
  group: CallListGroup
  expanded: boolean
  onToggle: () => void
  noting: number | null
  onNote: (mortgageId: number | null) => void
}) {
  const { customer, rows } = group
  const owed = rows.reduce((sum, row) => sum + row.outstanding, 0)
  const called = rows.filter((row) => row.called).length
  const count = `${rows.length} Mortgage${rows.length === 1 ? '' : 's'}`
  return (
    <tbody className={expanded ? 'call-customer open' : 'call-customer'}>
      <tr className="call-summary">
        <td>
          <span className="call-name">
            <button
              type="button"
              className="disclosure"
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Hide' : 'Show'} Mortgages of ${customer.name}`}
              onClick={onToggle}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 3.5 10.5 8 6 12.5" />
              </svg>
            </button>
            <span className="call-who">
              <strong>
                <PersonLink person={customer} />
              </strong>
              {/* All their Active Mortgages, on the Mortgages page */}
              <Link className="call-count" to={`/mortgages?customer=${customer.id}`}>
                {count}
              </Link>
            </span>
          </span>
        </td>
        <td>{reasonsOfCustomer(rows).join(' · ')}</td>
        <td className="num">{formatINR(owed)}</td>
        <td className={called ? undefined : 'hint'}>
          {rows.length === 1 ? (called ? 'Called' : 'Not yet') : `${called} of ${rows.length} called`}
        </td>
        <td>
          <span className="call-contacts">
            <ContactLinks phone={group.phone_1} />
            {group.phone_2 && <ContactLinks phone={group.phone_2} />}
          </span>
        </td>
      </tr>
      {expanded &&
        rows.map((row) => (
          <Fragment key={row.mortgage_id}>
            <tr className={row.called ? 'call-mortgage called' : 'call-mortgage'}>
              <td>
                <Link to={`/mortgages/${row.mortgage_id}`} title={row.mortgage_name}>
                  {row.mortgage_name}
                </Link>
              </td>
              <td>{reasonsOf(row).join(' · ')}</td>
              <td className="num">{formatINR(row.outstanding)}</td>
              <td>{row.called ? `Called${row.called.note ? `: ${row.called.note}` : ''}` : <span className="hint">Not yet</span>}</td>
              <td>
                {noting !== row.mortgage_id && (
                  <button
                    type="button"
                    className={row.called ? 'secondary small' : 'small'}
                    onClick={() => onNote(row.mortgage_id)}
                  >
                    {row.called ? 'Again…' : 'Mark called…'}
                  </button>
                )}
              </td>
            </tr>
            {noting === row.mortgage_id && (
              <tr className="call-mortgage call-noting">
                <td colSpan={5}>
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
        ))}
    </tbody>
  )
}
