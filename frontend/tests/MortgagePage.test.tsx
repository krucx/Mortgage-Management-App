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

test('waiving off shows what is let off, asks first, then shows the Waiver', async () => {
  const redemption = {
    on: '2026-04-20',
    principal: 5_000_000,
    unpaid_interest: 75_000,
    part_month_days: 6,
    part_month_charge: 0,
    total: 5_075_000,
  }
  const waived = {
    ...mortgage,
    status: 'waived' as const,
    closure: {
      kind: 'waived' as const,
      on: '2026-04-20',
      redemption_amount: 5_075_000,
      payment_id: 12,
      waived_amount: 75_000,
      recovered_amount: null,
      profit_loss: null,
      note: 'Small balance',
    },
  }
  let body: unknown = null
  const server = fakeServer({
    'GET /api/mortgages/7': () => (body ? waived : mortgage),
    'GET /api/mortgages/7/redemption': redemption,
    'POST /api/mortgages/7/waive-preview': [],
    'POST /api/mortgages/7/waive': async (request: Request) => {
      body = await request.json()
      return waived
    },
  })
  showMortgagePage(server)

  fireEvent.click(await screen.findByRole('button', { name: 'Waive off…' }))
  fireEvent.change(await screen.findByLabelText(/Received now/), { target: { value: '50000' } })
  expect(await screen.findByText('Waived off: ₹750')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Small balance' } })
  const submit = await screen.findByRole('button', { name: 'Waive off ₹750' })
  await vi.waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(submit)
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm Waiver' }))

  expect(await screen.findByText(/Waived off on/)).toBeTruthy()
  expect(body).toMatchObject({ amount_paid: 5_000_000, note: 'Small balance' })
})

test('waiving off the whole Redemption Amount is pointed to Redeem instead', async () => {
  showMortgagePage(
    fakeServer({
      'GET /api/mortgages/7': mortgage,
      'GET /api/mortgages/7/redemption': {
        on: '2026-04-20',
        principal: 5_000_000,
        unpaid_interest: 75_000,
        part_month_days: 6,
        part_month_charge: 0,
        total: 5_075_000,
      },
    }),
  )

  fireEvent.click(await screen.findByRole('button', { name: 'Waive off…' }))
  fireEvent.change(await screen.findByLabelText(/Received now/), { target: { value: '50750' } })

  expect(await screen.findByText(/Redeem it instead/)).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Waive off' }) as HTMLButtonElement).disabled).toBe(true)
})
