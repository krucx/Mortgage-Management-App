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
const redemption = {
  on: '2026-04-20',
  principal: 5_000_000,
  unpaid_interest: 75_000,
  part_month_days: 6,
  part_month_charge: 0,
  total: 5_075_000,
}
const closure = (fields: Record<string, unknown>) => ({
  on: '2026-04-20',
  redemption_amount: redemption.total,
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
  paidOf(body) >= redemption.total
    ? `${mortgage.name}: ₹50,750 covers the ₹50,750 owed: Redeem it instead`
    : closure({ kind: 'waived', payment_amount: paidOf(body), waived_amount: redemption.total - paidOf(body) }),
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
    'GET /api/mortgages/7/redemption': redemption,
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
      redemption_amount: 5_075_000,
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
})

test("waiving off the whole Redemption Amount is refused by the backend's Preview", async () => {
  showMortgagePage(
    fakeServer({
      'GET /api/mortgages/7': mortgage,
      'GET /api/mortgages/7/redemption': redemption,
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
    closure({ kind: 'forfeited', recovered_amount: recovered, profit_loss: recovered - redemption.total })
  const server = fakeServer({
    'GET /api/mortgages/7': () =>
      body ? { ...mortgage, status: 'forfeited', closure: forfeited(4_000_000) } : mortgage,
    'GET /api/mortgages/7/redemption': redemption,
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
      'GET /api/mortgages/7/redemption': redemption,
      'POST /api/closures/redeem-preview': closingPreview(
        () => `${mortgage.name}: A Redemption, Waiver or Forfeiture cannot be recorded for a future date`,
      ),
    }),
  )

  fireEvent.click(await screen.findByRole('button', { name: 'Redeem…' }))
  fireEvent.change(await screen.findByLabelText('Redeemed on'), { target: { value: '2099-01-01' } })

  // The quote still shows; the backend's refusal keeps it from being saved.
  expect(await screen.findByText('₹50,750')).toBeTruthy()
  expect(
    await screen.findByText(/cannot be recorded for a future date/, {}, { timeout: 2000 }),
  ).toBeTruthy()
  expect((screen.getByRole('button', { name: /^Redeem for/ }) as HTMLButtonElement).disabled).toBe(true)
})
