// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { NewMortgagePage } from '../src/pages/NewMortgagePage'
import { fakeServer, type FakeServer } from './fakeServer'
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
    'GET /api/customers/3': customer,
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
    'POST /api/mortgages/preview': {
      name: '',
      terms: mortgage.terms,
      after: { outstanding: 2_500_000, points: [], term_changes: [], closure: null },
    },
    'POST /api/mortgages': async (request: Request) => {
      created.push(await request.json())
      return mortgage
    },
    'GET /api/mortgages/7': mortgage,
    ...overrides,
  })
}

const createButton = () => screen.getByRole('button', { name: 'Create Mortgage' }) as HTMLButtonElement

async function fillMortgageForm(backend: FakeServer, description: string) {
  showPage(backend, '/mortgages/new?customer=3', { '/mortgages/new': <NewMortgagePage /> })
  fireEvent.change(await screen.findByLabelText('Start date'), { target: { value: '2026-09-23' } })
  fireEvent.change(screen.getByLabelText('Principal lent (₹)'), { target: { value: '25000' } })
  fireEvent.change(screen.getByLabelText('Gross weight (g)'), { target: { value: '5' } })
  fireEvent.change(screen.getByLabelText('Net weight, gold only (g)'), { target: { value: '4.5' } })
  fireEvent.change(screen.getByLabelText('Description of the jewellery'), {
    target: { value: description },
  })
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
  fireEvent.change(screen.getByLabelText(/Mortgage Name/), { target: { value: '2026-Asha-Special' } })
  fireEvent.change(screen.getByLabelText('Description of the jewellery'), {
    target: { value: 'Gold pendant with stones' },
  })

  const title = await confirmCreate()

  expect(title).toBe('Create Mortgage 2026-Asha-Special?')
  expect(await screen.findByText('Now at /mortgages/7')).toBeTruthy()
  expect(created.map((m) => m.name)).toEqual(['2026-Asha-Special'])
})

test("if no Mortgage Name can be suggested, it says so and one can be typed", async () => {
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
  fireEvent.change(screen.getByLabelText(/Mortgage Name/), { target: { value: '2026-Asha-Pendant' } })
  await confirmCreate()

  expect(await screen.findByText('Now at /mortgages/7')).toBeTruthy()
  expect(created.map((m) => m.name)).toEqual(['2026-Asha-Pendant'])
})
