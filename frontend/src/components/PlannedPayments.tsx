import { useState } from 'react'
import {
  filledIn,
  type Inputs,
  type LumpSumDraft,
  type Problems,
  type Refusal,
  type Run,
} from '../calculator'
import { FieldProblem } from './FieldProblem'

/** A Simulation's plan: a monthly amount and Lump Sums, each row with why it is refused or
 *  was left out; folded away unless one was entered. */
export function PlannedPayments({
  inputs: { monthly, lumps },
  problem,
  change,
  refusal,
  runs,
}: {
  inputs: Inputs
  problem: Problems
  change: (changes: Partial<Inputs>) => void
  refusal: Refusal | null
  runs: Run[] | null
}) {
  const [open] = useState(() => !!(monthly || lumps.length))
  const sent = filledIn(lumps)
  function setLump(row: number, changes: Partial<LumpSumDraft>) {
    change({ lumps: lumps.map((lump, i) => (i === row ? { ...lump, ...changes } : lump)) })
  }
  return (
    <details className="tucked" open={open}>
      <summary>Planned Payments</summary>
      <div className="stack">
        <label>
          Monthly payment (₹)
          <input
            type="number"
            min="1"
            step="1"
            value={monthly}
            onChange={(event) => change({ monthly: event.target.value })}
          />
          <FieldProblem problem={problem.monthly} />
        </label>
        <p className="hint">
          Paid on every Accrual Date, never more than is owed, until nothing is.
        </p>
        {lumps.map((lump, row) => {
          const answered = sent.findIndex((s) => s.row === row)
          return (
            <div key={row} className="row lump-sum">
              <label>
                Date
                <input
                  type="date"
                  aria-label={`Lump Sum ${row + 1} date`}
                  value={lump.on}
                  onChange={(event) => setLump(row, { on: event.target.value })}
                />
              </label>
              <label>
                Amount (₹)
                <input
                  type="number"
                  min="1"
                  step="1"
                  aria-label={`Lump Sum ${row + 1} amount (₹)`}
                  value={lump.amount}
                  onChange={(event) => setLump(row, { amount: event.target.value })}
                />
              </label>
              <button
                type="button"
                className="secondary small"
                aria-label={`Remove Lump Sum ${row + 1}`}
                onClick={() => change({ lumps: lumps.filter((_, i) => i !== row) })}
              >
                Remove
              </button>
              <FieldProblem problem={problem.lumps[row].on} />
              <FieldProblem problem={problem.lumps[row].amount} />
              <FieldProblem problem={refusal?.row === row ? refusal.message : null} />
              {runs && answered >= 0 && <Ignored runs={runs} index={answered} />}
            </div>
          )
        })}
        <div className="row">
          <button
            type="button"
            className="secondary small"
            onClick={() => change({ lumps: [...lumps, { on: '', amount: '' }] })}
          >
            Add a Lump Sum
          </button>
        </div>
      </div>
    </details>
  )
}

/** Why the `index`th Lump Sum asked for was left out, if it was. */
function Ignored({ runs, index }: { runs: Run[]; index: number }) {
  const ignoredBy = runs.map((run) => run.simulation.lump_sums[index]?.ignored ?? null)
  const reason = ignoredBy.find(Boolean)
  if (!reason) return null
  const text = reason === 'after_closed_on' ? 'Ignored: after Closed on' : 'Ignored: paid off by then'
  // Paid off sooner under one set of Terms than the other
  const under = ignoredBy.every(Boolean) ? '' : ` under ${runs[ignoredBy.indexOf(reason)].label}`
  return <span className="hint">{text + under}</span>
}
