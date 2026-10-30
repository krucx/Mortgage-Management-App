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
  last_accrual_on: '2026-04-10',
  part_month_days: 0,
  part_month_charge: 0,
  total: 0,
}
const side = (closure: unknown) => ({ outstanding: 0, points: [], term_changes: [], closure })

/** The backend for recording a ₹50,750 UPI Payment that leaves the Mortgage Ready to
 *  Redeem, which then answers a Redemption with `redeem`; `quote` is its Redemption
 *  Amount on the Payment date. */
function server(redeem: unknown, quote: unknown = redemption) {
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
    'GET /api/mortgages/7/redemption': quote,
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
  return screen.findByRole('heading', { name: 'Paid up to 10 Apr 2026: Redeem now?' })
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
  expect(screen.getByRole('heading', { name: 'Paid up to 10 Apr 2026: Redeem now?' })).toBeTruthy()
})

test('the offer to Redeem gives the final Payment and the Part-Month Rule behind it', async () => {
  const charged = { ...redemption, part_month_days: 10, part_month_charge: 25_000, total: 25_000 }
  showNewPayment(server([], charged))
  await recordPayment()

  const offer = screen.getByRole('dialog')
  expect(within(offer).getByText(/Principal and interest are fully paid/)).toBeTruthy()
  expect(
    await within(offer).findByText(
      'The final Payment is ₹250: the part-month charge for 10 days (Pro-rata by day).',
    ),
  ).toBeTruthy()
})

// --- What each Mortgage would take to Redeem on the Payment date.

const ring = { ...row, id: 8, name: '2026GoldRing', outstanding_total: 2_000_000 }

/** Mortgages 7 (pro-rata) and 8 (Part-Month Rule "nothing") owing ₹50,750 and ₹20,000.
 *  Redeeming 7 adds a part-month charge: ₹250 before 1 Apr 2026, ₹750 after. 8 adds
 *  nothing, and can't be quoted before 1 Apr 2026 (it had not started). */
function quoting() {
  const quote = (id: number, request: Request) => {
    const on = new URL(request.url).searchParams.get('on') ?? ''
    if (id === 8 && on < '2026-04-01')
      return Response.json({ detail: '2026GoldRing had not started on that date' }, { status: 422 })
    const outstanding = id === 7 ? 5_075_000 : 2_000_000
    const charge = id === 8 ? 0 : on < '2026-04-01' ? 25_000 : 75_000
    return { ...redemption, on, part_month_days: 15, part_month_charge: charge, total: outstanding + charge }
  }
  return fakeServer({
    'GET /api/customers/3': customer,
    'GET /api/mortgages': { items: [row, ring], total: 2, page: 1, page_size: 2 },
    'GET /api/payment-methods': [{ method: 'cash', name: 'Cash' }],
    'POST /api/payments/preview': [],
    'GET /api/mortgages/7/redemption': (request: Request) => quote(7, request),
    'GET /api/mortgages/8/redemption': (request: Request) => quote(8, request),
  })
}

test('each Mortgage shows what it would take to Redeem on the Payment date, back-dated too', async () => {
  const backend = quoting()
  showPage(backend, '/payments/new?customer=3', { '/payments/new': <NewPaymentPage /> })

  const chain = (await screen.findByRole('link', { name: row.name })).closest('tr')!
  expect(await within(chain).findByText('₹51,500')).toBeTruthy()
  expect(screen.getByRole('columnheader', { name: /^To redeem on/ })).toBeTruthy()
  // With nothing charged for the part-month, Redeeming takes just the Outstanding.
  const ringRow = screen.getByRole('link', { name: ring.name }).closest('tr')!
  expect(await within(ringRow).findAllByText('₹20,000')).toHaveLength(2)

  fireEvent.change(screen.getByLabelText('Date received'), { target: { value: '2026-03-15' } })
  expect(await screen.findByRole('columnheader', { name: 'To redeem on 15 Mar 2026' })).toBeTruthy()
  expect(await within(chain).findByText('₹51,000')).toBeTruthy()
  expect(await within(ringRow).findByText('2026GoldRing had not started on that date')).toBeTruthy()
})

test('Settle in full fills each chosen Mortgage with its Redemption Amount, and the total with their sum', async () => {
  showPage(quoting(), '/payments/new?customer=3', { '/payments/new': <NewPaymentPage /> })

  const settle = await screen.findByRole('button', { name: 'Settle in full (₹71,500)' })
  fireEvent.click(settle)

  expect((screen.getByLabelText('Amount received (₹)') as HTMLInputElement).value).toBe('71500')
  expect((screen.getByLabelText(`Amount for ${row.name}`) as HTMLInputElement).value).toBe('51500')
  expect((screen.getByLabelText(`Amount for ${ring.name}`) as HTMLInputElement).value).toBe('20000')
})

test("the Customer's Mortgages Ready to Redeem are pointed to the Redeem tab, not offered for a Payment", async () => {
  const paidOff = { ...ring, outstanding_total: 0, ready_to_redeem: true }
  showPage(
    fakeServer({
      'GET /api/customers/3': customer,
      'GET /api/mortgages': { items: [row, paidOff], total: 2, page: 1, page_size: 2 },
      'GET /api/payment-methods': [{ method: 'cash', name: 'Cash' }],
      'GET /api/mortgages/7/redemption': redemption,
    }),
    '/payments/new?customer=3',
    { '/payments/new': <NewPaymentPage /> },
  )

  const hint = await screen.findByRole('link', {
    name: "1 of this Customer's Mortgages is Ready to Redeem →",
  })
  expect(hint.getAttribute('href')).toBe('/closures')
  expect(screen.queryByRole('link', { name: ring.name })).toBeNull()
})

test('with none Ready to Redeem there is no pointer to the Redeem tab', async () => {
  showPage(quoting(), '/payments/new?customer=3', { '/payments/new': <NewPaymentPage /> })

  await screen.findByRole('link', { name: row.name })
  expect(screen.queryByRole('link', { name: /Ready to Redeem/ })).toBeNull()
})
