// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { NewPaymentPage } from '../src/pages/NewPaymentPage'
import { formatDate, todayIso } from '../src/format'
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
// The Mortgage as listed, owing ₹51,500 on the Payment date, its Interest to Date included.
const row = {
  id: 7,
  name: mortgage.name,
  customer: mortgage.customer,
  start_date: mortgage.start_date,
  amount_lent: mortgage.amount_lent,
  status: 'active',
  outstanding_total: 5_150_000,
}
const quote = {
  on: '2026-04-20',
  principal: 0,
  unpaid_interest: 0,
  last_accrual_on: '2026-04-10',
  interest_to_date_days: 0,
  interest_to_date: 0,
  total: 0,
}
/** The backend for recording a ₹50,750 UPI Payment, which leaves ₹750 Outstanding. */
function server() {
  return fakeServer({
    'GET /api/customers/3': customer,
    'GET /api/mortgages': { items: [row], total: 1, page: 1, page_size: 1 },
    'GET /api/payment-methods': [
      { method: 'cash', name: 'Cash' },
      { method: 'upi', name: 'UPI' },
    ],
    'GET /api/mortgages/7/outstanding-on-closure': quote,
    'POST /api/payments/preview': [],
    'POST /api/payments': async (request: Request) => ({
      ...((await request.json()) as Record<string, unknown>),
      id: 9,
      customer: { kind: 'customer', id: 3, name: customer.name },
      allocations: [],
      voided_at: null,
      void_reason: null,
    }),
  })
}

test('a Payment that leaves something Outstanding goes to its Receipt, offering no Redemption', async () => {
  const backend = server()
  showPage(backend, '/payments/new?customer=3&mortgage=7', { '/payments/new': <NewPaymentPage /> })

  fireEvent.change(await screen.findByLabelText('Amount received (₹)'), {
    target: { value: '50750' },
  })
  const record = screen.getByRole('button', { name: 'Record Payment of ₹50,750' })
  await vi.waitFor(() => expect((record as HTMLButtonElement).disabled).toBe(false), {
    timeout: 2000,
  })
  fireEvent.click(record)
  const confirmation = await screen.findByRole('dialog')
  expect(within(confirmation).queryByText(/Redeem/)).toBeNull()
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm and save' }))

  expect(await screen.findByText('Now at /payments/9/receipt')).toBeTruthy()
  expect(backend.requests.filter((r) => /redeem/.test(r))).toEqual([])
})

// --- Each Mortgage's one figure: its Outstanding on the Payment date.

const ring = { ...row, id: 8, name: '2026GoldRing', outstanding_total: 2_000_000 }

/** Mortgages 7 (pro-rata) and 8 (Part-Month Rule "nothing") owing ₹51,500 and ₹20,000,
 *  Interest to Date included; 7 owes ₹51,000 before 1 Apr 2026. 8 has a Payment on
 *  1 Apr 2026, so it can't be Redeemed before then. */
function quoting(extra: Record<string, unknown> = {}) {
  const owed = (id: number, on: string) =>
    id === 8 ? 2_000_000 : on < '2026-04-01' ? 5_100_000 : 5_150_000
  const onClosure = (id: number, request: Request) => {
    const on = new URL(request.url).searchParams.get('on') ?? ''
    if (id === 8 && on < '2026-04-01')
      return Response.json(
        { detail: 'There are Payments after that date (latest 01 Apr 2026); close it on or after then' },
        { status: 422 },
      )
    const charge = id === 8 ? 0 : on < '2026-04-01' ? 25_000 : 75_000
    return { ...quote, on, interest_to_date_days: 15, interest_to_date: charge, total: owed(id, on) }
  }
  return fakeServer({
    'GET /api/customers/3': customer,
    'GET /api/mortgages': (request: Request) => {
      const on = new URL(request.url).searchParams.get('as_of') ?? ''
      const items = [row, ring].map((m) => ({ ...m, outstanding_total: owed(m.id, on) }))
      return { items, total: 2, page: 1, page_size: 2 }
    },
    'GET /api/payment-methods': [{ method: 'cash', name: 'Cash' }],
    'POST /api/payments/preview': [],
    'GET /api/mortgages/7/outstanding-on-closure': (request: Request) => onClosure(7, request),
    'GET /api/mortgages/8/outstanding-on-closure': (request: Request) => onClosure(8, request),
    ...extra,
  })
}

test('each Mortgage shows one figure, its Outstanding on the Payment date, back-dated too', async () => {
  showPage(quoting(), '/payments/new?customer=3', { '/payments/new': <NewPaymentPage /> })

  const chain = (await screen.findByRole('link', { name: row.name })).closest('tr')!
  expect(within(chain).getByText('₹51,500')).toBeTruthy()
  const headers = screen.getAllByRole('columnheader').map((th) => th.textContent)
  expect(headers.filter((h) => /Outstanding|redeem|Redemption/i.test(h ?? ''))).toEqual([
    `Outstanding on ${formatDate(todayIso())}`,
  ])

  fireEvent.change(screen.getByLabelText('Date received'), { target: { value: '2026-03-15' } })
  expect(await screen.findByRole('columnheader', { name: 'Outstanding on 15 Mar 2026' })).toBeTruthy()
  expect(await within(chain).findByText('₹51,000')).toBeTruthy()
  expect(screen.queryByText(/Redemption Amount/)).toBeNull()
})

test('paying the full Outstanding fills each chosen Mortgage with its Outstanding, and the total with their sum', async () => {
  showPage(quoting(), '/payments/new?customer=3', { '/payments/new': <NewPaymentPage /> })

  const full = await screen.findByRole('button', { name: 'Pay the full Outstanding (₹71,500)' })
  await vi.waitFor(() => expect((full as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(full)

  expect((screen.getByLabelText('Amount received (₹)') as HTMLInputElement).value).toBe('71500')
  expect((screen.getByLabelText(`Amount for ${row.name}`) as HTMLInputElement).value).toBe('51500')
  expect((screen.getByLabelText(`Amount for ${ring.name}`) as HTMLInputElement).value).toBe('20000')
})

test('a Mortgage owing nothing is not offered a Payment, but pointed to its Redeem page', async () => {
  // Paid up before Outstanding included the Interest to Date, under the Part-Month Rule
  // "nothing": nothing is owed, so no Payment can Redeem it.
  const paidUp = { ...ring, outstanding_total: 0 }
  showPage(
    fakeServer({
      'GET /api/customers/3': customer,
      'GET /api/mortgages': { items: [row, paidUp], total: 2, page: 1, page_size: 2 },
      'GET /api/payment-methods': [{ method: 'cash', name: 'Cash' }],
      'GET /api/mortgages/7/outstanding-on-closure': quote,
    }),
    '/payments/new?customer=3',
    { '/payments/new': <NewPaymentPage /> },
  )

  const redeem = await screen.findByRole('link', { name: `${ring.name} owes nothing: Redeem it →` })
  expect(redeem.getAttribute('href')).toBe(`/mortgages/${ring.id}/redeem`)
  expect(screen.queryByLabelText(`Include ${ring.name}`)).toBeNull()
  expect(screen.getByLabelText(`Include ${row.name}`)).toBeTruthy()
})

test("when a chosen Mortgage can't be Redeemed then, the full Outstanding can't be filled in and the reason is given", async () => {
  showPage(quoting(), '/payments/new?customer=3', { '/payments/new': <NewPaymentPage /> })
  await screen.findByRole('button', { name: /^Pay the full Outstanding/ })

  fireEvent.change(screen.getByLabelText('Date received'), { target: { value: '2026-03-15' } })

  const full = (await screen.findByRole('button', {
    name: /^Pay the full Outstanding/,
  })) as HTMLButtonElement
  expect(full.disabled).toBe(true)
  // Compact too: the reason is in the marker's tooltip.
  fireEvent.mouseEnter(await screen.findByText("Can't pay it in full"))
  expect(screen.getByRole('tooltip').textContent).toBe(
    'There are Payments after that date (latest 01 Apr 2026); close it on or after then',
  )
})

// --- Paying the full Outstanding Redeems: asked before anything is recorded.

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
  await screen.findByRole('button', { name: /^Pay the full Outstanding \(/ })
  const save = screen.getByRole('button', { name: /^Record Payment of/ }) as HTMLButtonElement
  await vi.waitFor(() => expect(save.disabled).toBe(false), { timeout: 2000 })
  fireEvent.click(save)
  return screen.findByRole('dialog')
}

test('paying the full Outstanding asks to Redeem first, then records the Payment as Redeeming', async () => {
  const saved = recording()
  const asked = await record({ [row.name]: '51500', [ring.name]: '20000' })

  expect(within(asked).getByRole('heading', { name: 'Redeem and hand back the jewellery?' })).toBeTruthy()
  expect(
    within(asked).getByText(
      `This pays the full Outstanding of ${row.name} (₹51,500, including 15 days' Interest to Date).`,
    ),
  ).toBeTruthy()
  fireEvent.click(within(asked).getByRole('button', { name: 'Redeem' }))

  expect(await screen.findByText('Now at /payments/9/receipt')).toBeTruthy()
  expect(saved.map((p) => p.redeeming)).toEqual([[7, 8]])
})

test('only the Mortgages paid in full are Redeemed, and Go back records nothing', async () => {
  const saved = recording()
  const asked = await record({ [row.name]: '51500', [ring.name]: '5000' })

  expect(within(asked).queryByText(new RegExp(`full Outstanding of ${ring.name}`))).toBeNull()
  expect(within(asked).getByText(new RegExp(`full Outstanding of ${row.name}`))).toBeTruthy()
  fireEvent.click(within(asked).getByRole('button', { name: 'Go back' }))

  expect(screen.queryByRole('dialog')).toBeNull()
  expect(saved).toEqual([])
})

test('equal shares fill the smaller Mortgages up to their Outstanding, and the rest goes to the others', async () => {
  showPage(quoting(), '/payments/new?customer=3', { '/payments/new': <NewPaymentPage /> })
  await screen.findByRole('button', { name: /^Pay the full Outstanding \(/ })

  // ₹71,500: ₹20,000 Redeems the ring; the chain's ₹51,500 is the rest.
  fireEvent.change(screen.getByLabelText('Amount received (₹)'), { target: { value: '71500' } })

  const chain = screen.getByRole('link', { name: row.name }).closest('tr')!
  const ringRow = screen.getByRole('link', { name: ring.name }).closest('tr')!
  expect(within(chain).getAllByText('₹51,500')).toHaveLength(2) // Outstanding, and allocated
  expect(within(ringRow).getAllByText('₹20,000')).toHaveLength(2)
})
