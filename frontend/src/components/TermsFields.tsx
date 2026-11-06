import type { InterestMode, PartMonthRule } from '../api'
import { INTEREST_MODES, PART_MONTH_RULES, type TermsDraft } from '../terms'

export function TermsFields({
  value,
  onChange,
  rateProblem = null,
}: {
  value: TermsDraft
  onChange: (draft: TermsDraft) => void
  /** Why the rate is refused, shown beside it. */
  rateProblem?: string | null
}) {
  return (
    <>
      <label>
        Monthly interest rate (%)
        <input
          type="number"
          min="0.01"
          max="100"
          step="0.01"
          required
          value={value.ratePercent}
          onChange={(event) => onChange({ ...value, ratePercent: event.target.value })}
        />
        {rateProblem && <span className="status error">{rateProblem}</span>}
      </label>
      <label>
        Interest Mode
        <select
          value={value.interest_mode}
          onChange={(event) =>
            onChange({ ...value, interest_mode: event.target.value as InterestMode })
          }
        >
          {Object.entries(INTEREST_MODES).map(([mode, label]) => (
            <option key={mode} value={mode}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Part-Month Rule (Interest to Date for the month under way)
        <select
          value={value.part_month_rule}
          onChange={(event) =>
            onChange({ ...value, part_month_rule: event.target.value as PartMonthRule })
          }
        >
          {Object.entries(PART_MONTH_RULES).map(([rule, label]) => (
            <option key={rule} value={rule}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </>
  )
}
