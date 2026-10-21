// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { MortgagesPage } from '../src/pages/MortgagesPage'
import { fakeServer } from './fakeServer'
import { showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** The note saying whose Mortgages are shown, read as one sentence across its link. */
const onlyNote = (name: string) => (_: string, el: Element | null) =>
  el?.tagName === 'SPAN' && el.textContent === `Only ${name}'s Mortgages`

const row = (id: number, name: string) => ({
  id, name, customer: { kind: 'customer', id: 2, name: 'Arjun Patel' }, start_date: '2025-06-15',
  amount_lent: 6_000_000, status: 'active', outstanding_total: 8_483_100,
})

test("from the Call List's count, the Mortgages page shows only that Customer's, and can show everyone's again", async () => {
  const asked: string[] = []
  const server = fakeServer({
    'GET /api/mortgages': (request: Request) => {
      const customer = new URL(request.url).searchParams.get('customer_id')
      asked.push(customer ?? 'everyone')
      const items = customer === '2' ? [row(3, '2025-Arjun-GoldRingRuby')] : [row(3, '2025-Arjun-GoldRingRuby'), { ...row(1, '2025-Meera-GoldChainPendant'), customer: { kind: 'customer', id: 1, name: 'Meera Sharma' } }]
      return { items, total: items.length, page: 1, page_size: 20 }
    },
    'GET /api/customers/2': { id: 2, name: 'Arjun Patel', address: '', phone_1: '9820023456', phone_2: null, photo_url: null, referrer: null, referred: [], shares_phone_with: [] },
  })
  showPage(server, '/mortgages?customer=2', { '/mortgages': <MortgagesPage /> })

  expect(await screen.findByText(onlyNote('Arjun Patel'))).toBeTruthy()
  expect(screen.queryByRole('link', { name: '2025-Meera-GoldChainPendant' })).toBeNull()
  expect(asked).toContain('2')

  fireEvent.click(screen.getByRole('button', { name: 'Show every Customer' }))
  expect(await screen.findByRole('link', { name: '2025-Meera-GoldChainPendant' })).toBeTruthy()
  expect(screen.queryByText(onlyNote('Arjun Patel'))).toBeNull()
})

test("typing a Customer's phone number into the search finds their Mortgages", async () => {
  const asked: string[] = []
  const server = fakeServer({
    'GET /api/mortgages': (request: Request) => {
      const q = new URL(request.url).searchParams.get('q') ?? ''
      asked.push(q)
      const items = q === '98200 23456' ? [row(3, '2025-Arjun-GoldRingRuby')] : []
      return { items, total: items.length, page: 1, page_size: 20 }
    },
  })
  showPage(server, '/mortgages', { '/mortgages': <MortgagesPage /> })

  fireEvent.change(await screen.findByRole('searchbox', { name: 'Filter Mortgages' }), {
    target: { value: '98200 23456' },
  })

  expect(await screen.findByRole('link', { name: '2025-Arjun-GoldRingRuby' })).toBeTruthy()
  expect(asked).toContain('98200 23456')
})
