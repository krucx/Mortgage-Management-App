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

  expect(await screen.findByText('Now at /payments/9/receipt')).toBeTruthy()
  expect(sent).toEqual([
    {
      redeemed_on: backend.paid.paid_on,
      method: 'upi',
      reference: 'UTR7',
      mortgage_ids: [7],
      received_with: 9,
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

test("the offer to Redeem asks for the Redemption Amount afresh, not the one New Payment had before the Payment", async () => {
  // Before the Payment, New Payment quoted ₹50,750 + ₹750; after it, only ₹750 is left.
  let asked = 0
  const quote = async () => {
    if (asked++ === 0)
      return { ...redemption, part_month_days: 10, part_month_charge: 75_000, total: 5_150_000 }
    await new Promise((resolve) => setTimeout(resolve, 300)) // the fresh one takes a moment
    return { ...redemption, part_month_days: 10, part_month_charge: 75_000, total: 75_000 }
  }
  showNewPayment(server([], quote))
  await recordPayment()

  const offer = screen.getByRole('dialog')
  expect(within(offer).queryByText(/₹51,500/)).toBeNull()
  expect(
    await within(offer).findByText(
      'The final Payment is ₹750: the part-month charge for 10 days (Pro-rata by day).',
    ),
  ).toBeTruthy()
})

// --- What each Mortgage would take to Redeem on the Payment date.

const ring = { ...row, id: 8, name: '2026GoldRing', outstanding_total: 2_000_000 }

/** Mortgages 7 (pro-rata) and 8 (Part-Month Rule "nothing") owing ₹50,750 and ₹20,000.
 *  Redeeming 7 adds a part-month charge: ₹250 before 1 Apr 2026, ₹750 after. 8 adds
 *  nothing, and can't be quoted before 1 Apr 2026 (it had not started). */
function quoting(extra: Record<string, unknown> = {}) {
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
    ...extra,
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
  // Compact in the table: the reason is the marker's tooltip.
  const marker = await within(ringRow).findByText("Can't redeem")
  expect(screen.queryByRole('tooltip')).toBeNull()
  fireEvent.mouseEnter(marker)
  expect(screen.getByRole('tooltip').textContent).toBe('2026GoldRing had not started on that date')
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.queryByRole('tooltip')).toBeNull()
  fireEvent.click(marker) // a tap, on a phone
  expect(screen.getByRole('tooltip')).toBeTruthy()
})

test('paying the full Redemption Amount fills each chosen Mortgage with its Redemption Amount, and the total with their sum', async () => {
  showPage(quoting(), '/payments/new?customer=3', { '/payments/new': <NewPaymentPage /> })

  const full = await screen.findByRole('button', { name: 'Pay the full Redemption Amount (₹71,500)' })
  fireEvent.click(full)

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

test("when a chosen Mortgage can't be quoted, the full Redemption Amount can't be filled in and the reason is given", async () => {
  showPage(quoting(), '/payments/new?customer=3', { '/payments/new': <NewPaymentPage /> })
  await screen.findByRole('button', { name: /^Pay the full Redemption Amount/ })

  fireEvent.change(screen.getByLabelText('Date received'), { target: { value: '2026-03-15' } })

  const full = (await screen.findByRole('button', {
    name: 'Pay the full Redemption Amount',
  })) as HTMLButtonElement
  expect(full.disabled).toBe(true)
  expect(
    await screen.findByText("Can't pay it in full: 2026GoldRing had not started on that date"),
  ).toBeTruthy()
})

// --- Paying the full Redemption Amount Redeems: asked before anything is recorded.

/** The fake backend, recording what each Payment saved asked for. */
function recording() {
  const saved: Record<string, unknown>[] = []
  const backend = quoting({
    'POST /api/payments': async (request: Request) => {
      const asked = (await request.json()) as Record<string, unknown>
      saved.push(asked)
      return {
        ...asked,
        id: 9,
        customer: { kind: 'customer', id: 3, name: customer.name },
        allocations: [],
        voided_at: null,
        void_reason: null,
        ready_to_redeem: [],
      }
    },
  })
  showPage(backend, '/payments/new?customer=3', { '/payments/new': <NewPaymentPage /> })
  return saved
}

async function record(amounts: Record<string, string>) {
  fireEvent.click(await screen.findByRole('radio', { name: 'By amount' }))
  let total = 0
  for (const [name, amount] of Object.entries(amounts)) {
    fireEvent.change(screen.getByLabelText(`Amount for ${name}`), { target: { value: amount } })
    total += Number(amount)
  }
  fireEvent.change(screen.getByLabelText('Amount received (₹)'), { target: { value: String(total) } })
  await screen.findByRole('button', { name: /^Pay the full Redemption Amount \(/ })
  const save = screen.getByRole('button', { name: /^Record Payment of/ }) as HTMLButtonElement
  await vi.waitFor(() => expect(save.disabled).toBe(false), { timeout: 2000 })
  fireEvent.click(save)
  return screen.findByRole('dialog')
}

test('paying the full Redemption Amount asks to Redeem first, then records the Payment as Redeeming', async () => {
  const saved = recording()
  const asked = await record({ [row.name]: '51500', [ring.name]: '20000' })

  expect(within(asked).getByRole('heading', { name: 'Redeem and hand back the jewellery?' })).toBeTruthy()
  expect(
    within(asked).getByText(
      `This pays the full Redemption Amount of ${row.name} (₹51,500, including a 15-day part-month charge).`,
    ),
  ).toBeTruthy()
  fireEvent.click(within(asked).getByRole('button', { name: 'Redeem' }))

  expect(await screen.findByText('Now at /payments/9/receipt')).toBeTruthy()
  expect(saved.map((p) => p.redeeming)).toEqual([[7, 8]])
})

test('only the Mortgages paid in full are Redeemed, and Go back records nothing', async () => {
  const saved = recording()
  const asked = await record({ [row.name]: '51500', [ring.name]: '5000' })

  expect(within(asked).queryByText(new RegExp(`Redemption Amount of ${ring.name}`))).toBeNull()
  expect(within(asked).getByText(new RegExp(`Redemption Amount of ${row.name}`))).toBeTruthy()
  fireEvent.click(within(asked).getByRole('button', { name: 'Go back' }))

  expect(screen.queryByRole('dialog')).toBeNull()
  expect(saved).toEqual([])
})

test('equal shares fill the smaller Mortgages up to their Redemption Amount, and the rest goes to the others', async () => {
  showPage(quoting(), '/payments/new?customer=3', { '/payments/new': <NewPaymentPage /> })
  await screen.findByRole('button', { name: /^Pay the full Redemption Amount \(/ })

  // ₹71,500: ₹20,000 Redeems the ring; the chain's ₹51,500 is the rest.
  fireEvent.change(screen.getByLabelText('Amount received (₹)'), { target: { value: '71500' } })

  const chain = screen.getByRole('link', { name: row.name }).closest('tr')!
  const ringRow = screen.getByRole('link', { name: ring.name }).closest('tr')!
  expect(within(chain).getAllByText('₹51,500')).toHaveLength(2) // to redeem, and allocated
  expect(within(ringRow).getAllByText('₹20,000')).toHaveLength(3) // owed, to redeem, allocated
})
