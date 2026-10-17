import { useState } from 'react'
import { Link } from 'react-router'
import { api, type Mortgage } from '../api'
import { formatDate } from '../format'
import { describeTerms } from '../terms'
import { ChangePreview } from './BeforeAfter'
import { useConfirm } from './useConfirm'

/** The Terms in force, and Term Changes past and coming. */
export function TermsPanel({
  mortgage,
  onChange,
}: {
  mortgage: Mortgage
  onChange: (updated: Mortgage) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [confirm, confirmDialog] = useConfirm()
  async function remove(changeId: number, from: string) {
    const confirmed = await confirm({
      title: `Remove the Term Change from ${formatDate(from)}?`,
      body: (
        <ChangePreview load={() => api.previewTermChangeRemoval(mortgage.id, changeId)} />
      ),
      wide: true,
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
      danger: true,
    })
    if (!confirmed) return
    try {
      onChange(await api.removeTermChange(mortgage.id, changeId))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="stack">
      <p>
        {describeTerms(mortgage.terms)}
        {mortgage.term_changes.length > 0 && <span className="hint"> (in force today)</span>}
      </p>
      {mortgage.term_changes.length > 0 && (
        <ul className="term-changes">
          {mortgage.term_changes.map((change) => (
            <li key={change.id}>
              <strong>From {formatDate(change.effective_on)}:</strong> {describeTerms(change.terms)}
              {change.removable ? (
                <>
                  {' '}
                  <span className="badge">coming</span>{' '}
                  <button
                    type="button"
                    className="danger small"
                    onClick={() => remove(change.id, change.effective_on)}
                  >
                    Remove
                  </button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {mortgage.status === 'active' && (
        <div>
          <Link className="button secondary small" to={`/mortgages/${mortgage.id}/terms`}>
            Change Terms…
          </Link>
        </div>
      )}
      {error && <p className="status error">{error}</p>}
      {confirmDialog}
    </div>
  )
}
