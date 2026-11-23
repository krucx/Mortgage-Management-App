import { useState } from 'react'
import { Link } from 'react-router'
import type { LedgerStep, Mortgage } from '../../api'
import { ScrollPopup } from '../../components/ScrollPopup'
import { formatDate } from '../../format'
import { formatINR } from '../../money'
import styles from './Ledger.module.css'
import { describeStep, instalmentName, stepDate } from './ledgerSteps'

/** How a step's row stands out, by its kind; the rest read plain. */
const STEP_ROWS: Partial<Record<LedgerStep['event'], string>> = {
  payment: styles.payment,
  capitalised: styles.capitalised,
  interest_to_date: styles.interestToDate,
}

/** Ledger steps shown on the page; the rest are in the complete Ledger popup. */
const LEDGER_SHOWN = 8

/** The Mortgage's latest Ledger steps, and the complete Ledger in a popup. */
export function Ledger({ mortgage }: { mortgage: Mortgage }) {
  const [complete, setComplete] = useState(false)
  const { ledger } = mortgage
  return (
    <>
      <p className="hint">
        Calculated from the Terms up to {formatDate(mortgage.as_of)}; nothing here is stored.
      </p>
      <LedgerTable steps={ledger.slice(-LEDGER_SHOWN)} mortgage={mortgage} />
      {ledger.length > LEDGER_SHOWN && (
        <div className="row">
          <span className="hint">
            Showing the latest {LEDGER_SHOWN} of {ledger.length} steps.
          </span>
          <button type="button" className="secondary small" onClick={() => setComplete(true)}>
            Show complete Ledger
          </button>
        </div>
      )}
      {complete && (
        <ScrollPopup
          title={`Ledger of ${mortgage.name}`}
          start="bottom"
          onClose={() => setComplete(false)}
        >
          <LedgerTable steps={ledger} mortgage={mortgage} />
        </ScrollPopup>
      )}
    </>
  )
}

/** Ledger steps as a table, oldest first, then an Active Mortgage's upcoming Advance
 *  Instalments, in grey: not yet applied, so not yet in the Ledger. */
function LedgerTable({ steps, mortgage }: { steps: LedgerStep[]; mortgage: Mortgage }) {
  const graces = new Map(mortgage.graces.map((grace) => [grace.payment_id, grace]))
  const instalments = new Map(mortgage.advance_instalments.map((i) => [i.id, i]))
  const upcoming =
    mortgage.status === 'active' ? mortgage.advance_instalments.filter((i) => i.upcoming) : []
  return (
    <div className="table-scroll">
      <table aria-label="Ledger">
        <thead>
          <tr>
            <th>Date</th>
            <th>Step</th>
            <th className="num">Amount</th>
            <th className="num">Discount</th>
            <th className="num">Principal</th>
            <th className="num">Unpaid interest</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((step, index) => (
            <tr key={index} className={STEP_ROWS[step.event]}>
              <td>{stepDate(step, graces)}</td>
              <td>
                {step.payment_id ? (
                  <Link to={`/payments/${step.payment_id}`}>
                    {describeStep(step, mortgage, instalments.get(step.instalment_id ?? 0))}
                  </Link>
                ) : (
                  describeStep(step, mortgage)
                )}
              </td>
              <td className="num">{formatINR(step.amount)}</td>
              <td className="num">{step.event === 'payment' ? formatINR(step.discount) : '—'}</td>
              <td className="num">{formatINR(step.principal)}</td>
              <td className="num">{formatINR(step.unpaid_interest)}</td>
            </tr>
          ))}
          {upcoming.map((instalment) => (
            <tr key={`upcoming-${instalment.id}`} className={styles.upcoming}>
              <td>{formatDate(instalment.on)}</td>
              <td>
                <Link to={`/payments/${instalment.payment_id}`}>{instalmentName(instalment)}</Link>{' '}
                <span className="badge">Upcoming</span>
              </td>
              <td className="num">{formatINR(instalment.amount)}</td>
              <td className="num">—</td>
              <td className="num">—</td>
              <td className="num">—</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
