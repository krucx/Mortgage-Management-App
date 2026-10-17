import { useState, type FormEvent } from 'react'
import { api, PAYMENT_METHODS, type Mortgage, type PaymentMethod } from '../api'
import { todayIso } from '../format'
import { formatINR, rupeesToPaise } from '../money'

/** Record a Payment from the Customer against this one Mortgage. */
export function RecordPayment({
  mortgage,
  onRecorded,
}: {
  mortgage: Mortgage
  onRecorded: () => void
}) {
  const [paidOn, setPaidOn] = useState(todayIso())
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [reference, setReference] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [recorded, setRecorded] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setRecorded(null)
    const paise = rupeesToPaise(amount)
    try {
      const payment = await api.recordPayment({
        customer_id: mortgage.customer.id,
        paid_on: paidOn,
        amount: paise,
        method,
        reference: reference.trim() || null,
        allocations: [{ mortgage_id: mortgage.id, amount: paise }],
      })
      const [allocation] = payment.allocations
      setRecorded(
        `Payment of ${formatINR(payment.amount)} recorded: ` +
          `${formatINR(allocation.interest_paid)} to interest, ` +
          `${formatINR(allocation.principal_paid)} to Principal.`,
      )
      setAmount('')
      setReference('')
      onRecorded()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="stack">
      <div className="grid-3">
        <label>
          Date paid
          <input
            type="date"
            required
            min={mortgage.start_date}
            max={todayIso()}
            value={paidOn}
            onChange={(event) => setPaidOn(event.target.value)}
          />
        </label>
        <label>
          Amount (₹)
          <input
            type="number"
            required
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          {paidOn === todayIso() && (
            <button
              type="button"
              className="link"
              onClick={() => setAmount(String(mortgage.outstanding.total / 100))}
            >
              Pay the full Outstanding ({formatINR(mortgage.outstanding.total)})
            </button>
          )}
        </label>
        <label>
          Method
          <select
            value={method}
            onChange={(event) => setMethod(event.target.value as PaymentMethod)}
          >
            {Object.entries(PAYMENT_METHODS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Reference (optional)
        <input
          placeholder="e.g. UPI transaction ID"
          value={reference}
          onChange={(event) => setReference(event.target.value)}
        />
      </label>
      <div className="row">
        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Record Payment'}
        </button>
        <span className="hint">Pays unpaid interest first, then Principal.</span>
      </div>
      {error && <p className="status error">{error}</p>}
      {recorded && <p className="status saved">{recorded}</p>}
    </form>
  )
}
