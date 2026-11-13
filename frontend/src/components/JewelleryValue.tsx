import { useState } from 'react'
import { PURITIES, type GoldRate, type Purity } from '../api'
import { amountProblem, collateralOf, type Inputs } from '../calculator'
import { formatINR } from '../money'
import { gramsToMg } from '../weight'
import { FieldProblem } from './FieldProblem'

/** The optional jewellery value, folded away unless one was entered. */
export function JewelleryValue({
  inputs,
  change,
  goldRates,
}: {
  inputs: Inputs
  change: (changes: Partial<Inputs>) => void
  goldRates: GoldRate[] | undefined
}) {
  const [open] = useState(() => !!(inputs.net || inputs.value))
  const collateral = collateralOf(inputs, goldRates)
  const unpriced =
    gramsToMg(inputs.net) > 0 &&
    !inputs.value &&
    goldRates &&
    !goldRates.find((r) => r.purity_karat === inputs.purity)?.rate_per_gram
  return (
    <details className="tucked" open={open}>
      <summary>Jewellery value</summary>
      <p className="hint">
        What the jewellery is worth today, to measure the loan against: its net weight at today's
        Gold Rate, or a Collateral Value typed in, which counts instead.
      </p>
      <div className="grid-3">
        <label>
          Net weight, gold only (grams)
          <input
            type="number"
            min="0"
            step="0.001"
            value={inputs.net}
            onChange={(event) => change({ net: event.target.value })}
          />
        </label>
        <label>
          Purity
          <select
            value={inputs.purity}
            onChange={(event) => change({ purity: Number(event.target.value) as Purity })}
          >
            {PURITIES.map((karat) => (
              <option key={karat} value={karat}>
                {karat}K
              </option>
            ))}
          </select>
        </label>
        <label>
          Collateral Value (₹)
          <input
            type="number"
            min="1"
            step="1"
            value={inputs.value}
            onChange={(event) => change({ value: event.target.value })}
          />
          <FieldProblem problem={amountProblem(inputs.value)} />
        </label>
      </div>
      {unpriced && (
        <p className="hint">
          No Gold Rate set for {inputs.purity}K: type a Collateral Value instead
        </p>
      )}
      {collateral?.rate && (
        <p className="hint">
          Collateral Value {formatINR(collateral.value)} at {formatINR(collateral.rate)} a gram
        </p>
      )}
    </details>
  )
}
