import { Fragment, useId, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router'
import {
  CALL_LIST_SORTS,
  type CallListGroup,
  type CallListRow,
  type CallNoteImport,
  type NotImported,
} from '../api'
import { MarkCalled } from '../components/CallNotes'
import { Summary } from '../components/ConfirmDialog'
import { PersonLink } from '../components/PersonLink'
import { Modal } from '../components/Modal'
import { ScrollPopup } from '../components/ScrollPopup'
import { SortHeading } from '../components/SortHeading'
import { useListPage } from '../components/useListPage'
import { ChatIcon } from '../components/WhatsApp'
import { formatDate, formatPercent, plural } from '../format'
import { sender } from '../messaging'
import { formatINR } from '../money'
import { callSheet, lists } from '../requests'
import { STALE_AFTER, useChange, useServerState } from '../serverState'

type Reason = CallListRow['reasons'][number]

/** Each reason a Mortgage is listed, as a status marker: its short label and full wording. */
function reasonsOf(row: CallListRow): { reason: Reason; short: string; full: string }[] {
  return row.reasons.map((reason) => {
    switch (reason) {
      case 'months_unpaid':
        return {
          reason,
          short: `${row.months_unpaid} mo`,
          full: `${row.months_unpaid} months unpaid`,
        }
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
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
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
        Active Mortgages with too many Months Unpaid, a high Loan-to-Value, or accruing today. The
        thresholds are in <Link to="/settings">Settings</Link>.
      </p>
      {error && <p className="status error">{error}</p>}
      <CallSheet />
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

/** The Call Sheet to call from (Excel or PDF), and the Excel sheet imported back with
 *  the Call Notes written in: a pop-up shows the notes it adds and each filled-in row
 *  it leaves out, then adds those it can. */
function CallSheet() {
  const { client } = useServerState()
  const noteCalls = useChange(STALE_AFTER.callNote)
  const [status, setStatus] = useState<{
    kind: 'saved' | 'warning' | 'error'
    text: string
  } | null>(null)
  const [importing, setImporting] = useState(false)
  // The sheet chosen and what importing it would do, while its pop-up is open.
  const [preview, setPreview] = useState<{ sheet: File; result: CallNoteImport } | null>(null)
  // The rows the last import left out, and whether their pop-up is open.
  const [leftOut, setLeftOut] = useState<NotImported[]>([])
  const [showingLeftOut, setShowingLeftOut] = useState(false)

  async function chooseSheet(event: ChangeEvent<HTMLInputElement>) {
    const sheet = event.target.files?.[0]
    event.target.value = '' // the same file can be chosen again
    if (!sheet) return
    setStatus(null)
    setLeftOut([])
    setImporting(true)
    try {
      setPreview({ sheet, result: await callSheet.previewImport(client, sheet) })
    } catch (err) {
      setStatus({ kind: 'error', text: (err as Error).message })
    } finally {
      setImporting(false)
    }
  }

  async function add(sheet: File) {
    setPreview(null)
    setImporting(true)
    try {
      const added = await noteCalls((client) => callSheet.import(client, sheet))
      const notImported = added.not_imported.length
      setLeftOut(added.not_imported)
      setStatus({
        kind: notImported ? 'warning' : 'saved',
        text:
          `Added ${plural(added.adding.length, 'Call Note', 'Call Notes')}.` +
          (notImported ? ` ${plural(notImported, 'row', 'rows')} not imported:` : ''),
      })
    } catch (err) {
      setStatus({ kind: 'error', text: (err as Error).message })
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="stack">
      <div className="row">
        <a className="button secondary small" href={callSheet.exportUrl('xlsx')} download>
          Export to Excel
        </a>
        <a className="button secondary small" href={callSheet.exportUrl('pdf')} download>
          Export to PDF
        </a>
        <label className="button secondary small">
          {importing ? 'Importing…' : 'Import Call Notes from Excel'}
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            hidden
            disabled={importing}
            onChange={chooseSheet}
          />
        </label>
      </div>
      <p className="hint">
        Give the Call Sheet to whoever makes the calls: they write what each call came to under Call
        Note (and change Called on if they called another day), and you import the Excel sheet back.
        Rows it can't take are left out and listed; fix them and import it again.
      </p>
      {status && (
        <p className={`status ${status.kind}`}>
          {status.text}
          {leftOut.length > 0 && (
            <>
              {' '}
              <button
                type="button"
                className="secondary small"
                onClick={() => setShowingLeftOut(true)}
              >
                Show them
              </button>
            </>
          )}
        </p>
      )}
      {preview && (
        <ImportPreview
          sheet={preview.sheet}
          result={preview.result}
          onAdd={() => void add(preview.sheet)}
          onClose={() => setPreview(null)}
        />
      )}
      {showingLeftOut && (
        <ScrollPopup
          title={notImportedTitle(leftOut.length)}
          onClose={() => setShowingLeftOut(false)}
        >
          <NotImportedRows rows={leftOut} />
        </ScrollPopup>
      )}
    </div>
  )
}

/** What importing `sheet` would add and leave out; closing it (Keep editing, Esc or a
 *  click outside) saves nothing. */
function ImportPreview({
  sheet,
  result,
  onAdd,
  onClose,
}: {
  sheet: File
  result: CallNoteImport
  onAdd: () => void
  onClose: () => void
}) {
  const titleId = useId()
  const adding = plural(result.adding.length, 'Call Note', 'Call Notes')
  const quiet = [
    result.skipped_empty > 0 &&
      plural(result.skipped_empty, 'row without a Call Note', 'rows without a Call Note'),
    result.skipped_duplicates > 0 && `${result.skipped_duplicates} already there`,
  ].filter(Boolean)
  return (
    <Modal onClose={onClose} className="scroll-popup" labelledBy={titleId} closeOnOutsideClick>
      <h2 id={titleId}>Import Call Notes from {sheet.name}</h2>
      <div className="scroll-popup-body stack">
        {result.adding.length > 0 ? (
          <>
            <h3>Adding {adding}</h3>
            <Summary
              rows={result.adding.map((note): [string, string] => [
                `${note.mortgage_name} · ${note.customer_name}`,
                `${formatDate(note.called_on)}: ${note.note}`,
              ])}
            />
          </>
        ) : (
          <h3>Nothing to add</h3>
        )}
        {result.not_imported.length > 0 && (
          <>
            <h3 className="not-imported">{notImportedTitle(result.not_imported.length)}</h3>
            <NotImportedRows rows={result.not_imported} />
          </>
        )}
        {quiet.length > 0 && <p className="hint">Left out quietly: {quiet.join(' · ')}</p>}
      </div>
      <div className="row end">
        <button type="button" className="secondary" autoFocus onClick={onClose}>
          Keep editing
        </button>
        {result.adding.length > 0 && (
          <button type="button" onClick={onAdd}>
            Add {adding}
          </button>
        )}
      </div>
    </Modal>
  )
}

const notImportedTitle = (rows: number) => `Not imported: ${plural(rows, 'row', 'rows')}`

/** Each filled-in row an import leaves out: its row number, Mortgage Name and why. */
function NotImportedRows({ rows }: { rows: NotImported[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Row</th>
          <th>Mortgage Name</th>
          <th>Why</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.row}>
            <td>Row {row.row}</td>
            <td>{row.mortgage_name ?? `“${row.note}”`}</td>
            <td>{row.reason}</td>
          </tr>
        ))}
      </tbody>
    </table>
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
