import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { api, PAYMENT_METHODS, type Customer, type MortgageRow, type PaymentMethod } from '../api'
import { CustomerChooser } from '../components/CustomerChooser'
import { formatDate, todayIso } from '../format'
import { formatINR, rupeesToPaise } from '../money'
import { allocateEqually, amountsFromPercentages, percentagesOf } from '../allocate'

type AllocationMode = 'equal' | 'amount' | 'percent'

/**
 * Record a lump-sum Payment: pick the Customer, choose their Mortgages, enter the total,
 * review the suggested Allocations, adjust them if needed, save.
 */
export function NewPaymentPage() {
  const [params, setParams] = useSearchParams()
  const customerId = Number(params.get('customer')) || undefined
  const preselected = Number(params.get('mortgage')) || undefined
  const [customer, setCustomer] = useState<Customer | null>(null)

  useEffect(() => {
    if (customerId) api.getCustomer(customerId).then(setCustomer, () => setCustomer(null))
  }, [customerId])

  return (
    <section className="card wide">
      <h2>Record a Payment</h2>
      {customerId && customer?.id === customerId ? (
        <>
          <div className="row spread">
            <span>
              From{' '}
              <Link to={`/customers/${customer.id}`}>
                <strong>{customer.name}</strong>
              </Link>{' '}
              <span className="hint">{customer.phone_1}</span>
            </span>
            <button type="button" className="secondary small" onClick={() => setParams({})}>
              Change Customer
            </button>
          </div>
          <PaymentForm customer={customer} preselected={preselected} />
        </>
      ) : (
        <CustomerChooser onChoose={(id) => setParams({ customer: String(id) })} />
      )}
    </section>
  )
}

function PaymentForm({ customer, preselected }: { customer: Customer; preselected?: number }) {
  const navigate = useNavigate()
  const [paidOn, setPaidOn] = useState(todayIso())
  const [mortgages, setMortgages] = useState<MortgageRow[] | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [totalText, setTotalText] = useState('')
  const [mode, setMode] = useState<AllocationMode>('equal')
  const [amountText, setAmountText] = useState<Record<number, string>>({})
  const [percentText, setPercentText] = useState<Record<number, string>>({})
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [reference, setReference] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const selectionStarted = useRef(false)

  // Each Active Mortgage's Outstanding on the Payment date (it may be back-dated).
  useEffect(() => {
    if (!paidOn) return
    api
      .listMortgages(1, '', { customerId: customer.id, status: 'active', asOf: paidOn })
      .then((page) => {
        setMortgages(page.items)
        setSelected((current) => {
          // A Mortgage with nothing Outstanding (paid off, awaiting Redemption) can't take a Payment.
          const ids = page.items.filter((m) => m.outstanding_total > 0).map((m) => m.id)
          if (selectionStarted.current) return new Set(ids.filter((id) => current.has(id)))
          selectionStarted.current = true
          return new Set(preselected && ids.includes(preselected) ? [preselected] : ids)
        })
      })
      .catch((err: Error) => setError(err.message))
  }, [customer.id, paidOn, preselected])

  const chosen = (mortgages ?? []).filter((m) => selected.has(m.id))
  const outstanding = chosen.map((m) => m.outstanding_total)
  const totalOutstanding = outstanding.reduce((a, b) => a + b, 0)
  const total = rupeesToPaise(totalText || '0')

  const amounts: number[] | null =
    mode === 'equal'
      ? allocateEqually(total, outstanding)
      : mode === 'amount'
        ? chosen.map((m) => rupeesToPaise(amountText[m.id] || '0'))
        : amountsFromPercentages(
            total,
            chosen.map((m) => Number(percentText[m.id] || '0')),
            outstanding,
          )
  const allocated = amounts?.reduce((a, b) => a + b, 0) ?? 0

  const problems: string[] = []
  if (chosen.length === 0) problems.push('Choose at least one Mortgage.')
  if (total <= 0) problems.push('Enter the amount received.')
  if (total > totalOutstanding && chosen.length)
    problems.push(
      `The amount is more than the ${formatINR(totalOutstanding)} Outstanding on these ` +
        `Mortgages on ${formatDate(paidOn)}.`,
    )
  if (mode === 'percent' && chosen.some((m) => Number(percentText[m.id] || '0') < 0))
    problems.push('Percentages cannot be negative.')
  if (amounts?.some((amount) => amount < 0)) problems.push('Allocations cannot be negative.')
  if (mode === 'percent' && amounts === null) problems.push('The percentages must add up to 100.')
  if (amounts && total > 0 && allocated !== total)
    problems.push(`The Allocations add up to ${formatINR(allocated)}, not ${formatINR(total)}.`)
  amounts?.forEach((amount, i) => {
    if (amount > outstanding[i])
      problems.push(`${chosen[i].name}: more than its ${formatINR(outstanding[i])} Outstanding.`)
  })

  /** Switching to a manual mode starts from the current equal Allocations. */
  function switchMode(next: AllocationMode) {
    const equal = allocateEqually(total, outstanding)
    if (next === 'amount' && equal)
      setAmountText(Object.fromEntries(chosen.map((m, i) => [m.id, String(equal[i] / 100)])))
    if (next === 'percent' && total > 0 && equal)
      setPercentText(
        Object.fromEntries(percentagesOf(equal, total).map((pct, i) => [chosen[i].id, String(pct)])),
      )
    setMode(next)
  }

  function toggle(id: number) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (problems.length || !amounts) return
    setSaving(true)
    setError(null)
    try {
      const payment = await api.recordPayment({
        customer_id: customer.id,
        paid_on: paidOn,
        amount: total,
        method,
        reference: reference.trim() || null,
        allocations: chosen
          .map((m, i) => ({ mortgage_id: m.id, amount: amounts[i] }))
          .filter((allocation) => allocation.amount > 0),
      })
      navigate(`/payments/${payment.id}`)
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save}>
      <div className="grid-3">
        <label>
          Date received
          <input
            type="date"
            required
            max={todayIso()}
            value={paidOn}
            onChange={(event) => setPaidOn(event.target.value)}
          />
        </label>
        <label>
          Amount received (₹)
          <input
            type="number"
            required
            min="0.01"
            step="0.01"
            value={totalText}
            onChange={(event) => setTotalText(event.target.value)}
          />
          {chosen.length > 0 && (
            <button
              type="button"
              className="link"
              onClick={() => setTotalText(String(totalOutstanding / 100))}
            >
              The full Outstanding on the chosen Mortgages ({formatINR(totalOutstanding)})
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

      <fieldset>
        <legend>Allocate across Mortgages</legend>
        <div className="row">
          {(
            [
              ['equal', 'Equally (suggested)'],
              ['amount', 'By amount'],
              ['percent', 'By percentage'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="inline">
              <input
                type="radio"
                name="allocation-mode"
                checked={mode === value}
                onChange={() => switchMode(value)}
              />
              {label}
            </label>
          ))}
        </div>

        {mortgages === null ? (
          <p>Loading…</p>
        ) : mortgages.length === 0 ? (
          <p className="hint">No Active Mortgages on {formatDate(paidOn)}.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th aria-label="Include" />
                  <th>Mortgage</th>
                  <th className="num">Outstanding on {formatDate(paidOn)}</th>
                  {mode === 'percent' && <th className="num">%</th>}
                  <th className="num">Allocation</th>
                </tr>
              </thead>
              <tbody>
                {mortgages.map((m) => {
                  const index = chosen.findIndex((c) => c.id === m.id)
                  const amount = index >= 0 && amounts ? amounts[index] : null
                  return (
                    <tr key={m.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Include ${m.name}`}
                          checked={selected.has(m.id)}
                          disabled={m.outstanding_total === 0}
                          onChange={() => toggle(m.id)}
                        />
                      </td>
                      <td>
                        <Link to={`/mortgages/${m.id}`}>{m.name}</Link>
                        {m.outstanding_total === 0 && <span className="badge">Paid off</span>}
                      </td>
                      <td className="num">{formatINR(m.outstanding_total)}</td>
                      {mode === 'percent' && (
                        <td className="num">
                          {index >= 0 && (
                            <input
                              type="number"
                              className="small-input"
                              aria-label={`Percentage for ${m.name}`}
                              min="0"
                              max="100"
                              step="0.01"
                              value={percentText[m.id] ?? ''}
                              onChange={(event) =>
                                setPercentText({ ...percentText, [m.id]: event.target.value })
                              }
                            />
                          )}
                        </td>
                      )}
                      <td className="num">
                        {index < 0 ? (
                          '—'
                        ) : mode === 'amount' ? (
                          <input
                            type="number"
                            className="small-input"
                            aria-label={`Amount for ${m.name}`}
                            min="0"
                            step="0.01"
                            value={amountText[m.id] ?? ''}
                            onChange={(event) =>
                              setAmountText({ ...amountText, [m.id]: event.target.value })
                            }
                          />
                        ) : amount === null ? (
                          '—'
                        ) : (
                          formatINR(amount)
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint">
          Within each Mortgage the Allocation pays unpaid interest first, then Principal.
        </p>
      </fieldset>

      <label>
        Reference (optional)
        <input
          placeholder="e.g. UPI transaction ID"
          value={reference}
          onChange={(event) => setReference(event.target.value)}
        />
      </label>

      {total > 0 && problems.length > 0 && (
        <ul className="problems">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      <div className="row">
        <button type="submit" disabled={saving || problems.length > 0}>
          {saving ? 'Saving…' : `Record Payment${total > 0 ? ` of ${formatINR(total)}` : ''}`}
        </button>
      </div>
      {error && <p className="status error">{error}</p>}
    </form>
  )
}
