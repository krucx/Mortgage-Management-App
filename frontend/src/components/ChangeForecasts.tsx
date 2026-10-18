import { useEffect, useState } from 'react'
import { api, type CollateralPreview, type MortgageIn, type NewMortgagePreview } from '../api'
import { formatDate, formatPercent } from '../format'
import { formatINR } from '../money'
import { Summary } from './ConfirmDialog'
import { ProjectionChart } from './ProjectionChart'

/** An answer from the backend, or its error, for as long as `load` stays the same. */
function useAnswer<T>(load: () => Promise<T>): { answer: T | null; error: string | null } {
  const [state, setState] = useState<{ answer: T | null; error: string | null }>({
    answer: null,
    error: null,
  })
  useEffect(() => {
    let live = true
    load().then(
      (answer) => live && setState({ answer, error: null }),
      (err: Error) => live && setState({ answer: null, error: err.message }),
    )
    return () => {
      live = false
    }
  }, [load])
  return state
}

/** What a new Mortgage would owe: today (if back-dated) and over a year with no
 *  Payments, from the backend's preview of creating it. */
export function NewMortgageForecast({ mortgage }: { mortgage: MortgageIn }) {
  const [load] = useState(() => () => api.previewNewMortgage(mortgage))
  const { answer, error } = useAnswer<NewMortgagePreview>(load)
  if (error) return <p className="status error">{error}</p>
  if (!answer) return <p className="hint">Working out what it will owe…</p>
  const { after } = answer
  const last = after.points.at(-1)
  return (
    <>
      <Summary
        rows={[
          ['Owed today', formatINR(after.outstanding)],
          ...(last
            ? ([
                [
                  `Owed on ${formatDate(last.on)} with no Payments`,
                  formatINR(last.principal + last.unpaid_interest),
                ],
              ] as [string, string][])
            : []),
        ]}
      />
      <ProjectionChart
        series={[{ label: 'With no Payments', className: 'baseline', points: after.points }]}
        termChanges={after.term_changes}
      />
    </>
  )
}

/** The Collateral Value and Loan-to-Value before and after setting it, and what that
 *  does to the Call List, from the backend's preview of the change. */
export function CollateralForecast({
  mortgageId,
  value,
}: {
  mortgageId: number
  value: number | null
}) {
  const [load] = useState(() => () => api.previewCollateral(mortgageId, value))
  const { answer, error } = useAnswer<CollateralPreview>(load)
  if (error) return <p className="status error">{error}</p>
  if (!answer) return <p className="hint">Working out the Loan-to-Value…</p>
  const shown = (side: CollateralPreview['before']) =>
    side ? `${formatINR(side.value)} · ${formatPercent(side.loan_to_value)}` : 'none'
  return (
    <>
      <Summary
        rows={[
          ['Now (value · Loan-to-Value)', shown(answer.before)],
          ['After', shown(answer.after)],
        ]}
      />
      {answer.listed_before !== answer.listed_after && (
        <p className="status warning">
          {answer.listed_after
            ? 'Its Loan-to-Value would put it on the Call List.'
            : 'Its Loan-to-Value would take it off the Call List.'}
        </p>
      )}
    </>
  )
}
