// @vitest-environment jsdom
// Favours Given on the Customer page: every Grace, Discount and Waived Amount still
// standing.
import { cleanup, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { CustomerPage } from '../src/pages/CustomerPage'
import { fakeServer } from './fakeServer'
import { showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const asha = {
  id: 3,
  name: 'Asha Rao',
  address: '',
  phone_1: '9000000001',
  phone_2: null,
  photo_url: null,
  referrer: null,
  referred: [],
  shares_phone_with: [],
  email: null,
  aadhaar_last4: null,
  pan: null,
  aadhaar_photo_url: null,
  pan_photo_url: null,
}

function customerPage(favours: unknown) {
  const server = fakeServer({
    'GET /api/customers/3': asha,
    'GET /api/customers/3/favours': favours,
    'GET /api/customers/3/history': [],
    'GET /api/mortgages': { items: [], total: 0, page: 1, pages: 1 },
  })
  showPage(server, '/customers/3', { '/customers/:id': <CustomerPage /> })
  return server
}

test('the Customer page lists each favour newest first, by Mortgage description, with the total', async () => {
  customerPage({
    favours: [
      {
        on: '2026-04-20',
        received_on: null,
        mortgage: { id: 7, description: 'Gold chain' },
        kind: 'waived',
        amount: 50_000,
      },
      {
        on: '2026-03-15',
        received_on: null,
        mortgage: { id: 8, description: 'Gold ring' },
        kind: 'discount',
        amount: 100_000,
      },
    ],
    total: 150_000,
  })

  const table = await screen.findByRole('table', { name: 'Favours Given' })
  const rows = within(table)
    .getAllByRole('row')
    .map((row) => row.textContent)
  expect(rows).toEqual([
    'DateMortgageKindAmount let off',
    '20 Apr 2026Gold chainWaived off₹500',
    '15 Mar 2026Gold ringDiscount₹1,000',
    'Total₹1,500',
  ])
  expect(within(table).getByRole('link', { name: 'Gold chain' }).getAttribute('href')).toBe(
    '/mortgages/7',
  )
  expect(within(table).getByRole('link', { name: 'Gold ring' }).getAttribute('href')).toBe(
    '/mortgages/8',
  )
})

test('a Grace shows the date it was received after its date', async () => {
  customerPage({
    favours: [
      {
        on: '2026-11-06',
        received_on: '2026-11-08',
        mortgage: { id: 7, description: 'Gold chain' },
        kind: 'grace',
        amount: 42_000,
      },
    ],
    total: 42_000,
  })

  const table = await screen.findByRole('table', { name: 'Favours Given' })
  expect(within(table).getAllByRole('row')[1].textContent).toBe(
    '6 Nov 2026 (received 8 Nov)Gold chainGrace₹420',
  )
})

test('the section is hidden when the Customer has no favours', async () => {
  const server = customerPage({ favours: [], total: 0 })

  await screen.findByRole('heading', { name: 'Asha Rao' })
  await vi.waitFor(() => expect(server.requests).toContain('GET /api/customers/3/favours'))
  expect(screen.queryByRole('heading', { name: 'Favours Given' })).toBeNull()
  expect(screen.queryByRole('table', { name: 'Favours Given' })).toBeNull()
})

test('a failure to load them says so under the heading', async () => {
  customerPage(Response.json({ detail: 'Something went wrong' }, { status: 500 }))

  const heading = await screen.findByRole('heading', { name: 'Favours Given' })
  expect(heading.nextElementSibling?.textContent).toBe('Something went wrong')
})
