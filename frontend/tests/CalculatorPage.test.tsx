// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { useLocation } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Simulation, SimulationIn } from '../src/api'
import { CalculatorPage } from '../src/pages/CalculatorPage'
import { fakeServer } from './fakeServer'
import { showPage } from './showPage'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 3, 20, 10)) // 20 Apr 2026
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const DEFAULT_TERMS = {
  monthly_rate_bps: 200,
  interest_mode: 'compounded_monthly',
  part_month_rule: 'full_month',
}

// ₹1,00,000 at 2% a month, Compounded Monthly, closed a year on.
const simulation: Simulation = {
  on_closure: {
    on: '2027-04-20',
    principal: 12_682_400,
    unpaid_interest: 0,
    last_accrual_on: '2027-04-20',
    interest_to_date_days: 1,
    interest_to_date: 253_600,
    total: 12_936_000,
  },
  interest_earned: 2_936_000,
  first_month_interest: 200_000,
  effective_annual_rate: 0.268242,
  points: [
    { on: '2026-04-20', outstanding: 10_200_000 },
    { on: '2027-04-20', outstanding: 12_936_000 },
  ],
  months: [
    {
      on: '2026-05-20',
      interest: 200_000,
      interest_to_date_days: null,
      capitalised: 200_000,
      principal: 10_200_000,
      unpaid_interest: 0,
    },
    {
      on: '2027-04-20',
      interest: 253_600,
      interest_to_date_days: 1,
      capitalised: 0,
      principal: 12_682_400,
      unpaid_interest: 253_600,
    },
  ],
}

/** The backend, recording each Simulation asked for. */
function backend() {
  const asked: SimulationIn[] = []
  const server = fakeServer({
    'GET /api/settings/default-terms': DEFAULT_TERMS,
    'POST /api/simulation': async (request: Request) => {
      asked.push(await request.json())
      return simulation
    },
  })
  return { server, asked }
}

/** Where the page has put its inputs. */
function Search() {
  return <output aria-label="search">{useLocation().search}</output>
}

function showCalculator(server: ReturnType<typeof backend>['server'], at = '/calculator') {
  showPage(server, at, {
    '/calculator': (
      <>
        <CalculatorPage />
        <Search />
      </>
    ),
  })
}

/** The figure on the tile captioned `caption`. */
const tile = (caption: string) =>
  screen.getByText(caption).closest('.tile')?.querySelector('strong')?.textContent

const field = (label: string | RegExp) => screen.getByLabelText<HTMLInputElement>(label)
const type = (label: string | RegExp, value: string) =>
  fireEvent.change(field(label), { target: { value } })

test('a fresh Calculator starts today, closes a year on, under the Default Terms', async () => {
  const { server } = backend()
  showCalculator(server)

  await vi.waitFor(() => expect(field('Monthly interest rate (%)').value).toBe('2'))
  expect(field('Start date').value).toBe('2026-04-20')
  expect(field('Closed on').value).toBe('2027-04-20')
  expect(field('Interest Mode').value).toBe('compounded_monthly')
  expect(field(/Part-Month Rule/).value).toBe('full_month')
})

test('an amount brings up the tiles, worked out by the backend', async () => {
  const { server, asked } = backend()
  showCalculator(server)
  await vi.waitFor(() => expect(field('Monthly interest rate (%)').value).toBe('2'))

  type('Amount lent (₹)', '100000')

  await screen.findByText('Outstanding on 20 Apr 2027', {}, { timeout: 2000 })
  expect(tile('Outstanding on 20 Apr 2027')).toBe('₹1,29,360')
  expect(asked.at(-1)).toEqual({
    amount_lent: 10_000_000,
    start_date: '2026-04-20',
    closed_on: '2027-04-20',
    terms: DEFAULT_TERMS,
    span_months: 12,
  })
  expect(tile('Total interest earned')).toBe('₹29,360')
  expect(tile("First month's interest")).toBe('₹2,000')
  expect(tile('Effective annual rate')).toBe('26.82%')
})

test('a bookmarked Calculator opens with its inputs, and asks for that Simulation', async () => {
  const { server, asked } = backend()
  showCalculator(
    server,
    '/calculator?amount=50000&start=2026-01-31&closed=2026-12-31&span=24&rate=2.5&mode=simple&rule=pro_rata',
  )

  await vi.waitFor(() => expect(asked.length).toBe(1), { timeout: 2000 })
  expect(asked[0]).toEqual({
    amount_lent: 5_000_000,
    start_date: '2026-01-31',
    closed_on: '2026-12-31',
    terms: { monthly_rate_bps: 250, interest_mode: 'simple', part_month_rule: 'pro_rata' },
    span_months: 24,
  })
  expect(field('Amount lent (₹)').value).toBe('50000')
  expect(field('Monthly interest rate (%)').value).toBe('2.5')
  expect(field('Graph span').value).toBe('24')
})

test('each change goes into the URL, with every input, and is worked out again', async () => {
  const { server, asked } = backend()
  showCalculator(server)
  await vi.waitFor(() => expect(field('Monthly interest rate (%)').value).toBe('2'))

  type('Amount lent (₹)', '100000')
  await screen.findByText('Total interest earned', {}, { timeout: 2000 })
  type('Monthly interest rate (%)', '3')

  await vi.waitFor(() => expect(asked.at(-1)?.terms.monthly_rate_bps).toBe(300), { timeout: 2000 })
  expect(Object.fromEntries(new URLSearchParams(screen.getByLabelText('search').textContent!))).toEqual({
    amount: '100000',
    start: '2026-04-20',
    closed: '2027-04-20',
    span: '12',
    rate: '3',
    mode: 'compounded_monthly',
    rule: 'full_month',
  })
})

test.each([
  ['Amount lent (₹)', '0', 'Enter an amount over ₹0'],
  ['Monthly interest rate (%)', '0', 'The rate must be over 0% and at most 100% a month'],
  ['Monthly interest rate (%)', '100.5', 'The rate must be over 0% and at most 100% a month'],
  ['Closed on', '2026-04-20', 'Closed on must be after the start date'],
  ['Closed on', '2036-04-21', 'Closed on must be at most 10 years after the start date'],
])('%s of %s is refused next to the field, and not worked out', async (label, value, message) => {
  const { server, asked } = backend()
  showCalculator(server, '/calculator?amount=100000')
  await vi.waitFor(() => expect(asked.length).toBe(1), { timeout: 2000 })

  const input = field(label)
  fireEvent.change(input, { target: { value } })

  const shown = await screen.findByText(message)
  expect(shown.closest('label')).toBe(input.closest('label'))
  expect(screen.queryByText('Total interest earned')).toBeNull()
  await new Promise((resolve) => setTimeout(resolve, 400))
  expect(asked.length).toBe(1)
})

test('ten years on is the latest it can close', async () => {
  const { server } = backend()
  showCalculator(server, '/calculator?amount=100000')
  await vi.waitFor(() => expect(field('Monthly interest rate (%)').value).toBe('2'))

  type('Closed on', '2036-04-20')

  expect(screen.queryByText(/at most 10 years/)).toBeNull()
})

test('the graph is one Outstanding line, Closed on marked, over the chosen span', async () => {
  const { server, asked } = backend()
  showCalculator(server, '/calculator?amount=100000')
  await screen.findByText('Total interest earned', {}, { timeout: 2000 })

  const graph = screen.getByRole('img', { name: 'Outstanding from 20 Apr 2026 to 20 Apr 2027' })
  expect(graph.querySelectorAll('path.series')).toHaveLength(1)
  expect(screen.getByText('Closed on 20 Apr 2027')).toBeTruthy()

  fireEvent.change(field('Graph span'), { target: { value: '36' } })

  await vi.waitFor(() => expect(asked.at(-1)?.span_months).toBe(36), { timeout: 2000 })
})

test('the month-by-month table is folded away until opened', async () => {
  const { server } = backend()
  showCalculator(server, '/calculator?amount=100000')
  await screen.findByText('Total interest earned', {}, { timeout: 2000 })

  const table = screen.getByText('Month by month').closest('details')!
  expect(table.open).toBe(false)
  const rows = [...table.querySelectorAll('tbody tr')].map((row) =>
    [...row.querySelectorAll('td')].map((cell) => cell.textContent),
  )
  expect(rows).toEqual([
    ['20 May 2026', '₹2,000', '₹2,000', '₹1,02,000', '₹0'],
    ['20 Apr 2027 · Interest to Date, 1 day', '₹2,536', '—', '₹1,26,824', '₹2,536'],
  ])
})
