import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api, type LedgerStep, type Mortgage } from '../api'
import { ClosureSummary, CloseMortgage } from '../components/CloseMortgage'
import { PersonLink } from '../components/PersonLink'
import { Photo } from '../components/Photo'
import { PhotoSource } from '../components/PhotoSource'
import { useConfirm } from '../components/useConfirm'
import { formatDate, formatGrams } from '../format'
import { formatINR } from '../money'
import { formatRate, INTEREST_MODES, PART_MONTH_RULES } from '../terms'

export function MortgagePage() {
  const id = Number(useParams().id)
  const [mortgage, setMortgage] = useState<Mortgage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, confirmDialog] = useConfirm()

  useEffect(() => {
    api
      .getMortgage(id)
      .then(setMortgage)
      .catch((err: Error) => setError(err.message))
  }, [id])

  async function addPhotos(blobs: Blob[]) {
    setError(null)
    try {
      for (const blob of blobs) setMortgage(await api.addMortgagePhoto(id, blob))
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
      setMortgage(await api.deleteMortgagePhoto(id, photoId))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  if (!mortgage) return error ? <p className="status error">{error}</p> : <p>Loading…</p>
  const { terms, outstanding } = mortgage

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
        <dt>Terms</dt>
        <dd>
          {formatRate(terms.monthly_rate_bps)} a month · {INTEREST_MODES[terms.interest_mode]} ·
          Part-Month Rule: {PART_MONTH_RULES[terms.part_month_rule]}
        </dd>
      </dl>

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
        <ClosureSummary mortgage={mortgage} />
      )}

      <h3>Ledger</h3>
      <p className="hint">
        Calculated from the Terms up to {formatDate(mortgage.as_of)}; nothing here is stored.
      </p>
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
            {mortgage.ledger.map((step, index) => (
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
      {confirmDialog}
    </section>
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
  }
}
