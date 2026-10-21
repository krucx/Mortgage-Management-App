// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { NewPaymentPage } from '../src/pages/NewPaymentPage'
import { fakeServer } from './fakeServer'
import { mortgage, showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const customer = {
  id: 3,
  name: 'Asha Rao',
  address: '',
  phone_1: '9829012345',
  phone_2: null,
  photo_url: null,
  referrer: null,
  referred: [],
  shares_phone_with: null,
}
// The Mortgage as listed, owing ₹50,750 on the Payment date.
const row = {
  id: 7,
  name: mortgage.name,
  customer: mortgage.customer,
  start_date: mortgage.start_date,
  amount_lent: mortgage.amount_lent,
  status: 'active',
  outstanding_total: 5_075_000,
  ready_to_redeem: false,
}
const redemption = {
  on: '2026-04-20',
  principal: 0,
  unpaid_interest: 0,
  part_month_days: 0,
  part_month_charge: 0,
  total: 0,
}
const side = (closure: unknown) => ({ outstanding: 0, points: [], term_changes: [], closure })

/** The backend for recording a ₹50,750 UPI Payment that leaves the Mortgage Ready to
 *  Redeem, which then answers a Redemption with `redeem`. */
function server(redeem: unknown) {
  const paid: { paid_on?: string } = {}
  const backend = fakeServer({
    'GET /api/customers/3': customer,
    'GET /api/mortgages': { items: [row], total: 1, page: 1, page_size: 1 },
    'GET /api/payment-methods': [
      { method: 'cash', name: 'Cash' },
      { method: 'upi', name: 'UPI' },
    ],
    'POST /api/payments/preview': [],
    'POST /api/payments': async (request: Request) => {
      const asked = (await request.json()) as Record<string, unknown>
      paid.paid_on = asked.paid_on as string
      return {
        ...asked,
        id: 9,
        customer: { kind: 'customer', id: 3, name: customer.name },
        allocations: [
          {
            mortgage_id: 7,
            mortgage_name: row.name,
            amount: 5_075_000,
            interest_paid: 75_000,
            principal_paid: 5_000_000,
          },
        ],
        voided_at: null,
        void_reason: null,
        ready_to_redeem: [{ ...row, outstanding_total: 0, ready_to_redeem: true }],
      }
    },
    'GET /api/mortgages/7': mortgage,
    'GET /api/mortgages/7/redemption': redemption,
    'POST /api/closures/redeem-preview': [
      {
        mortgage_id: 7,
        mortgage_name: row.name,
        before: side(null),
        after: side({
          kind: 'redeemed',
          on: '2026-04-20',
          redemption_amount: 0,
          payment_id: null,
          payment_amount: null,
          waived_amount: null,
          recovered_amount: null,
          profit_loss: null,
          note: null,
        }),
        ledger_changes: [],
      },
    ],
    'POST /api/closures/redeem': redeem,
  })
  return { ...backend, paid }
}

/** Records the Payment, confirmed, and waits for the offer to Redeem. */
async function recordPayment() {
  fireEvent.change(await screen.findByLabelText('Amount received (₹)'), {
    target: { value: '50750' },
  })
  fireEvent.change(screen.getByLabelText('Method'), { target: { value: 'upi' } })
  fireEvent.change(screen.getByLabelText('Reference (optional)'), { target: { value: 'UTR7' } })
  const record = screen.getByRole('button', { name: 'Record Payment of ₹50,750' })
  await vi.waitFor(() => expect((record as HTMLButtonElement).disabled).toBe(false), {
    timeout: 2000,
  })
  fireEvent.click(record)
  const confirmation = await screen.findByRole('dialog')
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm and save' }))
  return screen.findByRole('heading', { name: 'Fully paid: Redeem now?' })
}

function showNewPayment(backend: ReturnType<typeof server>) {
  showPage(backend, '/payments/new?customer=3&mortgage=7', {
    '/payments/new': <NewPaymentPage />,
  })
}

test('a Payment that leaves a Mortgage Ready to Redeem offers to Redeem it, in one request on the Payment date', async () => {
  const sent: unknown[] = []
  const backend = server(async (request: Request) => {
    sent.push(await request.json())
    return []
  })
  showNewPayment(backend)
  await recordPayment()

  const offer = screen.getByRole('dialog')
  // The Redemption's Preview, before Redeeming.
  expect(await within(offer).findByText(/No change to the Ledger so far/, {}, { timeout: 2000 }))
  const redeem = screen.getByRole('button', { name: 'Redeem 1' }) as HTMLButtonElement
  await vi.waitFor(() => expect(redeem.disabled).toBe(false), { timeout: 2000 })
  fireEvent.click(redeem)

  expect(await screen.findByText('Now at /payments/9')).toBeTruthy()
  expect(sent).toEqual([
    {
      redeemed_on: backend.paid.paid_on,
      method: 'upi',
      reference: 'UTR7',
      mortgage_ids: [7],
    },
  ])
  expect(backend.requests.filter((r) => r.endsWith('/redeem'))).toEqual([
    'POST /api/closures/redeem',
  ])
})

test("if the backend refuses the Redemption, nothing is Redeemed and its reason is shown", async () => {
  const backend = server(() =>
    Response.json({ detail: `${row.name} is already redeemed` }, { status: 422 }),
  )
  showNewPayment(backend)
  await recordPayment()

  const redeem = screen.getByRole('button', { name: 'Redeem 1' }) as HTMLButtonElement
  await vi.waitFor(() => expect(redeem.disabled).toBe(false), { timeout: 2000 })
  fireEvent.click(redeem)

  expect(await screen.findByText(`${row.name} is already redeemed`)).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Fully paid: Redeem now?' })).toBeTruthy()
})
