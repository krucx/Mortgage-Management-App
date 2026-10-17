import type { LedgerChange, LedgerStep, MortgagePreview } from '../api'
import type { usePreview } from './usePreview'
import { formatDate } from '../format'
import { formatChange, formatINR } from '../money'
import { ProjectionChart } from './ProjectionChart'

const HORIZONS = [3, 6, 12]

const STEP_LABELS: Record<LedgerStep['event'], string> = {
  started: 'Principal lent',
  interest: 'Interest',
  part_month: 'Part-month interest',
  payment: 'Payment',
  capitalised: 'Capitalised',
  forfeited: 'Forfeited',
  term_changed: 'Terms changed',
}

/** Each Mortgage's Projection and Ledger before and after an unsaved change. */
export function BeforeAfter({ previews }: { previews: MortgagePreview[] }) {
  return (
    <div className="stack">
      {previews.map((preview) => (
        <MortgageBeforeAfter
          key={preview.mortgage_id}
          preview={preview}
          showName={previews.length > 1}
        />
      ))}
    </div>
  )
}

function MortgageBeforeAfter({
  preview,
  showName,
}: {
  preview: MortgagePreview
  showName: boolean
}) {
  const { before, after } = preview
  const at = (points: typeof before.points, months: number) =>
    points.find((p) => p.months === months)
  // With no Payments, what is owed grows only by interest.
  const owed = (side: typeof before, months: number) => {
    const point = at(side.points, months)
    return point ? point.principal + point.unpaid_interest : undefined
  }
  const yearsInterest = (side: typeof before) => {
    const start = owed(side, 0)
    const end = owed(side, 12)
    return start === undefined || end === undefined ? undefined : end - start
  }
  const interestBefore = yearsInterest(before)
  const interestAfter = yearsInterest(after)

  return (
    <div className="stack before-after">
      {showName && <strong>{preview.mortgage_name}</strong>}
      <div className="change-summary">
        <Headline
          label="Owed today"
          before={before.outstanding}
          after={after.outstanding}
        />
        {interestBefore !== undefined && interestAfter !== undefined && (
          <Headline
            label="Interest over the next 12 months"
            before={interestBefore}
            after={interestAfter}
          />
        )}
      </div>

      {before.points.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Redemption Amount</th>
                <th className="num">Now</th>
                <th className="num">After the change</th>
                <th className="num">Difference</th>
              </tr>
            </thead>
            <tbody>
              {HORIZONS.map((months) => {
                const was = at(before.points, months)
                const will = at(after.points, months)
                if (!was || !will) return null
                const difference = will.redemption_amount - was.redemption_amount
                return (
                  <tr key={months}>
                    <td>
                      In {months} months <span className="hint">({formatDate(was.on)})</span>
                    </td>
                    <td className="num">{formatINR(was.redemption_amount)}</td>
                    <td className="num">{formatINR(will.redemption_amount)}</td>
                    <td className={`num ${difference ? 'changed' : 'hint'}`}>
                      {formatChange(difference)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <ProjectionChart
        series={[
          { label: 'Now', className: 'baseline', points: before.points },
          { label: 'After the change', className: 'what-if', points: after.points },
        ]}
        events={[...after.events, ...before.events]}
      />

      <LedgerChanges changes={preview.ledger_changes} />
    </div>
  )
}

function Headline({ label, before, after }: { label: string; before: number; after: number }) {
  const difference = after - before
  return (
    <div className={`tile ${difference ? 'changed' : ''}`}>
      <span className="hint">{label}</span>
      <span>
        {formatINR(before)} → <strong>{formatINR(after)}</strong>
      </span>
      <span className={difference ? 'changed' : 'hint'}>{formatChange(difference)}</span>
    </div>
  )
}

function LedgerChanges({ changes }: { changes: LedgerChange[] }) {
  if (changes.length === 0) {
    return <p className="hint">No change to the Ledger so far: only the months ahead differ.</p>
  }
  const amount = (step: LedgerStep | null) => (step ? formatINR(step.amount) : '—')
  const owed = (step: LedgerStep | null) =>
    step ? formatINR(step.principal + step.unpaid_interest) : '—'
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Ledger steps that change</th>
            <th className="num">Amount now</th>
            <th className="num">After</th>
            <th className="num">Owed after the step: now</th>
            <th className="num">After</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((change) => (
            <tr key={`${change.on}-${change.event}-${change.before?.payment_id ?? change.after?.payment_id ?? ''}`}>
              <td>
                {formatDate(change.on)} {STEP_LABELS[change.event]}
                {!change.after && <span className="hint"> (removed)</span>}
                {!change.before && <span className="hint"> (added)</span>}
              </td>
              <td className="num">{amount(change.before)}</td>
              <td className="num changed">{amount(change.after)}</td>
              <td className="num">{owed(change.before)}</td>
              <td className="num changed">{owed(change.after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** A preview as it loads: the last answer stays, dimmed, until the next arrives. */
export function PreviewSection({ preview }: { preview: ReturnType<typeof usePreview> }) {
  if (preview.error) return <p className="status error">{preview.error}</p>
  if (!preview.previews) return <p className="hint">Working out what changes…</p>
  return (
    <div className={preview.loading ? 'refreshing' : undefined}>
      <BeforeAfter previews={preview.previews} />
    </div>
  )
}
