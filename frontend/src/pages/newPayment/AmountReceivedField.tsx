import { ReasonTip } from '../../components/ReasonTip'
import { formatINR } from '../../money'

/** The cash received, with a shortcut to pay the full Outstanding (or why it can't be). */
export function AmountReceivedField({
  totalText,
  onTotalText,
  required,
  fullOutstanding,
  notRedeemable,
  loading,
  onPayFull,
}: {
  totalText: string
  onTotalText: (text: string) => void
  required: boolean
  /** The chosen Mortgages' whole Outstanding; null with none chosen. */
  fullOutstanding: number | null
  notRedeemable: string | null | undefined
  /** The rows for a new date are loading, so not yet the figures to pay. */
  loading: boolean
  onPayFull: () => void
}) {
  return (
    <label>
      Amount received (₹)
      <input
        type="number"
        required={required}
        min="0"
        step="0.01"
        value={totalText}
        onChange={(event) => onTotalText(event.target.value)}
      />
      {fullOutstanding !== null && (
        <button
          type="button"
          className="link"
          // Not on the last date's figures while the new date's rows load
          disabled={!!notRedeemable || loading}
          onClick={onPayFull}
        >
          Pay the full Outstanding ({formatINR(fullOutstanding)})
        </button>
      )}
      {fullOutstanding !== null && notRedeemable && (
        <span>
          <ReasonTip reason={notRedeemable}>Can't pay it in full</ReasonTip>
        </span>
      )}
    </label>
  )
}
