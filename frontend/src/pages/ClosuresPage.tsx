import { useQueries } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { MORTGAGE_SORTS, READY_SORTS, type PaymentMethod, type Redemption } from '../api'
import { PreviewSection } from '../components/BeforeAfter'
import { Summary } from '../components/ConfirmDialog'
import { PaymentMethodSelect } from '../components/PaymentMethodSelect'
import { PersonLink } from '../components/PersonLink'
import { SortHeading } from '../components/SortHeading'
import { useClosing, type Closing } from '../components/useClosing'
import { useListPage } from '../components/useListPage'
import { usePaymentMethods } from '../components/usePaymentMethods'
import { formatDate, todayIso } from '../format'
import { tickedFirst } from '../sort'
import { formatINR, rupeesToPaise } from '../money'
import { lists, redemptionQuery } from '../requests'
import { useServerState } from '../serverState'

/**
 * Closures in one place: Mortgages paid off and waiting to be Redeemed, and Active
 * Mortgages the Lender may choose to Forfeit or Waive off.
 */
export function ClosuresPage() {
  // Both lists are sorted on the server, across their pages.
  const {
    listed: readyList,
    sorting: readySorting,
    error: readyError,
    pager: readyPager,
  } = useListPage(READY_SORTS, lists.readyToRedeem(), { sortParam: 'ready_sort' })
  const ready = readyList?.items ?? null
  const {
    listed: active,
    sorting,
    error: forfeitError,
    pager: forfeitPager,
  } = useListPage(
    MORTGAGE_SORTS,
    // Active Mortgages still owing something: the ones that can be Forfeited.
    lists.mortgages({ status: 'active', owing: true }),
    { sortParam: 'forfeit_sort' },
  )
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [closing, setClosing] = useState<'forfeit' | 'waive'>('forfeit')
  const error = forfeitError ?? readyError

  function toggle(id: number) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  // Only Mortgages still owing something; paid-off ones are Redeemed (listed above).
  const forfeitable = active?.items ?? []
  const chosen = forfeitable.filter((m) => selected.has(m.id))

  return (
    <section className="card wide">
      <h2>Redeem / Forfeit</h2>
      {error && <p className="status error">{error}</p>}

      <h3>
        Ready to Redeem{' '}
        {readyList && readyList.total > 0 && (
          <span className="badge count">{readyList.total}</span>
        )}
      </h3>
      <p className="hint">Paid off with nothing Outstanding: hand the jewellery back and Redeem.</p>
      {ready === null ? (
        <p>Loading…</p>
      ) : readyList?.total === 0 ? (
        <p className="hint">None waiting.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <SortHeading sorting={readySorting} column="mortgage">
                  Mortgage
                </SortHeading>
                <SortHeading sorting={readySorting} column="customer">
                  Customer
                </SortHeading>
                <SortHeading sorting={readySorting} column="amount" firstDescending className="num">
                  Redemption Amount today
                </SortHeading>
                <th aria-label="Redeem" />
              </tr>
            </thead>
            <tbody>
              {ready.map(({ mortgage, redemption }) => (
                <tr key={mortgage.id}>
                  <td>
                    <Link to={`/mortgages/${mortgage.id}`}>{mortgage.name}</Link>
                  </td>
                  <td>
                    <PersonLink person={mortgage.customer} />
                  </td>
                  <td className="num">
                    {formatINR(redemption.total)}
                    {redemption.part_month_charge > 0 && (
                      <span className="hint"> (part-month charge)</span>
                    )}
                  </td>
                  <td>
                    <Link className="button small" to={`/mortgages/${mortgage.id}/redeem`}>
                      Redeem…
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {readyPager}

      <h3>Forfeit or Waive off</h3>
      <p className="hint">
        Choose Active Mortgages to Forfeit, when the Customer has defaulted, or to Waive off, when
        you let off what is left and hand the jewellery back.
      </p>
      {active === null ? (
        <p>Loading…</p>
      ) : forfeitable.length === 0 ? (
        <p className="hint">No Active Mortgages with anything Outstanding.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th aria-label="Choose" />
                <SortHeading sorting={sorting} column="name">
                  Mortgage
                </SortHeading>
                <SortHeading sorting={sorting} column="customer">
                  Customer
                </SortHeading>
                <SortHeading sorting={sorting} column="started" firstDescending>
                  Started
                </SortHeading>
                <SortHeading sorting={sorting} column="outstanding" firstDescending className="num">
                  Outstanding today
                </SortHeading>
              </tr>
            </thead>
            <tbody>
              {/* The ticked ones first, so the Mortgages to close are together. */}
              {tickedFirst(forfeitable, selected).map((m) => (
                <tr key={m.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Choose ${m.name}`}
                      checked={selected.has(m.id)}
                      onChange={() => toggle(m.id)}
                    />
                  </td>
                  <td>
                    <Link to={`/mortgages/${m.id}`}>{m.name}</Link>
                  </td>
                  <td>
                    <PersonLink person={m.customer} />
                  </td>
                  <td>{formatDate(m.start_date)}</td>
                  <td className="num">{formatINR(m.outstanding_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {forfeitPager}
      {chosen.length > 0 && (
        <>
          <div className="row" role="radiogroup" aria-label="Close the chosen by">
            <span>
              With the {chosen.length} chosen:
            </span>
            <label className="inline">
              <input
                type="radio"
                name="closing"
                checked={closing === 'forfeit'}
                onChange={() => setClosing('forfeit')}
              />
              Forfeit
            </label>
            <label className="inline">
              <input
                type="radio"
                name="closing"
                checked={closing === 'waive'}
                onChange={() => setClosing('waive')}
              />
              Waive off
            </label>
          </div>
          {closing === 'forfeit' ? (
            <ForfeitChosen
              chosen={chosen.map((m) => ({ id: m.id, name: m.name }))}
              // The Forfeitures made both lists stale.
              onDone={() => setSelected(new Set())}
            />
          ) : (
            <WaiveChosen
              chosen={chosen.map((m) => ({ id: m.id, name: m.name }))}
              onDone={() => setSelected(new Set())}
            />
          )}
        </>
      )}

    </section>
  )
}

type Chosen = { id: number; name: string }

/** The Redemption Amount of each chosen Mortgage on `on`, or why there is none. */
function useQuotes(chosen: Chosen[], on: string) {
  const { client } = useServerState()
  const quoted = useQueries({ queries: chosen.map((m) => redemptionQuery(client, m.id, on)) })
  const quotes: Record<string, Redemption | string | undefined> = Object.fromEntries(
    chosen.map((m, i) => [`${on}:${m.id}`, quoted[i].data ?? quoted[i].error?.message]),
  )
  return (id: number) => quotes[`${on}:${id}`]
}

/** The Redemption Amount cell: the amount, still loading, or why there is none. */
function Owed({ quote }: { quote: Redemption | string | undefined }) {
  if (typeof quote === 'string') return <span className="status error">{quote}</span>
  return quote ? formatINR(quote.total) : '…'
}

/** Forfeit several Mortgages on one date, each with its own Recovered Amount: all of
 *  them, or none if the backend refuses any. */
function ForfeitChosen({ chosen, onDone }: { chosen: Chosen[]; onDone: () => void }) {
  const [on, setOn] = useState(todayIso())
  const [recovered, setRecovered] = useState<Record<number, string>>({})
  const [note, setNote] = useState('')
  const quoteOf = useQuotes(chosen, on)

  const entered = chosen.every((m) => recovered[m.id])
  const closing: Closing | null = entered
    ? {
        kind: 'forfeit',
        forfeit: {
          forfeited_on: on,
          note,
          mortgages: chosen.map((m) => ({
            mortgage_id: m.id,
            recovered_amount: rupeesToPaise(recovered[m.id]),
          })),
        },
      }
    : null
  const { preview, submit, saving, canSave, error, confirmDialog, closureOf } = useClosing({
    closing,
    confirm: () => ({
      title: `Forfeit ${chosen.length} Mortgage${chosen.length > 1 ? 's' : ''}?`,
      body: (
        <Summary
          rows={[
            ['Forfeited on', formatDate(on)],
            ...chosen.map((m): [string, string] => {
              const closure = closureOf(m.id)
              return [
                m.name,
                `Recovered ${formatINR(closure?.recovered_amount ?? 0)} of ${formatINR(closure?.redemption_amount ?? 0)}`,
              ]
            }),
            [total >= 0 ? 'Total profit' : 'Total loss', formatINR(Math.abs(total))],
          ]}
        />
      ),
      confirmLabel: 'Confirm Forfeiture',
      danger: true,
    }),
    saved: onDone,
  })
  // Each one's profit or loss, as the Preview works it out.
  const profitLosses = chosen.map((m) => closureOf(m.id)?.profit_loss ?? null)
  const previewed = closing !== null && !preview.error && profitLosses.every((r) => r !== null)
  const total = profitLosses.reduce<number>((sum, r) => sum + (r ?? 0), 0)

  return (
    <form onSubmit={submit} className="stack close-panel">
      <strong>Forfeit the {chosen.length} chosen</strong>
      <div className="grid-2">
        <label>
          Forfeited on
          <input type="date" required value={on} onChange={(event) => setOn(event.target.value)} />
        </label>
        <label>
          Note (for all)
          <input
            placeholder="e.g. auctioned on…"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Mortgage</th>
              <th className="num">Redemption Amount</th>
              <th className="num">Recovered Amount (₹)</th>
              <th className="num">Profit / loss</th>
            </tr>
          </thead>
          <tbody>
            {chosen.map((m, i) => (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td className="num">
                  <Owed quote={quoteOf(m.id)} />
                </td>
                <td className="num">
                  <input
                    type="number"
                    className="small-input"
                    aria-label={`Recovered Amount for ${m.name}`}
                    required
                    min="0"
                    step="0.01"
                    value={recovered[m.id] ?? ''}
                    onChange={(event) => setRecovered({ ...recovered, [m.id]: event.target.value })}
                  />
                </td>
                <td className="num">
                  {!previewed || profitLosses[i] === null ? (
                    '—'
                  ) : (
                    <span className={`status ${profitLosses[i] >= 0 ? 'saved' : 'error'}`}>
                      {formatINR(profitLosses[i])}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {closing && <PreviewSection preview={preview} />}
      <div className="row">
        <button type="submit" className="danger-solid" disabled={!canSave || !previewed}>
          {saving ? 'Forfeiting…' : `Forfeit ${chosen.length}`}
        </button>
        {previewed && (
          <span className={`status ${total >= 0 ? 'saved' : 'error'}`}>
            {total >= 0 ? 'Total profit' : 'Total loss'} {formatINR(Math.abs(total))}
          </span>
        )}
      </div>
      {error && <p className="status error">{error}</p>}
      {confirmDialog}
    </form>
  )
}

/** Waive off several Mortgages on one date: each takes its own final Payment (or none),
 *  and the rest of its Redemption Amount is let off; all of them, or none if the
 *  backend refuses any. */
function WaiveChosen({ chosen, onDone }: { chosen: Chosen[]; onDone: () => void }) {
  const [on, setOn] = useState(todayIso())
  const [received, setReceived] = useState<Record<number, string>>({})
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [reference, setReference] = useState('')
  const methods = usePaymentMethods()
  const [note, setNote] = useState('')
  const quoteOf = useQuotes(chosen, on)

  const entered = chosen.every((m) => received[m.id])
  const closing: Closing | null = entered
    ? {
        kind: 'waive',
        waive: {
          waived_on: on,
          method,
          reference: reference.trim() || null,
          note,
          mortgages: chosen.map((m) => ({
            mortgage_id: m.id,
            amount_paid: rupeesToPaise(received[m.id]),
          })),
        },
      }
    : null
  const { preview, submit, saving, canSave, error, confirmDialog, closureOf } = useClosing({
    closing,
    confirm: () => ({
      title: `Waive off ${chosen.length} Mortgage${chosen.length > 1 ? 's' : ''}?`,
      body: (
        <>
          <Summary
            rows={[
              ['Waived on', formatDate(on)],
              ...chosen.map((m): [string, string] => {
                const closure = closureOf(m.id)
                return [
                  m.name,
                  `Received ${formatINR(closure?.payment_amount ?? 0)}, waived ${formatINR(closure?.waived_amount ?? 0)}`,
                ]
              }),
              ['Total waived off', formatINR(totalWaived)],
              ['Reason', note.trim() || '—'],
            ]}
          />
          <p className="hint">Return the jewellery for each.</p>
        </>
      ),
      confirmLabel: 'Confirm Waiver',
    }),
    saved: onDone,
  })
  // What each one lets off, as the Preview works it out.
  const waivedAmounts = chosen.map((m) => closureOf(m.id)?.waived_amount ?? null)
  const previewed = closing !== null && !preview.error && waivedAmounts.every((w) => w !== null)
  const totalWaived = waivedAmounts.reduce<number>((sum, w) => sum + (w ?? 0), 0)
  const anyPaid = chosen.some((m) => rupeesToPaise(received[m.id] || '0') > 0)

  return (
    <form onSubmit={submit} className="stack close-panel">
      <strong>Waive off the {chosen.length} chosen</strong>
      <div className="grid-2">
        <label>
          Waived on
          <input type="date" required value={on} onChange={(event) => setOn(event.target.value)} />
        </label>
        <label>
          Reason (for all)
          <input
            placeholder="e.g. small balance let off"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Mortgage</th>
              <th className="num">Redemption Amount</th>
              <th className="num">Received now (₹)</th>
              <th className="num">Waived off</th>
            </tr>
          </thead>
          <tbody>
            {chosen.map((m, i) => (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td className="num">
                  <Owed quote={quoteOf(m.id)} />
                </td>
                <td className="num">
                  <input
                    type="number"
                    className="small-input"
                    aria-label={`Received now for ${m.name}`}
                    required
                    min="0"
                    step="0.01"
                    value={received[m.id] ?? ''}
                    onChange={(event) => setReceived({ ...received, [m.id]: event.target.value })}
                  />
                </td>
                <td className="num">
                  {!previewed || waivedAmounts[i] === null ? (
                    '—'
                  ) : (
                    <span className="status warning">{formatINR(waivedAmounts[i])}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {anyPaid && (
        <div className="grid-2">
          <label>
            Final Payments made by
            <PaymentMethodSelect methods={methods} value={method} onChange={setMethod} />
          </label>
          <label>
            Reference (for all)
            <input
              placeholder="e.g. UPI transaction id"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          </label>
        </div>
      )}
      {closing && <PreviewSection preview={preview} />}
      <div className="row">
        <button type="submit" disabled={!canSave || !previewed}>
          {saving ? 'Waiving off…' : `Waive off ${chosen.length}`}
        </button>
        {previewed && (
          <span className="status warning">Total waived off {formatINR(totalWaived)}</span>
        )}
      </div>
      {error && <p className="status error">{error}</p>}
      {confirmDialog}
    </form>
  )
}
