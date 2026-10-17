import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { api, type Mortgage } from '../api'
import { formatDate, formatPercent } from '../format'
import { formatINR, rupeesToPaise } from '../money'
import { Summary } from './ConfirmDialog'
import { useConfirm } from './useConfirm'

/** Collateral Value and Loan-to-Value, with a Collateral Value set by hand if needed. */
export function CollateralPanel({
  mortgage,
  onChange,
}: {
  mortgage: Mortgage
  onChange: (updated: Mortgage) => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, confirmDialog] = useConfirm()
  const collateral = mortgage.collateral

  async function save(paise: number | null) {
    const confirmed = await confirm(
      paise === null
        ? {
            title: 'Value at the Gold Rate again?',
            body: (
              <p>
                The Collateral Value set by hand is dropped; the {mortgage.purity_karat}K Gold Rate
                is used instead.
              </p>
            ),
          }
        : {
            title: 'Set the Collateral Value by hand?',
            body: (
              <>
                <Summary rows={[['Collateral Value', formatINR(paise)]]} />
                <p className="hint">Gold Rate changes no longer affect this Mortgage.</p>
              </>
            ),
          },
    )
    if (!confirmed) return
    setSaving(true)
    setError(null)
    try {
      onChange(await api.setCollateral(mortgage.id, paise))
      setEditing(false)
      setValue('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void save(rupeesToPaise(value))
  }

  return (
    <div className="stack">
      {collateral ? (
        <p>
          <strong>{formatINR(collateral.value)}</strong>{' '}
          {collateral.source === 'manual' ? (
            <span className="hint">set by hand on {formatDate(collateral.set_on)}</span>
          ) : (
            <span className="hint">
              at the {mortgage.purity_karat}K Gold Rate of {formatDate(collateral.set_on)}
            </span>
          )}
          {mortgage.status === 'active' && (
            <>
              {' · '}Loan-to-Value <strong>{formatPercent(collateral.loan_to_value)}</strong>
            </>
          )}
        </p>
      ) : (
        <p className="hint">
          No Collateral Value yet: set the {mortgage.purity_karat}K Gold Rate in{' '}
          <Link to="/settings">Settings</Link>, or set a value by hand.
        </p>
      )}
      {editing ? (
        <form onSubmit={submit} className="row">
          <label>
            Collateral Value (₹)
            <input
              type="number"
              required
              min="0.01"
              step="0.01"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
          <button type="submit" disabled={saving}>
            Save
          </button>
          <button type="button" className="secondary" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <div className="row">
          <button type="button" className="secondary small" onClick={() => setEditing(true)}>
            Set by hand…
          </button>
          {collateral?.source === 'manual' && (
            <button
              type="button"
              className="secondary small"
              disabled={saving}
              onClick={() => void save(null)}
            >
              Use the Gold Rate
            </button>
          )}
        </div>
      )}
      {error && <p className="status error">{error}</p>}
      {confirmDialog}
    </div>
  )
}
