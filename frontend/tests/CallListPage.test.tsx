// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { CallListPage as Listed } from '../src/api'
import { CallListPage } from '../src/pages/CallListPage'
import { fakeServer } from './fakeServer'
import { showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const listed: Listed = {
  items: [
    {
      customer: { kind: 'customer', id: 2, name: 'Arjun Patel' },
      phone_1: '9820023456',
      phone_2: null,
      rows: [
        { mortgage_id: 4, mortgage_name: '2026-Arjun-GoldChain', reasons: ['accrues_today'], months_unpaid: 2, loan_to_value: 0.35, outstanding: 4_680_000, called: null },
        { mortgage_id: 3, mortgage_name: '2025-Arjun-GoldRingRuby', reasons: ['months_unpaid', 'loan_to_value'], months_unpaid: 15, loan_to_value: 1.045, outstanding: 8_483_100, called: { id: 1, called_on: '2026-10-19', note: 'Will pay after Diwali', created_at: '2026-10-19T10:00:00' } },
      ],
    },
    {
      customer: { kind: 'customer', id: 6, name: 'Sunita Rao' },
      phone_1: '9860067890',
      phone_2: '9810099999',
      rows: [
        { mortgage_id: 8, mortgage_name: '2026-Sunita-Mangalsutra', reasons: ['months_unpaid'], months_unpaid: 3, loan_to_value: 0.37, outstanding: 3_500_000, called: null },
      ],
    },
  ],
  mortgages: 3,
  total: 2,
  page: 1,
  page_size: 20,
}

const show = () =>
  showPage(fakeServer({ 'GET /api/call-list': listed }), '/call-list', { '/call-list': <CallListPage /> })

/** The summary row of one Customer. */
const customerRow = (name: string) =>
  screen.getAllByRole('row').find((row) => within(row).queryByRole('link', { name }))!

test("each Customer starts collapsed to one summary row: their Mortgages' count, why, owed and calls", async () => {
  show()
  await screen.findByRole('link', { name: 'Arjun Patel' })

  const arjun = customerRow('Arjun Patel')
  const count = within(arjun).getByRole('link', { name: '2 Mortgages' })
  expect(count.getAttribute('href')).toBe('/mortgages?customer=2')
  expect(within(arjun).getByText('15 months unpaid · Loan-to-Value 104.5% · Accrues today')).toBeTruthy()
  expect(within(arjun).getByText('₹1,31,631')).toBeTruthy()
  expect(within(arjun).getByText('1 of 2 called')).toBeTruthy()
  expect(within(customerRow('Sunita Rao')).getByRole('link', { name: '1 Mortgage' })).toBeTruthy()
  expect(screen.queryByRole('link', { name: '2026-Arjun-GoldChain' })).toBeNull()
})

test("expanding a Customer shows their Mortgages, each to mark called", async () => {
  show()
  await screen.findByRole('link', { name: 'Arjun Patel' })

  fireEvent.click(within(customerRow('Arjun Patel')).getByRole('button', { name: 'Show Mortgages of Arjun Patel' }))

  expect(screen.getByRole('link', { name: '2026-Arjun-GoldChain' })).toBeTruthy()
  expect(screen.getByText('Called: Will pay after Diwali')).toBeTruthy()
  expect(screen.queryByRole('link', { name: '2026-Sunita-Mangalsutra' })).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Mark called…' }))
  expect(screen.getByLabelText('Call Note for 2026-Arjun-GoldChain')).toBeTruthy()
})

test('Expand all and Collapse all open and close every Customer at once', async () => {
  show()
  await screen.findByRole('link', { name: 'Arjun Patel' })

  fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
  expect(screen.getByRole('link', { name: '2026-Sunita-Mangalsutra' })).toBeTruthy()
  expect(screen.getByRole('link', { name: '2025-Arjun-GoldRingRuby' })).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
  expect(screen.queryByRole('link', { name: '2025-Arjun-GoldRingRuby' })).toBeNull()
})
