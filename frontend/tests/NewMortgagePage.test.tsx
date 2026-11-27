// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { MortgageIn } from '../src/api'
import { NewMortgagePage } from '../src/pages/NewMortgagePage'
import { type FakeServer } from './fakeServer'
import { typedFakeServer as fakeServer } from './typedFakeServer'
import { expectWholeRupeeSteps } from './rupeeField'
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

/** The backend, suggesting a Mortgage Name from the description a little later, as the
 *  real one does; what was asked to be created goes into `created`. */
function server(created: unknown[], overrides: Record<string, unknown> = {}) {
  return fakeServer({
    'GET /api/customers/{customer_id}': customer,
    'GET /api/mortgages': { items: [], total: 0, page: 1, page_size: 1 },
    'GET /api/settings/default-terms': {
      monthly_rate_bps: 200,
      interest_mode: 'simple',
      part_month_rule: 'full_month',
    },
    'GET /api/mortgages/suggested-name': async (request: Request) => {
      const description = new URL(request.url).searchParams.get('description') ?? ''
      await new Promise((resolve) => setTimeout(resolve, 200))
      const words = description.split(/\s+/).filter(Boolean)
      return { name: ['2026-Asha', ...words.map((w) => w[0].toUpperCase() + w.slice(1))].join('-') }
    },
    'POST /api/mortgages/preview': async (request: Request) => {
      const asked = (await request.json()) as MortgageIn
      return {
        name: '',
        terms: mortgage.terms,
        after: { outstanding: 2_500_000, points: [], term_changes: [], closure: null },
        cash: asked.lent_through === 'cash' ? [asked.amount_lent] : [],
      }
    },
    'POST /api/mortgages': async (request: Request) => {
      created.push(await request.json())
      return mortgage
    },
    'GET /api/mortgages/{mortgage_id}': mortgage,
    'GET /api/payment-methods': [
      { method: 'cash', name: 'Cash' },
      { method: 'upi', name: 'UPI' },
    ],
    'GET /api/settings/cash-limit': { cash_limit: 2_000_000 },
    ...overrides,
  })
}

const createButton = () =>
  screen.getByRole('button', { name: 'Create Mortgage' }) as HTMLButtonElement

async function fillMortgageForm(
  backend: FakeServer,
  description: string,
  lentThrough: string | null = 'upi', // null: left as it starts
) {
  showPage(backend, '/mortgages/new?customer=3', { '/mortgages/new': <NewMortgagePage /> })
  fireEvent.change(await screen.findByLabelText('Start date'), { target: { value: '2026-09-23' } })
  fireEvent.change(screen.getByLabelText('Principal lent (₹)'), { target: { value: '25000' } })
  fireEvent.change(screen.getByLabelText('Gross weight (grams)'), { target: { value: '5' } })
  fireEvent.change(screen.getByLabelText('Net weight, gold only (grams)'), {
    target: { value: '4.5' },
  })
  fireEvent.change(screen.getByLabelText('Description of the jewellery'), {
    target: { value: description },
  })
  const lent = screen.getByLabelText('Lent Through') as HTMLSelectElement
  await vi.waitFor(() => expect(lent.disabled).toBe(false))
  if (lentThrough !== null) fireEvent.change(lent, { target: { value: lentThrough } })
}

async function confirmCreate() {
  await vi.waitFor(() => expect(createButton().disabled).toBe(false), { timeout: 2000 })
  fireEvent.click(createButton())
  const dialog = await screen.findByRole('dialog')
  const title = within(dialog).getByRole('heading').textContent
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and save' }))
  return title
}

test("pressing Create straight after typing waits for that description's Mortgage Name", async () => {
  const created: { name: string | null }[] = []
  await fillMortgageForm(server(created), 'Gold pendant')

  // The name suggested so far is for an earlier description.
  expect(createButton().disabled).toBe(true)
  const title = await confirmCreate()

  expect(title).toBe('Create Mortgage 2026-Asha-Gold-Pendant?')
  expect(await screen.findByText('Now at /mortgages/7')).toBeTruthy()
  expect(created.map((m) => m.name)).toEqual(['2026-Asha-Gold-Pendant'])
})

test('a Mortgage Name the Lender typed is kept, whatever the description', async () => {
  const created: { name: string | null }[] = []
  await fillMortgageForm(server(created), 'Gold pendant')
  fireEvent.change(screen.getByLabelText(/Mortgage Name/), {
    target: { value: '2026-Asha-Special' },
  })
  fireEvent.change(screen.getByLabelText('Description of the jewellery'), {
    target: { value: 'Gold pendant with stones' },
  })

  const title = await confirmCreate()

  expect(title).toBe('Create Mortgage 2026-Asha-Special?')
  expect(await screen.findByText('Now at /mortgages/7')).toBeTruthy()
  expect(created.map((m) => m.name)).toEqual(['2026-Asha-Special'])
})

test('if no Mortgage Name can be suggested, it says so and one can be typed', async () => {
  const created: { name: string | null }[] = []
  await fillMortgageForm(
    server(created, {
      'GET /api/mortgages/suggested-name': () =>
        Response.json({ detail: 'The start date is not a date' }, { status: 422 }),
    }),
    'Gold pendant',
  )

  expect(await screen.findByText(/No Mortgage Name could be suggested/)).toBeTruthy()
  expect(createButton().disabled).toBe(true)
  fireEvent.change(screen.getByLabelText(/Mortgage Name/), {
    target: { value: '2026-Asha-Pendant' },
  })
  await confirmCreate()

  expect(await screen.findByText('Now at /mortgages/7')).toBeTruthy()
  expect(created.map((m) => m.name)).toEqual(['2026-Asha-Pendant'])
})

test('a new Mortgage is lent in Cash unless changed, warned about from its Preview, before the confirmation', async () => {
  const created: unknown[] = []
  await fillMortgageForm(server(created), 'gold ring', null) // ₹25,000
  expect((screen.getByLabelText('Lent Through') as HTMLSelectElement).value).toBe('cash')

  await vi.waitFor(() => expect(createButton().disabled).toBe(false), { timeout: 2000 })
  fireEvent.click(createButton())
  const warning = await screen.findByRole('dialog', { name: '₹25,000 in cash' })
  fireEvent.click(within(warning).getByRole('button', { name: 'Record in cash anyway' }))
  const confirmation = await screen.findByRole('dialog', { name: /Create Mortgage/ })
  expect(within(confirmation).getByText('Cash')).toBeTruthy()
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm and save' }))

  await screen.findByText('Now at /mortgages/7')
  expect(created).toEqual([
    expect.objectContaining({ lent_through: 'cash', amount_lent: 2_500_000 }),
  ])
})

test("opened from the Calculator, it asks for a Customer, then shows the Simulation's amount, start date and Terms", async () => {
  showPage(
    server([], {
      'GET /api/search': [
        { kind: 'customer', id: 3, name: 'Asha Rao', phone: '9829012345', photo_url: null },
      ],
    }),
    '/mortgages/new?amount=50000&start=2026-01-31&rate=2.5&mode=compounded_monthly&rule=pro_rata',
    { '/mortgages/new': <NewMortgagePage /> },
  )

  fireEvent.change(screen.getByLabelText('Customer'), { target: { value: 'Asha' } })
  fireEvent.click(await screen.findByRole('button', { name: /Asha Rao/ }, { timeout: 2000 }))

  const amount = (await screen.findByLabelText('Principal lent (₹)')) as HTMLInputElement
  expect(amount.value).toBe('50000')
  expect((screen.getByLabelText('Start date') as HTMLInputElement).value).toBe('2026-01-31')
  await vi.waitFor(() =>
    expect((screen.getByLabelText('Monthly interest rate (%)') as HTMLInputElement).value).toBe(
      '2.5',
    ),
  )
  expect((screen.getByLabelText('Interest Mode') as HTMLSelectElement).value).toBe(
    'compounded_monthly',
  )
  expect((screen.getByLabelText(/Part-Month Rule/) as HTMLSelectElement).value).toBe('pro_rata')

  // Still editable
  fireEvent.change(amount, { target: { value: '60000' } })
  expect(amount.value).toBe('60000')
  fireEvent.change(screen.getByLabelText('Monthly interest rate (%)'), { target: { value: '3' } })
  expect((screen.getByLabelText('Monthly interest rate (%)') as HTMLInputElement).value).toBe('3')
})

test("while its Preview says the Mortgage would be refused, it can't be created, and says why", async () => {
  const created: unknown[] = []
  await fillMortgageForm(
    server(created, {
      'POST /api/mortgages/preview': () =>
        Response.json({ detail: 'The start date cannot be before 2000' }, { status: 422 }),
    }),
    'Gold pendant',
  )

  expect(
    await screen.findByText('The start date cannot be before 2000', {}, { timeout: 2000 }),
  ).toBeTruthy()
  expect(createButton().disabled).toBe(true)
  fireEvent.submit(createButton().closest('form')!)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(created).toEqual([])
})

test("a net weight above the gross weight says so beside it, and can't be created", async () => {
  await fillMortgageForm(server([]), 'Gold pendant')
  fireEvent.change(screen.getByLabelText('Net weight, gold only (grams)'), {
    target: { value: '6' },
  })

  expect(screen.getByText("Net weight can't be more than the gross weight")).toBeTruthy()
  await new Promise((resolve) => setTimeout(resolve, 700)) // past the Preview's debounce
  expect(createButton().disabled).toBe(true)
})

test("a refused create shows the backend's reason, and can be tried again", async () => {
  const created: unknown[] = []
  let refuse = true
  await fillMortgageForm(
    server(created, {
      'POST /api/mortgages': async (request: Request) => {
        if (refuse) {
          refuse = false
          return Response.json({ detail: 'The Customer is archived' }, { status: 409 })
        }
        created.push(await request.json())
        return mortgage
      },
    }),
    'Gold pendant',
  )

  await confirmCreate()
  expect(await screen.findByText('The Customer is archived')).toBeTruthy()
  expect(created).toEqual([])
  await confirmCreate()

  expect(await screen.findByText('Now at /mortgages/7')).toBeTruthy()
  expect(created).toHaveLength(1)
})

test('Create is disabled while the Mortgage is being saved', async () => {
  let answer: (response: Response) => void = () => {}
  await fillMortgageForm(
    server([], {
      'POST /api/mortgages': () => new Promise<Response>((resolve) => (answer = resolve)),
    }),
    'Gold pendant',
  )

  await confirmCreate()
  const saving = (await screen.findByRole('button', { name: 'Saving…' })) as HTMLButtonElement
  expect(saving.disabled).toBe(true)
  answer(Response.json(mortgage))
  expect(await screen.findByText('Now at /mortgages/7')).toBeTruthy()
})

test('Principal lent steps by whole rupees and is saved with the paise typed; rate and weights keep their fine steps', async () => {
  const created: MortgageIn[] = []
  await fillMortgageForm(server(created), 'Gold pendant')
  expectWholeRupeeSteps(screen.getByLabelText('Principal lent (₹)'), '1', '1500.50')
  expect((screen.getByLabelText('Monthly interest rate (%)') as HTMLInputElement).step).toBe('0.01')
  expect((screen.getByLabelText('Gross weight (grams)') as HTMLInputElement).step).toBe('0.001')
  expect((screen.getByLabelText('Net weight, gold only (grams)') as HTMLInputElement).step).toBe(
    '0.001',
  )

  await confirmCreate()
  expect(await screen.findByText('Now at /mortgages/7')).toBeTruthy()
  expect(created.map((m) => m.amount_lent)).toEqual([150_050])
})
