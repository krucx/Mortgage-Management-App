import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { api, type MortgagePage, type ReadyToRedeem, type Redemption } from '../api'
import { Summary } from '../components/ConfirmDialog'
import { Pager } from '../components/Pager'
import { PersonLink } from '../components/PersonLink'
import { useConfirm } from '../components/useConfirm'
import { formatDate, todayIso } from '../format'
import { formatINR, rupeesToPaise } from '../money'

/**
 * Closures in one place: Mortgages paid off and waiting to be Redeemed, and Active
 * Mortgages the Lender may choose to Forfeit.
 */
export function ClosuresPage() {
  const [ready, setReady] = useState<ReadyToRedeem[] | null>(null)
  const [active, setActive] = useState<MortgagePage | null>(null)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api.readyToRedeem().then(setReady, (err: Error) => setError(err.message))
    api
      .listMortgages(page, '', { status: 'active', owing: true })
      .then(setActive, (err: Error) => setError(err.message))
  }, [page])

  useEffect(load, [load])

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
        {ready && ready.length > 0 && <span className="badge count">{ready.length}</span>}
      </h3>
      <p className="hint">Paid off with nothing Outstanding: hand the jewellery back and Redeem.</p>
      {ready === null ? (
        <p>Loading…</p>
      ) : ready.length === 0 ? (
        <p className="hint">None waiting.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Mortgage</th>
                <th>Customer</th>
                <th className="num">Redemption Amount today</th>
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

      <h3>Forfeit</h3>
      <p className="hint">
        Choose the Active Mortgages whose Customers have defaulted.
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
                <th>Mortgage</th>
                <th>Customer</th>
                <th>Started</th>
                <th className="num">Outstanding today</th>
              </tr>
            </thead>
            <tbody>
              {forfeitable.map((m) => (
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
      {active && (
        <Pager
          page={active.page}
          pageSize={active.page_size}
          total={active.total}
          shown={active.items.length}
          onPage={setPage}
        />
      )}
      {chosen.length > 0 && (
        <ForfeitChosen
          chosen={chosen.map((m) => ({ id: m.id, name: m.name }))}
          onDone={() => {
            setSelected(new Set())
            load()
          }}
        />
      )}

    </section>
  )
}

/** Forfeit several Mortgages on one date, each with its own Recovered Amount. */
function ForfeitChosen({
  chosen,
  onDone,
}: {
  chosen: { id: number; name: string }[]
  onDone: () => void
}) {
  const [on, setOn] = useState(todayIso())
  // Keyed by `${date}:${id}`, so changing the date never shows a stale amount.
  const [quotes, setQuotes] = useState<Record<string, Redemption | string>>({})
  const [recovered, setRecovered] = useState<Record<number, string>>({})
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [failures, setFailures] = useState<string[]>([])
  const [confirm, confirmDialog] = useConfirm()
  const ids = chosen.map((m) => m.id).join(',')

  // The Redemption Amount of each chosen Mortgage on the Forfeiture date.
  useEffect(() => {
    let cancelled = false
    for (const id of ids.split(',').map(Number)) {
      api
        .getRedemption(id, on)
        .then((quote) => !cancelled && setQuotes((q) => ({ ...q, [`${on}:${id}`]: quote })))
        .catch(
          (err: Error) =>
            !cancelled && setQuotes((q) => ({ ...q, [`${on}:${id}`]: err.message })),
        )
    }
    return () => {
      cancelled = true
    }
  }, [ids, on])

  const rows = chosen.map((m) => {
    const quote = quotes[`${on}:${m.id}`]
    const owed = typeof quote === 'object' ? quote.total : null
    const got = recovered[m.id] ? rupeesToPaise(recovered[m.id]) : null
    return { ...m, quote, owed, got, result: owed !== null && got !== null ? got - owed : null }
  })
  const ready = rows.every((r) => r.owed !== null && r.got !== null)
  const totalResult = rows.reduce((sum, r) => sum + (r.result ?? 0), 0)
  const future = on > todayIso()

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready || future) return
    const confirmed = await confirm({
      title: `Forfeit ${chosen.length} Mortgage${chosen.length > 1 ? 's' : ''}?`,
      body: (
        <Summary
          rows={[
            ['Forfeited on', formatDate(on)],
            ...rows.map((r): [string, string] => [
              r.name,
              `Recovered ${formatINR(r.got ?? 0)} of ${formatINR(r.owed ?? 0)}`,
            ]),
            [totalResult >= 0 ? 'Total profit' : 'Total loss', formatINR(Math.abs(totalResult))],
          ]}
        />
      ),
      confirmLabel: 'Confirm Forfeiture',
      danger: true,
    })
    if (!confirmed) return
    setSaving(true)
    const failed: string[] = []
    for (const r of rows) {
      try {
        await api.forfeit(r.id, { forfeited_on: on, recovered_amount: r.got ?? 0, note })
      } catch (err) {
        failed.push(`${r.name}: ${(err as Error).message}`)
      }
    }
    setSaving(false)
    setFailures(failed)
    if (failed.length === 0) onDone()
  }

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
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td className="num">
                  {typeof r.quote === 'string' ? (
                    <span className="status error">{r.quote}</span>
                  ) : r.owed === null ? (
                    '…'
                  ) : (
                    formatINR(r.owed)
                  )}
                </td>
                <td className="num">
                  <input
                    type="number"
                    className="small-input"
                    aria-label={`Recovered Amount for ${r.name}`}
                    required
                    min="0"
                    step="0.01"
                    value={recovered[r.id] ?? ''}
                    onChange={(event) => setRecovered({ ...recovered, [r.id]: event.target.value })}
                  />
                </td>
                <td className="num">
                  {r.result === null ? (
                    '—'
                  ) : (
                    <span className={`status ${r.result >= 0 ? 'saved' : 'error'}`}>
                      {formatINR(r.result)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {future && <p className="hint">A Forfeiture cannot be recorded for a future date.</p>}
      <div className="row">
        <button type="submit" className="danger-solid" disabled={saving || !ready || future}>
          {saving ? 'Forfeiting…' : `Forfeit ${chosen.length}`}
        </button>
        {ready && (
          <span className={`status ${totalResult >= 0 ? 'saved' : 'error'}`}>
            {totalResult >= 0 ? 'Total profit' : 'Total loss'} {formatINR(Math.abs(totalResult))}
          </span>
        )}
      </div>
      {failures.length > 0 && (
        <ul className="problems">
          {failures.map((failure) => (
            <li key={failure}>{failure}</li>
          ))}
        </ul>
      )}
      {confirmDialog}
    </form>
  )
}
