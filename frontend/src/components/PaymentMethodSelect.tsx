import type { PaymentMethod } from '../api'
import type { PaymentMethodNames } from './usePaymentMethods'

/** A choice of payment method, by the names the backend gives them; disabled until
 *  they arrive. */
export function PaymentMethodSelect({
  methods,
  value,
  onChange,
}: {
  methods: PaymentMethodNames | null
  value: PaymentMethod
  onChange: (method: PaymentMethod) => void
}) {
  return (
    <select
      value={value}
      disabled={!methods}
      onChange={(event) => onChange(event.target.value as PaymentMethod)}
    >
      {Object.entries(methods ?? {}).map(([method, name]) => (
        <option key={method} value={method}>
          {name}
        </option>
      ))}
    </select>
  )
}
