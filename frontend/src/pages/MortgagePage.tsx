import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import type { LedgerStep, Mortgage } from '../api'
import { CallNotes } from '../components/CallNotes'
import { ClosureSummary, CloseMortgage } from '../components/CloseMortgage'
import { CollateralPanel } from '../components/CollateralPanel'
import { ChangePreview } from '../components/BeforeAfter'
import { History } from '../components/History'
import { PersonLink } from '../components/PersonLink'
import { Photo } from '../components/Photo'
import { PhotoSource } from '../components/PhotoSource'
import { ProjectionPanel } from '../components/ProjectionPanel'
import { ReasonDialog } from '../components/ReasonDialog'
import { ScrollPopup } from '../components/ScrollPopup'
import { TermsPanel } from '../components/TermsPanel'
import { useConfirm } from '../components/useConfirm'
import { formatDate, formatGrams } from '../format'
import { formatINR } from '../money'
import {
  addMortgagePhoto,
  changes,
  mortgageHistoryQuery,
  mortgageQuery,
  previews,
  removeMortgagePhoto,
} from '../requests'
import { keys, useMortgageChange, useServerState } from '../serverState'
import { describeTerms, formatRate, PART_MONTH_RULES } from '../terms'

/** Ledger steps shown on the page; the rest are in the complete Ledger popup. */
const LEDGER_SHOWN = 8

export function MortgagePage() {
  const id = Number(useParams().id)
  const { client, queryClient } = useServerState()
  const changeMortgage = useMortgageChange()
  const loaded = useQuery(mortgageQuery(client, id))
  const mortgage = loaded.data
  // A change that returns the Mortgage (photos, Collateral Value) is in its History too.
  const setMortgage = (changed: Mortgage) => {
    queryClient.setQueryData(keys.mortgage(id), changed)
    void queryClient.invalidateQueries({ queryKey: keys.mortgageHistory(id) })
  }
  const [error, setError] = useState<string | null>(null)
  const [confirm, confirmDialog] = useConfirm()
  const [reopening, setReopening] = useState(false)
  const [fullLedger, setFullLedger] = useState(false)

  async function addPhotos(blobs: Blob[]) {
    setError(null)
    try {
      for (const blob of blobs) setMortgage(await addMortgagePhoto(client, id, blob))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function removePhoto(photoId: number) {
    const confirmed = await confirm({
      title: 'Delete this photo?',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      danger: true,
    })
    if (!confirmed) return
    try {
      setMortgage(await removeMortgagePhoto(client, id, photoId))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function reopen(reason: string) {
    await changeMortgage((client) => changes.reopen(client, id, reason))
  }

  if (!mortgage) {
    return loaded.error ? (
      <p className="status error">{loaded.error.message}</p>
    ) : (
      <p>Loading…</p>
    )
  }
  const { outstanding } = mortgage

  return (
    <section className="card wide">
      <div className="row spread">
        <h2>
          {mortgage.name} <span className={`badge status-${mortgage.status}`}>{mortgage.status}</span>
        </h2>
        <div className="row">
          <span>
            Customer: <PersonLink person={mortgage.customer} />
          </span>
          <Link className="button secondary small" to={`/mortgages/${mortgage.id}/edit`}>
            Edit
          </Link>
          {mortgage.status === 'active' && (
            <Link
              className="button small"
              to={`/payments/new?customer=${mortgage.customer.id}&mortgage=${mortgage.id}`}
            >
              Record a Payment
            </Link>
          )}
        </div>
      </div>
      {error && <p className="status error">{error}</p>}

      <div className="tiles">
        <div className="tile">
          <span className="hint">Outstanding on {formatDate(mortgage.as_of)}</span>
          <strong>{formatINR(outstanding.total)}</strong>
        </div>
        <div className="tile">
          <span className="hint">Principal</span>
          <strong>{formatINR(outstanding.principal)}</strong>
        </div>
        <div className="tile">
          <span className="hint">Unpaid interest</span>
          <strong>{formatINR(outstanding.unpaid_interest)}</strong>
        </div>
      </div>

      <dl>
        <dt>Started</dt>
        <dd>{formatDate(mortgage.start_date)}</dd>
        <dt>Principal lent</dt>
        <dd>{formatINR(mortgage.amount_lent)}</dd>
        <dt>Jewellery</dt>
        <dd>{mortgage.description}</dd>
        <dt>Weight</dt>
        <dd>
          {formatGrams(mortgage.gross_weight_mg)} gross, {formatGrams(mortgage.net_weight_mg)} net,{' '}
          {mortgage.purity_karat}K
        </dd>
      </dl>

      <h3>Terms</h3>
      <TermsPanel mortgage={mortgage} onChange={setMortgage} />

      <h3>Collateral Value</h3>
      <CollateralPanel mortgage={mortgage} onChange={setMortgage} />

      <h3>Call Notes</h3>
      <CallNotes mortgageId={mortgage.id} mortgageName={mortgage.name} />

      <h3>Photos</h3>
      {mortgage.photos.length > 0 ? (
        <div className="gallery">
          {mortgage.photos.map((photo, index) => (
            <div key={photo.id} className="gallery-item">
              <a href={photo.url} target="_blank" rel="noreferrer">
                <Photo url={photo.url} alt={`Photo ${index + 1}`} />
              </a>
              <button
                type="button"
                className="danger small"
                onClick={() => removePhoto(photo.id)}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="hint">No photos yet.</p>
      )}
      <PhotoSource multiple onPhotos={addPhotos} />

      <h3>{mortgage.status === 'active' ? 'Redeem or Forfeit' : 'Closure'}</h3>
      {mortgage.status === 'active' ? (
        <CloseMortgage mortgage={mortgage} onClosed={setMortgage} />
      ) : (
        <div className="stack">
          <ClosureSummary mortgage={mortgage} />
          <div>
            <button type="button" className="secondary small" onClick={() => setReopening(true)}>
              Reopen…
            </button>
          </div>
        </div>
      )}

      <h3>Ledger</h3>
      <p className="hint">
        Calculated from the Terms up to {formatDate(mortgage.as_of)}; nothing here is stored.
      </p>
      <LedgerTable steps={mortgage.ledger.slice(-LEDGER_SHOWN)} mortgage={mortgage} />
      {mortgage.ledger.length > LEDGER_SHOWN && (
        <div className="row">
          <span className="hint">
            Showing the latest {LEDGER_SHOWN} of {mortgage.ledger.length} steps.
          </span>
          <button type="button" className="secondary small" onClick={() => setFullLedger(true)}>
            Show complete Ledger
          </button>
        </div>
      )}
      {fullLedger && (
        <ScrollPopup
          title={`Ledger of ${mortgage.name}`}
          start="bottom"
          onClose={() => setFullLedger(false)}
        >
          <LedgerTable steps={mortgage.ledger} mortgage={mortgage} />
        </ScrollPopup>
      )}

      {mortgage.status === 'active' && (
        <>
          <h3>Projection</h3>
          <ProjectionPanel mortgage={mortgage} />
        </>
      )}

      <h3>History</h3>
      <History query={mortgageHistoryQuery(client, id)} title={`History of ${mortgage.name}`} />
      {reopening && (
        <ReasonDialog
          title={`Reopen ${mortgage.name}?`}
          wide
          body={
            <>
              <p>
                It becomes Active again as if it had never been closed: interest is charged for
                the whole time, up to today.
                {mortgage.closure?.payment_id &&
                  ' Its final Payment is voided, so it is no longer counted.'}
              </p>
              <ChangePreview request={previews.reopen(mortgage.id)} />
            </>
          }
          confirmLabel="Reopen"
          onConfirm={reopen}
          onClose={() => setReopening(false)}
        />
      )}
      {confirmDialog}
    </section>
  )
}

/** Ledger steps as a table, oldest first. */
function LedgerTable({ steps, mortgage }: { steps: LedgerStep[]; mortgage: Mortgage }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Step</th>
            <th className="num">Amount</th>
            <th className="num">Principal</th>
            <th className="num">Unpaid interest</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((step, index) => (
            <tr key={index} className={`ledger-${step.event}`}>
              <td>{formatDate(step.on)}</td>
              <td>
                {step.payment_id ? (
                  <Link to={`/payments/${step.payment_id}`}>{describe(step, mortgage)}</Link>
                ) : (
                  describe(step, mortgage)
                )}
              </td>
              <td className="num">{formatINR(step.amount)}</td>
              <td className="num">{formatINR(step.principal)}</td>
              <td className="num">{formatINR(step.unpaid_interest)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The calculation behind a Ledger step, in words. */
function describe(step: LedgerStep, mortgage: Mortgage): string {
  switch (step.event) {
    case 'started':
      return 'Mortgage started: Principal lent'
    case 'interest':
      return `Interest: ${formatRate(mortgage.terms.monthly_rate_bps)} of ${formatINR(step.charged_on)}`
    case 'payment':
      return (
        `Payment: ${formatINR(step.interest_paid)} to interest, ` +
        `${formatINR(step.principal_paid)} to Principal`
      )
    case 'part_month':
      return (
        `Part-month interest: ${step.part_month_days} days since the last Accrual Date ` +
        `(${PART_MONTH_RULES[mortgage.terms.part_month_rule]}) on ${formatINR(step.charged_on)}`
      )
    case 'forfeited':
      return 'Forfeited: the jewellery settles what was owed'
    case 'capitalised':
      return 'Unpaid interest capitalised into Principal'
    case 'term_changed':
      return `Terms changed: ${step.terms ? describeTerms(step.terms) : ''}`
  }
}
