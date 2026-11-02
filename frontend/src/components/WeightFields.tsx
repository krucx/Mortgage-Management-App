import type { Weights } from '../weight'

/** The gross and net weight fields of a Mortgage; net can't be more than gross. */
export function WeightFields({
  value,
  onChange,
  disabled = false,
}: {
  value: Weights
  onChange: (weights: Weights) => void
  disabled?: boolean
}) {
  return (
    <>
      <label>
        Gross weight (grams)
        <input
          type="number"
          required
          min="0.001"
          step="0.001"
          disabled={disabled}
          value={value.gross}
          onChange={(event) => onChange({ ...value, gross: event.target.value })}
        />
      </label>
      <label>
        Net weight, gold only (grams)
        <input
          type="number"
          required
          min="0.001"
          step="0.001"
          max={value.gross || undefined}
          disabled={disabled}
          value={value.net}
          onChange={(event) => onChange({ ...value, net: event.target.value })}
        />
      </label>
    </>
  )
}
