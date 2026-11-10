// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { PaymentRow } from '../src/api'
import { PaymentsPage } from '../src/pages/PaymentsPage'
import { fakeServer } from './fakeServer'
import { showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('the Payments filter has a name', async () => {
  showPage(
    fakeServer({ 'GET /api/payments': { items: [], total: 0, page: 1, page_size: 20 } }),
    '/payments',
    { '/payments': <PaymentsPage /> },
  )

  expect(await screen.findByRole('searchbox', { name: 'Filter Payments' })).toBeTruthy()
})

test('Grace Payments are marked; a Voided one shows as Voided instead', async () => {
  const row = (id: number, receivedOn: string | null, voided: boolean): PaymentRow => ({
    id,
    paid_on: '2026-11-06',
    received_on: receivedOn,
    customer: { kind: 'customer', id: 3, name: 'Asha Rao' },
    amount: 100_000,
    method: 'cash',
    reference: null,
    mortgages: [{ id: 7, name: `2026GoldChain${id}` }],
    voided,
  })
  const items = [row(1, '2026-11-08', false), row(2, null, false), row(3, '2026-11-08', true)]
  showPage(
    fakeServer({ 'GET /api/payments': { items, total: 3, page: 1, page_size: 20 } }),
    '/payments',
    { '/payments': <PaymentsPage /> },
  )

  const rowOf = async (id: number) =>
    (await screen.findByRole('link', { name: `2026GoldChain${id}` })).closest('tr')!
  // On the amount, as Voided is.
  const grace = within(await rowOf(1)).getByText('Grace')
  expect(grace.closest('td')!.className).toBe('num')
  expect(grace.getAttribute('title')).toBe('Received 8 Nov 2026')
  expect(within(await rowOf(2)).queryByText('Grace')).toBeNull()
  expect(within(await rowOf(3)).queryByText('Grace')).toBeNull()
  expect(within(await rowOf(3)).getByText('voided')).toBeTruthy()
})
