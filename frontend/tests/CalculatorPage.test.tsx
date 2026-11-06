// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
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
  paid_off_on: null,
  lump_sums: [],
  points: [
    { on: '2026-04-20', outstanding: 10_200_000 },
    { on: '2027-04-20', outstanding: 12_936_000 },
  ],
  payments: [],
  months: [
    {
      on: '2026-05-20',
      interest: 200_000,
      paid: 0,
      interest_to_date_days: null,
      capitalised: 200_000,
      principal: 10_200_000,
      unpaid_interest: 0,
    },
    {
      on: '2027-04-20',
      interest: 253_600,
      paid: 0,
      interest_to_date_days: 1,
      capitalised: 0,
      principal: 12_682_400,
      unpaid_interest: 253_600,
    },
  ],
}

/** The backend, recording each Simulation asked for and answering with `answer`'s. */
function backend(answer: (asked: SimulationIn) => unknown = () => simulation) {
  const asked: SimulationIn[] = []
  const server = fakeServer({
    'GET /api/settings/default-terms': DEFAULT_TERMS,
    'GET /api/settings/gold-rates': [
      { purity_karat: 22, rate_per_gram: 600_000, updated_on: '2026-04-19' },
      { purity_karat: 18, rate_per_gram: null, updated_on: null },
    ],
    'POST /api/simulation': async (request: Request) => {
      const body = (await request.json()) as SimulationIn
      asked.push(body)
      return answer(body)
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
    '/mortgages/new': (
      <>
        <p>New Mortgage</p>
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
    lump_sums: [],
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
    lump_sums: [],
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
    ['20 May 2026', '₹2,000', '—', '₹2,000', '₹1,02,000', '₹0'],
    ['20 Apr 2027 · Interest to Date, 1 day', '₹2,536', '—', '—', '₹1,26,824', '₹2,536'],
  ])
})

const search = () =>
  Object.fromEntries(new URLSearchParams(screen.getByLabelText('search').textContent!))
const button = (name: string | RegExp) => screen.getByRole<HTMLButtonElement>('button', { name })
const settle = (expectation: () => void) => vi.waitFor(expectation, { timeout: 2000 })

test('a monthly amount and dated Lump Sums are planned, added and removed, all in the URL', async () => {
  const { server, asked } = backend()
  showCalculator(server, '/calculator?amount=100000')
  await screen.findByText('Total interest earned', {}, { timeout: 2000 })

  type('Monthly payment (₹)', '3000')
  fireEvent.click(button('Add a Lump Sum'))
  fireEvent.click(button('Add a Lump Sum'))
  type('Lump Sum 1 date', '2026-06-01')
  type('Lump Sum 1 amount (₹)', '20000')
  type('Lump Sum 2 date', '2026-09-01')
  type('Lump Sum 2 amount (₹)', '5000')

  await settle(() =>
    expect(asked.at(-1)).toMatchObject({
      monthly_payment: 300_000,
      lump_sums: [
        { on: '2026-06-01', amount: 2_000_000 },
        { on: '2026-09-01', amount: 500_000 },
      ],
    }),
  )
  expect(search()).toMatchObject({ monthly: '3000', lumps: '2026-06-01:20000,2026-09-01:5000' })

  fireEvent.click(button('Remove Lump Sum 1'))
  await settle(() =>
    expect(asked.at(-1)?.lump_sums).toEqual([{ on: '2026-09-01', amount: 500_000 }]),
  )
  expect(search().lumps).toBe('2026-09-01:5000')
})

test('a bookmarked plan opens with its rows', async () => {
  const { server, asked } = backend()
  showCalculator(server, '/calculator?amount=100000&monthly=2500&lumps=2026-06-01:20000,:')
  await settle(() => expect(asked.length).toBe(1))

  expect(field('Monthly payment (₹)').value).toBe('2500')
  expect(field('Lump Sum 1 amount (₹)').value).toBe('20000')
  expect(field('Lump Sum 2 date').value).toBe('')
  // A row not filled in yet is left out.
  expect(asked[0].lump_sums).toEqual([{ on: '2026-06-01', amount: 2_000_000 }])
})

test.each([
  ['Lump Sum 1 amount (₹)', '0', 'Enter an amount over ₹0'],
  ['Lump Sum 1 date', '2026-04-19', 'Must be on or after the start date'],
])('a Lump Sum with %s of %s is refused on its row', async (label, value, message) => {
  const { server, asked } = backend()
  showCalculator(server, '/calculator?amount=100000&lumps=2026-06-01:20000')
  await settle(() => expect(asked.length).toBe(1))

  type(label, value)

  const shown = await screen.findByText(message)
  expect(shown.closest('.lump-sum')).toBe(field(label).closest('.lump-sum'))
  await new Promise((resolve) => setTimeout(resolve, 400))
  expect(asked.length).toBe(1)
})

test('a Lump Sum after Closed on is ignored, with a hint on its row', async () => {
  const { server } = backend((asked) => ({
    ...simulation,
    lump_sums: asked.lump_sums!.map((lump) => ({
      ...lump,
      ignored: lump.on > asked.closed_on ? 'after_closed_on' : null,
    })),
  }))
  showCalculator(server, '/calculator?amount=100000&lumps=2026-06-01:20000,2027-05-01:5000')

  const hint = await screen.findByText('Ignored: after Closed on', {}, { timeout: 2000 })
  expect(hint.closest('.lump-sum')).toBe(field('Lump Sum 2 date').closest('.lump-sum'))
  expect(screen.getAllByText(/Ignored/)).toHaveLength(1)
})

test('a Lump Sum larger than what is owed on its date is refused on its row', async () => {
  const { server } = backend(() =>
    Response.json(
      {
        detail: {
          lump_sum: 1,
          owed: 10_500_000,
          on: '2026-05-15',
          message: 'The Lump Sum on 15 May 2026 is more than the ₹1,05,000 owed then',
        },
      },
      { status: 422 },
    ),
  )
  // The empty row is not sent, so the refused one is the third row.
  showCalculator(server, '/calculator?amount=100000&lumps=2026-05-01:1000,:,2026-05-15:200000')

  const refusal = await screen.findByText('Only ₹1,05,000 owed on 15 May', {}, { timeout: 2000 })
  expect(refusal.closest('.lump-sum')).toBe(field('Lump Sum 3 date').closest('.lump-sum'))
  expect(screen.queryByText('Total interest earned')).toBeNull()
})

test('the Paid off tile shows only with a plan, and says so when not within 10 years', async () => {
  const { server } = backend((asked) => ({
    ...simulation,
    paid_off_on: asked.monthly_payment === 5_000_000 ? '2026-07-20' : null,
  }))
  showCalculator(server, '/calculator?amount=100000')
  await screen.findByText('Total interest earned', {}, { timeout: 2000 })
  expect(screen.queryByText(/Paid off/)).toBeNull()

  type('Monthly payment (₹)', '1000')
  await screen.findByText('Paid off', {}, { timeout: 2000 })
  expect(tile('Paid off')).toBe('Not within 10 years')

  type('Monthly payment (₹)', '50000')
  await settle(() => expect(tile('Paid off')).toBe('20 Jul 2026'))
})

test('planned Payments are dots on the line and rows of the table', async () => {
  const { server } = backend(() => ({
    ...simulation,
    payments: [
      { on: '2026-05-20', amount: 300_000 },
      { on: '2026-06-01', amount: 2_000_000 },
    ],
    // The backend works out where it stands on each Payment's date.
    points: [
      { on: '2026-04-20', outstanding: 10_200_000 },
      { on: '2026-05-20', outstanding: 10_200_000 },
      { on: '2026-06-01', outstanding: 8_200_000 },
      { on: '2027-04-20', outstanding: 9_000_000 },
    ],
    months: [
      simulation.months[0],
      { ...simulation.months[0], interest: 0, paid: 300_000, capitalised: 0, principal: 10_000_000 },
    ],
  }))
  showCalculator(server, '/calculator?amount=100000&monthly=3000')
  await screen.findByText('Total interest earned', {}, { timeout: 2000 })

  expect(screen.getByRole('img').querySelectorAll('circle.payment')).toHaveLength(2)
  const rows = [...screen.getByText('Month by month').closest('details')!.querySelectorAll('tbody tr')]
  expect([...rows[1].querySelectorAll('td')].map((cell) => cell.textContent)).toEqual([
    '20 May 2026',
    '—',
    '₹3,000',
    '—',
    '₹1,00,000',
    '₹0',
  ])
})

/** A Simulation under Simple Terms owing ₹2,820 less than the Compounded Monthly one. */
const byTerms = (asked: SimulationIn): Simulation =>
  asked.terms.interest_mode === 'simple'
    ? {
        ...simulation,
        on_closure: { ...simulation.on_closure, total: 12_400_000 },
        interest_earned: 2_400_000,
        effective_annual_rate: 0.24,
      }
    : { ...simulation, on_closure: { ...simulation.on_closure, total: 12_682_000 } }

test('a second set of Terms is run alongside, each tile labelled with both and the difference', async () => {
  const { server, asked } = backend(byTerms)
  showCalculator(server, '/calculator?amount=100000&mode=simple&rate=2&rule=full_month')
  await screen.findByText('Total interest earned', {}, { timeout: 2000 })

  fireEvent.click(button('Compare other Terms'))
  const second = screen.getByRole('group', { name: 'Compared with' })
  fireEvent.change(within(second).getByLabelText('Interest Mode'), {
    target: { value: 'compounded_monthly' },
  })

  await settle(() =>
    expect(tile('Outstanding on 20 Apr 2027')).toBe('2% Simple ₹1,24,000 · 2% Monthly ₹1,26,820'),
  )
  const outstanding = screen.getByText('Outstanding on 20 Apr 2027').closest('.tile')!
  expect(within(outstanding as HTMLElement).getByText('+₹2,820')).toBeTruthy()
  expect(asked.at(-1)).toMatchObject({ amount_lent: 10_000_000, closed_on: '2027-04-20' })
  expect(search()).toMatchObject({ rate2: '2', mode2: 'compounded_monthly', rule2: 'full_month' })
  expect(screen.getByRole('img').querySelectorAll('path.series')).toHaveLength(2)

  fireEvent.click(button('Remove the compared Terms'))
  await settle(() => expect(tile('Outstanding on 20 Apr 2027')).toBe('₹1,24,000'))
  expect(screen.getByRole('img').querySelectorAll('path.series')).toHaveLength(1)
  expect(search().rate2).toBeUndefined()
})

test('the jewellery value is folded away, and without one there is no Loan-to-Value', async () => {
  const { server } = backend()
  showCalculator(server, '/calculator?amount=100000')
  await screen.findByText('Total interest earned', {}, { timeout: 2000 })

  expect((screen.getByText('Jewellery value').closest('details') as HTMLDetailsElement).open).toBe(false)
  expect(screen.queryByText(/Loan-to-Value/)).toBeNull()
})

test('a net weight is valued at the Gold Rate for its purity, giving Loan-to-Value now and on Closed on', async () => {
  const { server } = backend()
  showCalculator(server, '/calculator?amount=100000')
  await screen.findByText('Total interest earned', {}, { timeout: 2000 })

  type('Net weight, gold only (grams)', '25') // 25 g at ₹6,000 = ₹1,50,000

  await screen.findByText('Loan-to-Value now')
  expect(screen.getByText('Collateral Value ₹1,50,000 at ₹6,000 a gram')).toBeTruthy()
  expect(tile('Loan-to-Value now')).toBe('66.7%')
  expect(tile('Loan-to-Value on 20 Apr 2027')).toBe('86.2%') // ₹1,29,360

  type('Collateral Value (₹)', '200000') // typed: overrides the weight
  await settle(() => expect(tile('Loan-to-Value now')).toBe('50%'))
  expect(search()).toMatchObject({ net: '25', value: '200000' })
})

test('a purity with no Gold Rate set gives no value', async () => {
  const { server } = backend()
  showCalculator(server, '/calculator?amount=100000&net=25&purity=18')
  await screen.findByText('Total interest earned', {}, { timeout: 2000 })

  expect(screen.getByText('No Gold Rate set for 18K: type a Collateral Value instead')).toBeTruthy()
  expect(screen.queryByText(/Loan-to-Value/)).toBeNull()
})

test('Lend this opens New Mortgage with the amount, start date and first Terms, not the plan', async () => {
  const { server } = backend()
  showCalculator(
    server,
    '/calculator?amount=50000&start=2026-04-01&rate=2.5&mode=simple&rule=pro_rata&monthly=1000' +
      '&rate2=3&mode2=simple&rule2=full_month',
  )
  await screen.findByText('Total interest earned', {}, { timeout: 2000 })

  fireEvent.click(button('Lend this'))

  await screen.findByText('New Mortgage')
  expect(search()).toEqual({
    amount: '50000',
    start: '2026-04-01',
    rate: '2.5',
    mode: 'simple',
    rule: 'pro_rata',
  })
})

test('Lend this is disabled, with a tip, for a start date still to come', async () => {
  const { server } = backend()
  showCalculator(server, '/calculator?amount=50000&start=2026-04-21')
  await screen.findByText('Total interest earned', {}, { timeout: 2000 })

  expect(button('Lend this').disabled).toBe(true)
  expect(screen.getByText("Can't lend before the start date")).toBeTruthy()
})

/** The collapsible section whose summary reads `summary`. */
const section = (summary: string) =>
  screen.getByText(summary, { selector: 'summary' }).closest('details') as HTMLDetailsElement

/** Whether `a` comes before `b` on the page. */
const before = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

test('the tiles and the graph come before the inputs, so they show without scrolling', async () => {
  const { server } = backend()
  showCalculator(server, '/calculator?amount=100000')
  await screen.findByText('Total interest earned', {}, { timeout: 2000 })

  const before = (a: Node, b: Node) =>
    !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
  const tiles = screen.getByText('Total interest earned').closest('.tiles')!
  expect(before(tiles, field('Amount lent (₹)'))).toBe(true)
  expect(before(screen.getByRole('img'), field('Amount lent (₹)'))).toBe(true)
})

test('before an amount, the hint is where the tiles will be, above the inputs', async () => {
  const { server } = backend()
  showCalculator(server)
  await vi.waitFor(() => expect(field('Monthly interest rate (%)').value).toBe('2'))

  const hint = screen.getByText('Enter an amount to see what it would come to.')
  expect(
    hint.compareDocumentPosition(field('Amount lent (₹)')) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy()
})

test('the graph can be folded away, open to start with', async () => {
  const { server } = backend()
  showCalculator(server, '/calculator?amount=100000')
  await screen.findByText('Total interest earned', {}, { timeout: 2000 })

  const graph = section('Graph')
  expect(graph.open).toBe(true)
  expect(within(graph).getByRole('img')).toBeTruthy()
  expect(within(graph).getByLabelText('Graph span')).toBeTruthy()
})

test('the inputs are in sections that fold: the loan open, the plan folded away until there is one', async () => {
  const { server } = backend()
  showCalculator(server, '/calculator?amount=100000')
  await screen.findByText('Total interest earned', {}, { timeout: 2000 })

  const loan = section('Loan and Terms')
  expect(loan.open).toBe(true)
  expect(within(loan).getByLabelText('Amount lent (₹)')).toBeTruthy()
  expect(within(loan).getByLabelText('Monthly interest rate (%)')).toBeTruthy()
  const plan = section('Planned Payments')
  expect(plan.open).toBe(false)
  expect(within(plan).getByLabelText('Monthly payment (₹)')).toBeTruthy()
  expect(section('Jewellery value').open).toBe(false)
})

test('a bookmarked plan opens its section', async () => {
  const { server } = backend()
  showCalculator(server, '/calculator?amount=100000&monthly=5000')
  await screen.findByText('Total interest earned', {}, { timeout: 2000 })

  expect(section('Planned Payments').open).toBe(true)
})

test('a folded graph stays folded while a compared set of Terms is worked out', async () => {
  const { server } = backend(byTerms)
  showCalculator(server, '/calculator?amount=100000&mode=simple&rate=2&rule=full_month')
  await screen.findByText('Total interest earned', {}, { timeout: 2000 })

  fireEvent.click(screen.getByText('Graph', { selector: 'summary' }))
  await vi.waitFor(() => expect(section('Graph').open).toBe(false))
  fireEvent.click(button('Compare other Terms'))
  fireEvent.change(
    within(screen.getByRole('group', { name: 'Compared with' })).getByLabelText('Interest Mode'),
    {
      target: { value: 'compounded_monthly' },
    },
  )

  await settle(() =>
    expect(tile('Outstanding on 20 Apr 2027')).toBe('2% Simple ₹1,24,000 · 2% Monthly ₹1,26,820'),
  )
  expect(section('Graph').open).toBe(false)
})

test('a refused Lump Sum says at the top where to look, its section perhaps folded', async () => {
  const { server } = backend(() =>
    Response.json(
      {
        detail: {
          lump_sum: 0,
          owed: 10_500_000,
          on: '2026-05-15',
          message: 'The Lump Sum on 15 May 2026 is more than the ₹1,05,000 owed then',
        },
      },
      { status: 422 },
    ),
  )
  showCalculator(server, '/calculator?amount=100000&lumps=2026-05-15:200000')

  const note = await screen.findByText(
    'A Lump Sum is more than is owed on its date: see Planned Payments.',
    {},
    { timeout: 2000 },
  )
  expect(before(note, field('Amount lent (₹)'))).toBe(true)
})

test('an input it cannot work out with says so at the top, not to enter an amount', async () => {
  const { server } = backend()
  showCalculator(server, '/calculator?amount=100000&monthly=-5')
  await vi.waitFor(() => expect(field('Monthly interest rate (%)').value).toBe('2'))

  expect(screen.getByText('Fix the inputs marked below to see what it would come to.')).toBeTruthy()
  expect(screen.queryByText('Enter an amount to see what it would come to.')).toBeNull()
})
