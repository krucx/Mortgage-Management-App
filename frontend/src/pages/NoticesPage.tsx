import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api, type Notice, type NoticePage, type NoticeStatus } from '../api'
import { Modal } from '../components/Modal'
import { Pager } from '../components/Pager'
import { PersonLink } from '../components/PersonLink'
import { SortHeading } from '../components/SortHeading'
import { useUrlSort } from '../components/useUrlSort'
import { useUrlFilters } from '../components/useUrlFilters'
import { SendOnWhatsApp, WhatsAppPreview } from '../components/WhatsApp'
import { formatDate, formatDateTime } from '../format'
import { showOrStepBack } from '../paging'
import { sortedBy } from '../sort'

const SHOWN: [NoticeStatus | 'all', string][] = [
  ['awaiting_approval', 'To approve'],
  ['queued', 'To send'],
  ['sent', 'Sent'],
  ['skipped', 'Skipped'],
  ['all', 'All'],
]

const STATUS_NAMES: Record<NoticeStatus, string> = {
  awaiting_approval: 'to approve',
  queued: 'to send',
  sent: 'sent',
  skipped: 'skipped',
}

const NOTHING_TO_SEND =
  'Nothing to send: none of their Active Mortgages accrues on this date any more ' +
  '(Redeemed, Forfeited or edited since).'

// Sorted a page at a time, in the browser; status in the order of the tabs.
const NOTICE_SORTS = ['customer', 'accrues', 'mortgages', 'status'] as const
const NOTICE_VALUES = {
  customer: (notice: Notice) => notice.customer.name,
  accrues: (notice: Notice) => notice.accrues_on, // YYYY-MM-DD sorts as text
  mortgages: (notice: Notice) => notice.mortgages[0]?.name ?? '',
  status: (notice: Notice) => SHOWN.findIndex(([value]) => value === notice.status),
}

/** Notices the daily run queued ahead of Accrual Dates, to approve, send or skip. */
export function NoticesPage() {
  const [params, setFilters] = useUrlFilters()
  const shown = SHOWN.find(([value]) => value === params.get('status'))?.[0] ?? 'queued'
  const [listed, setListed] = useState<NoticePage | null>(null)
  // The page, for the tab it was chosen on: any change of tab (a click, Back, a link)
  // starts again at page 1.
  const [pageOf, setPageOf] = useState({ tab: shown, page: 1 })
  const page = pageOf.tab === shown ? pageOf.page : 1
  const setPage = useCallback((next: number) => setPageOf({ tab: shown, page: next }), [shown])
  const sorting = useUrlSort(NOTICE_SORTS)
  const notices = listed && sortedBy(listed.items, sorting.sort, NOTICE_VALUES)
  const [error, setError] = useState<string | null>(null)
  // The Notice whose message is open, to read before approving or sending it.
  const [reviewing, setReviewing] = useState<Notice | null>(null)

  const load = useCallback(
    () =>
      api
        .listNotices(page, shown === 'all' ? undefined : shown)
        .then(
          (result) => showOrStepBack(result, setListed, setPage),
          (err: Error) => setError(err.message),
        ),
    [page, shown, setPage],
  )

  useEffect(() => {
    load()
  }, [load])

  async function act(action: (id: number) => Promise<Notice>, id: number) {
    setError(null)
    try {
      await action(id)
      setReviewing(null)
      await load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <section className="card wide">
      <h2>Notices</h2>
      <p className="hint">
        Each morning a Notice is queued for every Customer whose Mortgages accrue soon. Days
        before, the wording and whether you approve them first are in{' '}
        <Link to="/settings">Settings</Link>.
      </p>
      <div className="row">
        {SHOWN.map(([value, label]) => (
          <label key={value} className="inline">
            <input
              type="radio"
              name="notice-status"
              checked={shown === value}
              onChange={() => setFilters({ status: value })}
            />
            {label}
          </label>
        ))}
      </div>
      {error && <p className="status error">{error}</p>}
      {listed?.total === 0 && <p className="hint">No Notices here.</p>}
      {notices && notices.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <SortHeading sorting={sorting} column="customer">
                  Customer
                </SortHeading>
                <SortHeading sorting={sorting} column="accrues">
                  Accrues on
                </SortHeading>
                <SortHeading sorting={sorting} column="mortgages">
                  Mortgages
                </SortHeading>
                <SortHeading sorting={sorting} column="status">
                  Status
                </SortHeading>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {notices.map((notice) => (
                <tr key={notice.id}>
                  <td>
                    <PersonLink person={notice.customer} />
                  </td>
                  <td>{formatDate(notice.accrues_on)}</td>
                  <td>
                    {notice.mortgages.map((m, i) => (
                      <span key={m.id}>
                        {i > 0 && ', '}
                        <Link to={`/mortgages/${m.id}`}>{m.name}</Link>
                      </span>
                    ))}
                  </td>
                  <td>
                    <span className={`badge notice-${notice.status}`}>
                      {STATUS_NAMES[notice.status]}
                      {notice.sent_at && ` ${formatDateTime(notice.sent_at)}`}
                    </span>
                  </td>
                  <td>
                    <div className="row nowrap">
                      {!notice.message ? (
                        <span className="hint">{NOTHING_TO_SEND}</span>
                      ) : notice.status === 'awaiting_approval' ? (
                        <button
                          type="button"
                          className="small"
                          onClick={() => setReviewing(notice)}
                        >
                          Review and approve
                        </button>
                      ) : notice.status === 'queued' ? (
                        <button
                          type="button"
                          className="small whatsapp-send"
                          onClick={() => setReviewing(notice)}
                        >
                          Send on WhatsApp
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="small secondary"
                          onClick={() => setReviewing(notice)}
                        >
                          Message
                        </button>
                      )}
                      {(notice.status === 'awaiting_approval' || notice.status === 'queued') && (
                        <button
                          type="button"
                          className="small secondary"
                          onClick={() => act(api.skipNotice, notice.id)}
                        >
                          Skip
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {reviewing?.message && (
        <Modal onClose={() => setReviewing(null)}>
          <h2>Notice to {reviewing.customer.name}</h2>
          <div className="stack">
            <span className="hint">For {formatDate(reviewing.accrues_on)}</span>
            <WhatsAppPreview text={reviewing.message} />
            <div className="row end">
              <button
                type="button"
                className="secondary"
                autoFocus
                onClick={() => setReviewing(null)}
              >
                Close
              </button>
              {reviewing.status === 'awaiting_approval' && (
                <button type="button" onClick={() => act(api.approveNotice, reviewing.id)}>
                  Approve
                </button>
              )}
              {reviewing.status === 'queued' && (
                <SendOnWhatsApp
                  phones={reviewing.phones}
                  text={reviewing.message}
                  onSent={() => act(api.markNoticeSent, reviewing.id)}
                />
              )}
            </div>
          </div>
        </Modal>
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
