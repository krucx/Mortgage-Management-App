import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router'
import { CustomerChooser } from '../components/CustomerChooser'
import { customerQuery } from '../requests'
import { useServerState } from '../serverState'
import { PaymentForm } from './newPayment/PaymentForm'

/**
 * Record a lump-sum Payment: pick the Customer, choose their Mortgages, enter the total,
 * review the suggested Allocations, adjust them if needed, save.
 */
export function NewPaymentPage() {
  const [params, setParams] = useSearchParams()
  const customerId = Number(params.get('customer')) || undefined
  const preselected = Number(params.get('mortgage')) || undefined
  const { client } = useServerState()
  const customer = useQuery({
    ...customerQuery(client, customerId ?? 0),
    enabled: !!customerId,
  }).data

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
