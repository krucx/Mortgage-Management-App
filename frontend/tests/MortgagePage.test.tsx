// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import type { Mortgage } from '../src/api'
import { MortgagePage } from '../src/pages/MortgagePage'
import { ServerStateProvider } from '../src/components/ServerStateProvider'
import { createServerState } from '../src/serverState'
import { fakeServer, type FakeServer } from './fakeServer'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const mortgage: Mortgage = {
  id: 7,
  name: '2026GoldChain',
  customer: { kind: 'customer', id: 3, name: 'Asha Rao' },
  start_date: '2026-01-10',
  amount_lent: 5_000_000,
  description: 'Gold chain',
  gross_weight_mg: 20_000,
  net_weight_mg: 18_000,
  purity_karat: 22,
  terms: { monthly_rate_bps: 150, interest_mode: 'simple', part_month_rule: 'pro_rata' },
  term_changes: [],
  upcoming_accrual_dates: ['2026-11-10'],
  status: 'active',
  photos: [],
  as_of: '2026-10-18',
  ledger: [],
  outstanding: { principal: 5_000_000, unpaid_interest: 75_000, total: 5_075_000 },
  collateral: null,
  closure: null,
}

/** The Mortgage page for Mortgage 7, served by `server`; old-style fetches go there too. */
function showMortgagePage(server: FakeServer) {
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) =>
    server.fetch(new Request(new URL(input, window.location.origin), init)),
  )
  const state = createServerState({ fetch: server.fetch, retry: false })
  render(
    <ServerStateProvider state={state}>
      <MemoryRouter initialEntries={['/mortgages/7']}>
        <Routes>
          <Route path="/mortgages/:id" element={<MortgagePage />} />
        </Routes>
      </MemoryRouter>
    </ServerStateProvider>,
  )
  return state
}

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
