import type { PaymentMethod } from '../api'
import type { PaymentMethodNames } from './usePaymentMethods'

/** A choice of payment method, by the names the backend gives them; disabled until
 *  they arrive. With a `placeholder`, nothing need be chosen yet (`value` null), shown as it. */
export function PaymentMethodSelect({
  methods,
  value,
  onChange,
  placeholder,
  ...attributes
}: {
  methods: PaymentMethodNames | null
  value: PaymentMethod | null
  onChange: (method: PaymentMethod) => void
  placeholder?: string
  required?: boolean
}) {
  return (
    <select
      {...attributes}
      value={value ?? ''}
      disabled={!methods}
      onChange={(event) => onChange(event.target.value as PaymentMethod)}
    >
      {placeholder !== undefined && value === null && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {Object.entries(methods ?? {}).map(([method, name]) => (
        <option key={method} value={method}>
          {name}
        </option>
      ))}
    </select>
  )
}
