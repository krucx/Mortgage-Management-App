// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { NewPaymentPage } from '../src/pages/NewPaymentPage'
import { formatDate, todayIso } from '../src/format'
import { changePreview, fakeServer } from './fakeServer'
import { mortgage, showPage } from './showPage'
import type { PaymentIn } from '../src/api'

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
  not_redeemable: null as string | null,
}
/** The backend for recording a ₹50,750 UPI Payment, which leaves ₹750 Outstanding. */
function server(extra: Record<string, unknown> = {}) {
  return fakeServer({
    'GET /api/customers/3': customer,
    'GET /api/mortgages': { items: [row], total: 1, page: 1, page_size: 1 },
    'GET /api/payment-methods': [
      { method: 'cash', name: 'Cash' },
      { method: 'upi', name: 'UPI' },
    ],
    'GET /api/settings/discount-confirmation-limit': {
      discount_confirmation_limit: 50_000,
    },
    'POST /api/payments/preview': changePreview([]),
    'POST /api/payments': async (request: Request) => ({
      ...((await request.json()) as Record<string, unknown>),
      id: 9,
      customer: { kind: 'customer', id: 3, name: customer.name },
      allocations: [],
      voided_at: null,
      void_reason: null,
    }),
    ...extra,
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

test('a Discount can be recorded without cash', async () => {
  let asked: PaymentIn | undefined
  const backend = server({
    'POST /api/payments/preview': async (request: Request) => {
      asked = (await request.json()) as PaymentIn
      return changePreview([])
    },
  })
  showPage(backend, '/payments/new?customer=3&mortgage=7', { '/payments/new': <NewPaymentPage /> })

  fireEvent.change(await screen.findByLabelText('Discount for 2026GoldChain'), {
    target: { value: '51500' },
  })
  const record = screen.getByRole('button', { name: 'Record Payment with ₹51,500 Discount' })
  await vi.waitFor(() => expect((record as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(record)
  await screen.findByRole('dialog')

  expect(asked?.amount).toBe(0)
  expect(asked?.allocations).toEqual([{ mortgage_id: 7, amount: 0, discount: 5_150_000 }])
})

/** A fake Preview that computes `discount_room`/`over_threshold` itself from the
 *  request, the way the real backend does, instead of the empty `changePreview([])`
 *  that would let a page-computed cap or threshold go unnoticed. `rooms` overrides a
 *  Mortgage's room (by id); otherwise it is the Mortgage's Outstanding (ample room,
 *  for tests only exercising the threshold, not the cap). */
function discountAwarePreview(rooms: Record<number, number> = {}, limit = 50_000) {
  return async (request: Request) => {
    const asked = (await request.json()) as PaymentIn
    const mortgages = asked.allocations.map((allocation) => ({
      mortgage_id: allocation.mortgage_id,
      mortgage_name: row.name,
      before: { outstanding: row.outstanding_total, points: [], term_changes: [], closure: null },
      after: { outstanding: 0, points: [], term_changes: [], closure: null },
      ledger_changes: [],
      discount_room: rooms[allocation.mortgage_id] ?? row.outstanding_total,
      over_threshold: allocation.discount > limit,
    }))
    return changePreview(mortgages)
  }
}

test('a ₹500 Discount needs no extra confirmation, while a larger one does', async () => {
  const backend = server({ 'POST /api/payments/preview': discountAwarePreview() })
  showPage(backend, '/payments/new?customer=3&mortgage=7', { '/payments/new': <NewPaymentPage /> })
  const discount = await screen.findByLabelText('Discount for 2026GoldChain')
  fireEvent.change(discount, { target: { value: '500' } })
  const save = await screen.findByRole('button', { name: 'Record Payment with ₹500 Discount' })
  await vi.waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(save)
  const regular = await screen.findByRole('dialog')
  expect(within(regular).getByRole('heading', { name: /Record a Payment/ })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Confirm a Discount over ₹500?' })).toBeNull()
  fireEvent.click(within(regular).getByRole('button', { name: 'Keep editing' }))

  fireEvent.change(discount, { target: { value: '500.01' } })
  await vi.waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(save)
  expect(await screen.findByRole('heading', { name: 'Confirm a Discount over ₹500?' })).toBeTruthy()
})

test('an over-balance Discount is reduced to the room the Preview reports, not Outstanding minus cash', async () => {
  let saved: PaymentIn | undefined
  const backend = server({
    // Deliberately not ₹51,500 (Outstanding) − ₹50,000 (cash) = ₹1,500: a page that
    // still worked that out itself would show the wrong reduction.
    'POST /api/payments/preview': discountAwarePreview({ 7: 30_000 }),
    'POST /api/payments': async (request: Request) => {
      saved = (await request.json()) as PaymentIn
      return { ...saved, id: 9, customer: { kind: 'customer', id: 3, name: customer.name }, allocations: [], voided_at: null, void_reason: null }
    },
  })
  showPage(backend, '/payments/new?customer=3&mortgage=7', { '/payments/new': <NewPaymentPage /> })
  fireEvent.change(await screen.findByLabelText('Amount received (₹)'), { target: { value: '50000' } })
  fireEvent.change(await screen.findByLabelText('Discount for 2026GoldChain'), { target: { value: '3000' } })
  const save = await screen.findByRole('button', { name: 'Record Payment of ₹50,000 with ₹3,000 Discount' })
  await vi.waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(save)

  const cap = await screen.findByRole('dialog')
  expect(within(cap).getByRole('heading', { name: 'Reduce Discount to the remaining balance?' })).toBeTruthy()
  expect(within(cap).getByText('₹3,000 → ₹300')).toBeTruthy()
  expect(saved).toBeUndefined()

  // Accepting only updates the draft: it does not resubmit on its own.
  fireEvent.click(within(cap).getByRole('button', { name: 'Reduce and continue' }))
  await vi.waitFor(() =>
    expect((screen.getByLabelText('Discount for 2026GoldChain') as HTMLInputElement).value).toBe(
      '300',
    ),
  )
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(saved).toBeUndefined()

  const saveAgain = await screen.findByRole('button', {
    name: 'Record Payment of ₹50,000 with ₹300 Discount',
  })
  await vi.waitFor(() => expect((saveAgain as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(saveAgain)
  const regular = await screen.findByRole('dialog')
  expect(within(regular).getByRole('heading', { name: /Record a Payment of/ })).toBeTruthy()
  fireEvent.click(within(regular).getByRole('button', { name: 'Confirm and save' }))
  await vi.waitFor(() => expect(saved?.allocations).toEqual([{ mortgage_id: 7, amount: 5_000_000, discount: 30_000 }]))
})

test('declining the cap or the large-Discount confirmation saves nothing', async () => {
  let saves = 0
  const backend = server({
    'POST /api/payments/preview': discountAwarePreview(),
    'POST /api/payments': async (request: Request) => {
      saves += 1
      return { ...((await request.json()) as Record<string, unknown>), id: 9, customer: { kind: 'customer', id: 3, name: customer.name }, allocations: [], voided_at: null, void_reason: null }
    },
  })
  showPage(backend, '/payments/new?customer=3&mortgage=7', { '/payments/new': <NewPaymentPage /> })
  const discount = await screen.findByLabelText('Discount for 2026GoldChain')
  fireEvent.change(discount, { target: { value: '52000' } })
  let save = await screen.findByRole('button', { name: 'Record Payment with ₹52,000 Discount' })
  await vi.waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(save)
  await screen.findByRole('heading', { name: 'Reduce Discount to the remaining balance?' })
  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
  expect(saves).toBe(0)

  fireEvent.change(discount, { target: { value: '501' } })
  save = await screen.findByRole('button', { name: 'Record Payment with ₹501 Discount' })
  await vi.waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(save)
  const large = await screen.findByRole('dialog')
  await within(large).findByRole('heading', { name: 'Confirm a Discount over ₹500?' })
  fireEvent.click(within(large).getByRole('button', { name: 'Keep editing' }))
  expect(saves).toBe(0)
})

// --- Each Mortgage's one figure: its Outstanding on the Payment date.

const ring = { ...row, id: 8, name: '2026GoldRing', outstanding_total: 2_000_000 }

const LATER_PAYMENT =
  'There are Payments after that date (latest 01 Apr 2026); close it on or after then'

/** Mortgages 7 (pro-rata) and 8 (Part-Month Rule "nothing") owing ₹51,500 and ₹20,000,
 *  Interest to Date included; 7 owes ₹51,000 before 1 Apr 2026. 8 has a Payment on
 *  1 Apr 2026, so it can't be Redeemed before then. The Preview Redeems each Mortgage
 *  paid its whole Outstanding, as the backend does. */
function quoting(extra: Record<string, unknown> = {}) {
  const owed = (id: number, on: string) =>
    id === 8 ? 2_000_000 : on < '2026-04-01' ? 5_100_000 : 5_150_000
  const side = (closure: unknown) => ({ outstanding: 0, points: [], term_changes: [], closure })
  const redeemed = (id: number, on: string) => ({
    kind: 'redeemed',
    on,
    outstanding: owed(id, on),
    interest_to_date: id === 8 ? 0 : on < '2026-04-01' ? 25_000 : 75_000,
    interest_to_date_days: 15,
  })
  return fakeServer({
    'GET /api/customers/3': customer,
    'GET /api/mortgages': (request: Request) => {
      const on = new URL(request.url).searchParams.get('as_of') ?? ''
      const items = [row, ring].map((m) => ({
        ...m,
        outstanding_total: owed(m.id, on),
        not_redeemable: m.id === 8 && on < '2026-04-01' ? LATER_PAYMENT : null,
      }))
      return { items, total: 2, page: 1, page_size: 2 }
    },
    'GET /api/payment-methods': [{ method: 'cash', name: 'Cash' }],
    'POST /api/payments/preview': async (request: Request) => {
      const asked = (await request.json()) as PaymentIn
      const mortgages = asked.allocations.map((a) => ({
        mortgage_id: a.mortgage_id,
        mortgage_name: a.mortgage_id === 8 ? ring.name : row.name,
        before: side(null),
        after: side(
          a.amount === owed(a.mortgage_id, asked.paid_on)
            ? redeemed(a.mortgage_id, asked.paid_on)
            : null,
        ),
        ledger_changes: [],
      }))
      return changePreview(mortgages)
    },
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
  // Dormant (ADR 0012): nothing is owed, so no Payment can Redeem it.
  const paidUp = { ...ring, outstanding_total: 0 }
  showPage(
    fakeServer({
      'GET /api/customers/3': customer,
      'GET /api/mortgages': { items: [row, paidUp], total: 2, page: 1, page_size: 2 },
      'GET /api/payment-methods': [{ method: 'cash', name: 'Cash' }],
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

  // Compact too: the reason is in the marker's tooltip.
  fireEvent.mouseEnter(await screen.findByText("Can't pay it in full"))
  expect(screen.getByRole('tooltip').textContent).toBe(LATER_PAYMENT)
  const full = screen.getByRole('button', { name: /^Pay the full Outstanding/ })
  expect((full as HTMLButtonElement).disabled).toBe(true)
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

test('paying the full Outstanding asks to Redeem first, as the Preview says, then records the Payment', async () => {
  const saved = recording()
  const asked = await record({ [row.name]: '51500', [ring.name]: '20000' })

  expect(within(asked).getByRole('heading', { name: 'Redeem and hand back the jewellery?' })).toBeTruthy()
  expect(
    within(asked).getByText(
      `This pays the full Outstanding of ${row.name} (₹51,500, including 15 days of Interest to Date).`,
    ),
  ).toBeTruthy()
  fireEvent.click(within(asked).getByRole('button', { name: 'Redeem' }))

  expect(await screen.findByText('Now at /payments/9/receipt')).toBeTruthy()
  // The backend Redeems what is paid in full: the Payment says nothing of it.
  expect(saved.map((p) => 'redeeming' in p)).toEqual([false])
})

test("each Allocation says whether it Redeems, and the page asks for no quotes", async () => {
  const backend = quoting()
  showPage(backend, '/payments/new?customer=3', { '/payments/new': <NewPaymentPage /> })
  const asked = await record({ [row.name]: '51500', [ring.name]: '5000' })

  expect(within(asked).getByText('₹51,500 cash · Redeems it')).toBeTruthy()
  expect(within(asked).getByText('₹5,000 cash')).toBeTruthy()
  expect(backend.requests.filter((r) => /outstanding-on-closure/.test(r))).toEqual([])
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
