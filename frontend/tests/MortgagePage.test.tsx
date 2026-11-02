// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { MortgagePage } from '../src/pages/MortgagePage'
import { fakeServer, type FakeServer } from './fakeServer'
import { mortgage, showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const showMortgagePage = (server: FakeServer) =>
  showPage(server, '/mortgages/7', { '/mortgages/:id': <MortgagePage /> })

test('the Mortgage page shows what the Mortgage owes', async () => {
  showMortgagePage(fakeServer({ 'GET /api/mortgages/7': mortgage }))

  expect(screen.getByText('Loading…')).toBeTruthy()
  expect(await screen.findByRole('heading', { name: /2026GoldChain/ })).toBeTruthy()
  expect(screen.getByText('₹50,750')).toBeTruthy()
})

test("an Active pro-rata Mortgage's Ledger ends with its Interest to Date, growing daily", async () => {
  const toDate = {
    on: '2026-10-18',
    event: 'interest_to_date' as const,
    amount: 22_500,
    principal: 5_000_000,
    unpaid_interest: 75_000,
    charged_on: 5_000_000,
    part_month_days: 9,
    interest_paid: 0,
    principal_paid: 0,
    payment_id: null,
    terms: null,
  }
  showMortgagePage(fakeServer({ 'GET /api/mortgages/7': { ...mortgage, ledger: [toDate] } }))

  expect(
    await screen.findByText(
      'Interest to Date: 9 days of this month, today included (Pro-rata by day) on ₹50,000, ' +
        'to date: grows each day until the next Accrual Date',
    ),
  ).toBeTruthy()
})

test('the Ledger says how much of a month was paid ahead', async () => {
  const step = {
    on: '2026-10-18',
    event: 'interest' as const,
    amount: 75_000,
    principal: 5_000_000,
    unpaid_interest: 30_000,
    charged_on: 5_000_000,
    part_month_days: 0,
    paid_ahead: 45_000,
    interest_paid: 0,
    principal_paid: 0,
    payment_id: null,
    terms: null,
  }
  showMortgagePage(fakeServer({ 'GET /api/mortgages/7': { ...mortgage, ledger: [step] } }))

  expect(
    await screen.findByText('Interest: 1.5% of ₹50,000, ₹450 of it paid ahead'),
  ).toBeTruthy()
})

test("the Mortgage page shows the backend's reason when it cannot load", async () => {
  showMortgagePage(fakeServer({}))

  expect(await screen.findByText('Not Found')).toBeTruthy()
})

test('deleting a photo asks first, then shows the Mortgage without it', async () => {
  const withPhoto = { ...mortgage, photos: [{ id: 5, url: '/api/photos/mortgage-7-a.jpg' }] }
  const server = fakeServer({
    'GET /api/mortgages/7': withPhoto,
    'DELETE /api/mortgages/7/photos/5': mortgage,
  })
  showMortgagePage(server)

  fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

  expect(await screen.findByText('No photos yet.')).toBeTruthy()
  expect(server.requests).toContain('DELETE /api/mortgages/7/photos/5')
})

// What the Mortgage owes on 20 Apr 2026, whatever the date asked.
const quote = {
  on: '2026-04-20',
  principal: 5_000_000,
  unpaid_interest: 75_000,
  part_month_days: 6,
  part_month_charge: 0,
  total: 5_075_000,
}
const closure = (fields: Record<string, unknown>) => ({
  on: '2026-04-20',
  outstanding: quote.total,
  payment_id: null,
  payment_amount: null,
  waived_amount: null,
  recovered_amount: null,
  profit_loss: null,
  note: null,
  ...fields,
})
const side = (closure: unknown) => ({ outstanding: 0, points: [], term_changes: [], closure })
/** A closing Preview of Mortgage 7, its Closure worked out from what was sent; or the
 *  backend's refusal. */
const closingPreview =
  (closureOf: (body: Record<string, unknown>) => unknown) => async (request: Request) => {
    const body = (await request.json()) as Record<string, unknown>
    const made = closureOf(body)
    if (typeof made === 'string') return Response.json({ detail: made }, { status: 422 })
    return [
      { mortgage_id: 7, mortgage_name: mortgage.name, before: side(null), after: side(made), ledger_changes: [] },
    ]
  }
const paidOf = (body: Record<string, unknown>) =>
  (body.mortgages as { amount_paid: number }[])[0].amount_paid
const waivePreview = closingPreview((body) =>
  paidOf(body) >= quote.total
    ? `${mortgage.name}: ₹50,750 covers the ₹50,750 owed: Redeem it instead`
    : closure({ kind: 'waived', payment_amount: paidOf(body), waived_amount: quote.total - paidOf(body) }),
)

test('waiving off shows what is let off, asks first, then shows the Waiver', async () => {
  const waived = {
    ...mortgage,
    status: 'waived' as const,
    closure: closure({
      kind: 'waived' as const,
      payment_id: 12,
      payment_amount: 5_000_000,
      waived_amount: 75_000,
      note: 'Small balance',
    }),
  }
  let body: unknown = null
  const server = fakeServer({
    'GET /api/mortgages/7': () => (body ? waived : mortgage),
    'GET /api/mortgages/7/closing-quote': quote,
    'POST /api/closures/waive-preview': waivePreview,
    'POST /api/closures/waive': async (request: Request) => {
      body = await request.json()
      return [waived]
    },
  })
  showMortgagePage(server)

  fireEvent.click(await screen.findByRole('button', { name: 'Waive off…' }))
  fireEvent.change(await screen.findByLabelText(/Received now/), { target: { value: '50000' } })
  // What is let off comes from the Preview.
  expect(await screen.findByText('Waived off: ₹750', {}, { timeout: 2000 })).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Small balance' } })
  const submit = await screen.findByRole('button', { name: 'Waive off ₹750' })
  await vi.waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(submit)
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm Waiver' }))

  expect(await screen.findByText(/Waived off on/)).toBeTruthy()
  expect(body).toMatchObject({
    note: 'Small balance',
    mortgages: [{ mortgage_id: 7, amount_paid: 5_000_000 }],
  })
  expect(server.requests).not.toContain('POST /api/mortgages/7/waive')
})

test('a Waived Mortgage shows its final Payment and what was let off', async () => {
  const waived = {
    ...mortgage,
    status: 'waived' as const,
    closure: {
      kind: 'waived' as const,
      on: '2026-04-20',
      outstanding: 5_075_000,
      payment_id: 12,
      payment_amount: 5_000_000,
      waived_amount: 75_000,
      recovered_amount: null,
      profit_loss: null,
      note: 'Small balance',
    },
  }
  showMortgagePage(fakeServer({ 'GET /api/mortgages/7': waived }))

  const paid = await screen.findByRole('link', { name: '₹50,000 (receipt)' })
  expect(paid.getAttribute('href')).toBe('/payments/12')
  const owed = screen.getByText('Outstanding on the Closure date').closest('div')!
  expect(within(owed).getByText('₹50,750')).toBeTruthy()
  expect(screen.queryByText(/Redemption Amount/)).toBeNull()
})

test('a Redeemed Mortgage gives the Outstanding it was Redeemed for', async () => {
  const redeemed = {
    ...mortgage,
    status: 'redeemed' as const,
    closure: closure({ kind: 'redeemed' as const, payment_id: 12, payment_amount: 5_075_000 }),
  }
  showMortgagePage(fakeServer({ 'GET /api/mortgages/7': redeemed }))

  expect(
    await screen.findByText((_, el) => el?.textContent === 'Redeemed on 20 Apr 2026, paying its Outstanding of ₹50,750. Final Payment (receipt)'),
  ).toBeTruthy()
})

test("the Projection shows one Outstanding per date, the Interest to Date included", async () => {
  const point = (months: number, on: string, owed: number) => ({
    months, on, principal: 5_000_000, unpaid_interest: owed - 5_000_000, outstanding: owed + 22_500, loan_to_value: null,
  })
  showMortgagePage(
    fakeServer({
      'GET /api/mortgages/7': mortgage,
      'GET /api/mortgages/7/projection': {
        as_of: '2026-04-20',
        collateral_value: null,
        monthly_payment: null,
        baseline: {
          points: [point(3, '2026-07-20', 5_525_000), point(6, '2026-10-20', 5_975_000), point(12, '2027-04-20', 6_875_000)],
          term_changes: [],
          paid_off_on: null,
        },
        what_if: null,
      },
    }),
  )

  const owed = (await screen.findByRole('cell', { name: 'Outstanding' })).closest('tr')!
  expect(within(owed).getAllByRole('cell').map((td) => td.textContent)).toEqual([
    'Outstanding', '₹55,475', '₹59,975', '₹68,975',
  ])
  expect(screen.queryByText(/Redemption Amount/)).toBeNull()
})

test("waiving off the whole Outstanding is refused by the backend's Preview", async () => {
  showMortgagePage(
    fakeServer({
      'GET /api/mortgages/7': mortgage,
      'GET /api/mortgages/7/closing-quote': quote,
      'POST /api/closures/waive-preview': waivePreview,
    }),
  )

  fireEvent.click(await screen.findByRole('button', { name: 'Waive off…' }))
  fireEvent.change(await screen.findByLabelText(/Received now/), { target: { value: '50750' } })

  expect(
    await screen.findByText(`${mortgage.name}: ₹50,750 covers the ₹50,750 owed: Redeem it instead`, {}, { timeout: 2000 }),
  ).toBeTruthy()
  expect((screen.getByRole('button', { name: /^Waive off/ }) as HTMLButtonElement).disabled).toBe(true)
})

test('forfeiting shows the profit or loss from the Preview, then Forfeits it alone', async () => {
  let body: unknown = null
  const forfeited = (recovered: number) =>
    closure({ kind: 'forfeited', recovered_amount: recovered, profit_loss: recovered - quote.total })
  const server = fakeServer({
    'GET /api/mortgages/7': () =>
      body ? { ...mortgage, status: 'forfeited', closure: forfeited(4_000_000) } : mortgage,
    'GET /api/mortgages/7/closing-quote': quote,
    'POST /api/closures/forfeit-preview': closingPreview((body) =>
      forfeited((body.mortgages as { recovered_amount: number }[])[0].recovered_amount),
    ),
    'POST /api/closures/forfeit': async (request: Request) => {
      body = await request.json()
      return [{ ...mortgage, status: 'forfeited', closure: forfeited(4_000_000) }]
    },
  })
  showMortgagePage(server)

  fireEvent.click(await screen.findByRole('button', { name: 'Forfeit…' }))
  fireEvent.change(await screen.findByLabelText(/Recovered Amount/), { target: { value: '40000' } })
  // Recovered ₹40,000 of ₹50,750.
  expect(await screen.findByText('Loss of ₹10,750', {}, { timeout: 2000 })).toBeTruthy()
  const submit = screen.getByRole('button', { name: 'Forfeit' }) as HTMLButtonElement
  await vi.waitFor(() => expect(submit.disabled).toBe(false))
  fireEvent.click(submit)
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm Forfeiture' }),
  )

  expect(await screen.findByText(/Forfeited on/)).toBeTruthy()
  expect(body).toMatchObject({ mortgages: [{ mortgage_id: 7, recovered_amount: 4_000_000 }] })
})

test('a future date is quoted, but the backend refuses to record it', async () => {
  showMortgagePage(
    fakeServer({
      'GET /api/mortgages/7': mortgage,
      'GET /api/mortgages/7/closing-quote': quote,
      'POST /api/closures/redeem-preview': closingPreview(
        () => `${mortgage.name}: A Redemption, Waiver or Forfeiture cannot be recorded for a future date`,
      ),
    }),
  )

  fireEvent.click(await screen.findByRole('button', { name: 'Redeem…' }))
  fireEvent.change(await screen.findByLabelText('Redeemed on'), { target: { value: '2099-01-01' } })

  // The quote still shows; the backend's refusal keeps it from being saved.
  const owed = (await screen.findByText('Outstanding on 1 Jan 2099')).closest('div')!
  expect(within(owed).getByText('₹50,750')).toBeTruthy()
  expect(screen.queryByText(/Redemption Amount/)).toBeNull()
  expect(
    await screen.findByText(/cannot be recorded for a future date/, {}, { timeout: 2000 }),
  ).toBeTruthy()
  expect((screen.getByRole('button', { name: /^Redeem for/ }) as HTMLButtonElement).disabled).toBe(true)
})
