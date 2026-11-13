// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { Dashboard } from '../src/api'
import { DashboardPage } from '../src/pages/DashboardPage'
import { fakeServer } from './fakeServer'
import { showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const figures: Dashboard = {
  as_of: '2026-04-20',
  activity_start_date: '2026-04-01',
  activity_end_date: '2026-04-20',
  principal_lent_in_period: 120000,
  principal_redeemed_in_period: 97000,
  interest_collected_in_period: 30000,
  active_mortgages: 1,
  customers_with_active_mortgages: 1,
  principal_outstanding: 100000,
  unpaid_interest: 5000,
  interest_collected_this_month: 8000,
  interest_collected_this_year: 10000,
  collateral_value: 0,
  loan_to_value: null,
  call_list_count: 0,
  reminders_to_send: 0,
  reminders_to_approve: 0,
  redeemed_this_month: 0,
  waived_this_month: 0,
  waived_amount_this_month: 0,
  forfeited_this_month: 0,
  forfeiture_profit_loss_this_month: 0,
  payments_by_month: [],
  projections: [3, 6, 12].map((months) => ({
    months,
    on: '2026-07-20',
    interest_accrued: 0,
    payments_estimate: 0,
    principal_lent_estimate: 0,
    redemptions_estimate: 0,
  })),
  trend_months: ['2026-01', '2026-02', '2026-03'],
  coming_months: [],
}

test('activity timeframe defaults to this month and refreshes totals when dates change', async () => {
  const ranges: string[] = []
  const server = fakeServer({
    'GET /api/dashboard': (request: Request) => {
      const url = new URL(request.url)
      if (url.search)
        ranges.push(`${url.searchParams.get('start_date')}:${url.searchParams.get('end_date')}`)
      return {
        ...figures,
        principal_lent_in_period: url.search ? 50000 : figures.principal_lent_in_period,
      }
    },
  })
  showPage(server, '/', { '/': <DashboardPage /> })

  const start = await screen.findByLabelText('Activity start date')
  const end = screen.getByLabelText('Activity end date')
  expect(start).toHaveProperty('value', '2026-04-01')
  expect(end).toHaveProperty('value', '2026-04-20')
  expect(screen.getByText('Mortgage principal lent')).toBeTruthy()

  fireEvent.change(start, { target: { value: '2026-04-12' } })
  fireEvent.change(end, { target: { value: '2026-04-15' } })
  await waitFor(() => expect(ranges).toContain('2026-04-12:2026-04-15'))
  expect(await screen.findByText('₹500')).toBeTruthy()
})

test('activity timeframe explains an end date before the start date', async () => {
  showPage(fakeServer({ 'GET /api/dashboard': figures }), '/', { '/': <DashboardPage /> })

  const start = await screen.findByLabelText('Activity start date')
  const end = screen.getByLabelText('Activity end date')
  fireEvent.change(start, { target: { value: '2026-04-16' } })
  fireEvent.change(end, { target: { value: '2026-04-15' } })

  expect((await screen.findByRole('alert')).textContent).toBe(
    'End date must be on or after start date.',
  )
})
