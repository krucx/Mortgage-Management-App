import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api, type Notice, type NoticePage, type NoticeStatus } from '../api'
import { Pager } from '../components/Pager'
import { PersonLink } from '../components/PersonLink'
import { useUrlFilters } from '../components/useUrlFilters'
import { SendOnWhatsApp, WhatsAppPreview } from '../components/WhatsApp'
import { formatDate, formatDateTime } from '../format'
import { showOrStepBack } from '../paging'

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
  const notices = listed?.items ?? null
  const [error, setError] = useState<string | null>(null)

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
      <div className="stack">
        {notices?.map((notice) => (
          <article key={notice.id} className="notice">
            <div className="notice-head">
              <div>
                <PersonLink person={notice.customer} />{' '}
                <span className="hint">
                  for {formatDate(notice.accrues_on)} ·{' '}
                  {notice.mortgages.map((m, i) => (
                    <span key={m.id}>
                      {i > 0 && ', '}
                      <Link to={`/mortgages/${m.id}`}>{m.name}</Link>
                    </span>
                  ))}
                </span>
              </div>
              <span className={`badge notice-${notice.status}`}>
                {STATUS_NAMES[notice.status]}
                {notice.sent_at && ` ${formatDateTime(notice.sent_at)}`}
              </span>
            </div>
            <div className="receipt-panel">
              {notice.message ? (
                <WhatsAppPreview text={notice.message} />
              ) : (
                <p className="hint">
                  None of their Active Mortgages accrues on this date any more (Redeemed,
                  Forfeited or edited since): nothing to send.
                </p>
              )}
              <div className="stack">
                {notice.status === 'awaiting_approval' && (
                  <button type="button" onClick={() => act(api.approveNotice, notice.id)}>
                    Approve
                  </button>
                )}
                {notice.status === 'queued' && notice.message && (
                  <SendOnWhatsApp
                    phones={notice.phones}
                    text={notice.message}
                    onSent={() => act(api.markNoticeSent, notice.id)}
                  />
                )}
                {(notice.status === 'awaiting_approval' || notice.status === 'queued') && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => act(api.skipNotice, notice.id)}
                  >
                    Skip
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
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
