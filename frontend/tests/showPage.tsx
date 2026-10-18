// Renders a page the way the app does (inside the server state and a router) against a
// fake backend. A request made with fetch directly, not through the typed client, fails
// the test.
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { vi } from 'vitest'
import type { Mortgage } from '../src/api'
import { ServerStateProvider } from '../src/components/ServerStateProvider'
import { createServerState } from '../src/serverState'
import type { FakeServer } from './fakeServer'

/** Where the app went after leaving the page under test. */
function Elsewhere() {
  return <p>Now at {useLocation().pathname}</p>
}

/** Shows `at`, with each of `routes` (path → page) reachable; anywhere else is Elsewhere. */
export function showPage(server: FakeServer, at: string, routes: Record<string, ReactElement>) {
  vi.stubGlobal('fetch', (input: unknown) => {
    throw new Error(`fetch called outside the typed client: ${String(input)}`)
  })
  const state = createServerState({ fetch: server.fetch, retry: false })
  render(
    <ServerStateProvider state={state}>
      <MemoryRouter initialEntries={[at]}>
        <Routes>
          {Object.entries(routes).map(([path, page]) => (
            <Route key={path} path={path} element={page} />
          ))}
          <Route path="*" element={<Elsewhere />} />
        </Routes>
      </MemoryRouter>
    </ServerStateProvider>,
  )
  return state
}

/** An Active Mortgage owing ₹50,750, as the backend would send it. */
export const mortgage: Mortgage = {
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
  upcoming_accrual_dates: ['2099-11-10', '2099-12-10'],
  status: 'active',
  photos: [],
  as_of: '2026-10-18',
  ledger: [],
  outstanding: { principal: 5_000_000, unpaid_interest: 75_000, total: 5_075_000 },
  collateral: null,
  closure: null,
}
