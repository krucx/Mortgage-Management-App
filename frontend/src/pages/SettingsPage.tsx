import { useEffect, useState, type FormEvent } from 'react'
import { api, type DefaultTerms, type InterestMode, type PartMonthRule } from '../api'

const INTEREST_MODES: Record<InterestMode, string> = {
  simple: 'Simple',
  compounded_yearly: 'Compounded Yearly (simple monthly, capitalised every year)',
  compounded_monthly: 'Compounded Monthly',
}

const PART_MONTH_RULES: Record<PartMonthRule, string> = {
  full_month: 'Full month',
  pro_rata: 'Pro-rata by day',
  nothing: 'Nothing',
}

const bpsToPercent = (bps: number) => (bps / 100).toString()
const percentToBps = (percent: string) => Math.round(Number(percent) * 100)

export function SettingsPage() {
  const [terms, setTerms] = useState<DefaultTerms | null>(null)
  const [ratePercent, setRatePercent] = useState('')
  const [status, setStatus] = useState<{ kind: 'saved' | 'error'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api
      .getDefaultTerms()
      .then((loaded) => {
        setTerms(loaded)
        setRatePercent(bpsToPercent(loaded.monthly_rate_bps))
      })
      .catch((error: Error) => setStatus({ kind: 'error', text: error.message }))
  }, [])

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!terms) return
    setSaving(true)
    setStatus(null)
    try {
      const saved = await api.updateDefaultTerms({
        ...terms,
        monthly_rate_bps: percentToBps(ratePercent),
      })
      setTerms(saved)
      setRatePercent(bpsToPercent(saved.monthly_rate_bps))
      setStatus({ kind: 'saved', text: 'Saved. New Mortgages will start with these Terms.' })
    } catch (error) {
      setStatus({ kind: 'error', text: (error as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card">
      <h2>Default Terms</h2>
      <p className="hint">
        Copied into every new Mortgage when it is created. Changing them never affects existing
        Mortgages.
      </p>

      {terms === null && status === null && <p>Loading…</p>}

      {terms && (
        <form onSubmit={save}>
          <label>
            Monthly interest rate (%)
            <input
              type="number"
              min="0.01"
              max="100"
              step="0.01"
              required
              value={ratePercent}
              onChange={(event) => setRatePercent(event.target.value)}
            />
          </label>

          <label>
            Interest Mode
            <select
              value={terms.interest_mode}
              onChange={(event) =>
                setTerms({ ...terms, interest_mode: event.target.value as InterestMode })
              }
            >
              {Object.entries(INTEREST_MODES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Part-Month Rule (charged on redemption)
            <select
              value={terms.part_month_rule}
              onChange={(event) =>
                setTerms({ ...terms, part_month_rule: event.target.value as PartMonthRule })
              }
            >
              {Object.entries(PART_MONTH_RULES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </form>
      )}

      {status && <p className={`status ${status.kind}`}>{status.text}</p>}
    </section>
  )
}
