import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import type { GoldRate } from '../../api'
import { Summary } from '../../components/ConfirmDialog'
import { useConfirm } from '../../components/useConfirm'
import { useDraft } from '../../components/useDraft'
import { formatDate } from '../../format'
import { formatINR, paiseToRupees, rupeesToPaise } from '../../money'
import { settings } from '../../requests'
import { STALE_AFTER, useChange, useServerState } from '../../serverState'
import { type Status, shownStatus } from './shared'

/** Each purity's rate in rupees, as typed; blank where none is set. */
const rateDraft = (rates: GoldRate[]): Record<number, string> =>
  Object.fromEntries(rates.map((r) => [r.purity_karat, paiseToRupees(r.rate_per_gram)]))

/** The Lender's Gold Rate per gram for each purity, which values every Mortgage. */
export function GoldRateSettings() {
  const { client, queryClient } = useServerState()
  const saved = useQuery(settings.goldRates(client))
  const rates = saved.data ?? null
  const [draftOrNull, setDraft] = useDraft(saved.data, rateDraft)
  const draft = draftOrNull ?? {}
  const [savedStatus, setStatus] = useState<Status>(null)
  const status = shownStatus(savedStatus, saved.error)
  const [saving, setSaving] = useState(false)
  const [confirm, confirmDialog] = useConfirm()
  const revalue = useChange(STALE_AFTER.goldRates)

  const filled = (rates ?? []).filter((r) => draft[r.purity_karat])

  async function save(event: FormEvent) {
    event.preventDefault()
    const confirmed = await confirm({
      title: 'Change the Gold Rates?',
      body: (
        <>
          <Summary
            rows={filled.map((r): [string, string] => [
              `${r.purity_karat}K`,
              `${formatINR(rupeesToPaise(draft[r.purity_karat]))} a gram`,
            ])}
          />
          <p className="hint">Every Mortgage valued at the Gold Rate is revalued at once.</p>
        </>
      ),
    })
    if (!confirmed) return
    setSaving(true)
    setStatus(null)
    try {
      const updated = await revalue((client) =>
        settings.saveGoldRates(
          client,
          filled.map((r) => ({
            purity_karat: r.purity_karat,
            rate_per_gram: rupeesToPaise(draft[r.purity_karat]),
          })),
        ),
      )
      queryClient.setQueryData(settings.goldRates(client).queryKey, updated)
      setStatus({ kind: 'saved', text: 'Saved. Collateral Values now use these rates.' })
    } catch (error) {
      setStatus({ kind: 'error', text: (error as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card">
      <h2>Gold Rates</h2>
      <p className="hint">Per gram of gold, used for each Mortgage's Collateral Value.</p>
      {rates === null && status === null && <p>Loading…</p>}
      {rates && (
        <form onSubmit={save} className="stack">
          <table>
            <thead>
              <tr>
                <th>Purity</th>
                <th>₹ a gram</th>
                <th>Last updated</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((rate) => (
                <tr key={rate.purity_karat}>
                  <td>{rate.purity_karat}K</td>
                  <td>
                    <input
                      type="number"
                      aria-label={`${rate.purity_karat}K Gold Rate (₹ a gram)`}
                      min="0.01"
                      step="0.01"
                      value={draft[rate.purity_karat] ?? ''}
                      onChange={(event) =>
                        setDraft({ ...draft, [rate.purity_karat]: event.target.value })
                      }
                    />
                  </td>
                  <td className="hint">
                    {rate.updated_on ? formatDate(rate.updated_on) : 'Not set'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            <button type="submit" disabled={saving || filled.length === 0}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}
      {status && <p className={`status ${status.kind}`}>{status.text}</p>}
      {confirmDialog}
    </section>
  )
}
