// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ClosuresPage } from '../src/pages/ClosuresPage'
import { fakeServer } from './fakeServer'
import { showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const row = {
  id: 3, name: '2025-Arjun-GoldRing', customer: { kind: 'customer', id: 2, name: 'Arjun Patel' },
  start_date: '2025-06-15', amount_lent: 2_000_000, status: 'active', outstanding_total: 2_180_000,
}
const redemption = {
  on: '2026-04-20', principal: 2_000_000, unpaid_interest: 180_000, part_month_days: 6,
  part_month_charge: 60_000, total: 2_240_000,
}

test('the chosen Mortgages can be Waived off instead of Forfeited, each with what it brought in', async () => {
  const waived: unknown[] = []
  let listed = [row]
  const server = fakeServer({
    'GET /api/closures/ready-to-redeem': { items: [], total: 0, page: 1, page_size: 20 },
    'GET /api/mortgages': () => ({ items: listed, total: listed.length, page: 1, page_size: 20 }),
    'GET /api/mortgages/3/redemption': redemption,
    'GET /api/payment-methods': [{ method: 'cash', name: 'Cash' }],
    'POST /api/mortgages/3/waive': async (request: Request) => {
      waived.push(await request.json())
      listed = []
      return {}
    },
  })
  showPage(server, '/closures', { '/closures': <ClosuresPage /> })

  fireEvent.click(await screen.findByRole('checkbox', { name: 'Choose 2025-Arjun-GoldRing' }))
  fireEvent.click(screen.getByRole('radio', { name: 'Waive off' }))
  fireEvent.change(await screen.findByLabelText('Received now for 2025-Arjun-GoldRing'), {
    target: { value: '22000' },
  })
  expect(await screen.findByText('Total waived off ₹400')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Waive off 1' }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm Waiver' }))

  expect(await screen.findByText('No Active Mortgages with anything Outstanding.')).toBeTruthy()
  expect(waived).toEqual([expect.objectContaining({ amount_paid: 2_200_000, method: 'cash' })])
  expect(server.requests).not.toContain('POST /api/mortgages/3/forfeit')
})

test('receiving all that is owed cannot be Waived off: it is a Redemption', async () => {
  showPage(
    fakeServer({
      'GET /api/closures/ready-to-redeem': { items: [], total: 0, page: 1, page_size: 20 },
      'GET /api/mortgages': { items: [row], total: 1, page: 1, page_size: 20 },
      'GET /api/mortgages/3/redemption': redemption,
    }),
    '/closures',
    { '/closures': <ClosuresPage /> },
  )

  fireEvent.click(await screen.findByRole('checkbox', { name: 'Choose 2025-Arjun-GoldRing' }))
  fireEvent.click(screen.getByRole('radio', { name: 'Waive off' }))
  fireEvent.change(await screen.findByLabelText('Received now for 2025-Arjun-GoldRing'), {
    target: { value: '22400' },
  })

  expect(await screen.findByText('Covers what is owed: Redeem it instead')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Waive off 1' }) as HTMLButtonElement).disabled).toBe(true)
})
