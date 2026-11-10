// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import type { Receipt } from '../src/api'
import { ReceiptPage } from '../src/pages/ReceiptPage'
import { fakeServer } from './fakeServer'
import { mortgage, showPage } from './showPage'

afterEach(cleanup)

const receipt: Receipt = {
  payment_id: 9,
  customer: mortgage.customer,
  paid_on: '2026-10-01',
  received_on: null,
  amount: 100_000,
  method: 'cash',
  reference: null,
  lines: [],
  total_owed: 0,
  phones: [],
  text: 'Received ₹1,000',
}

test('from the printable Receipt, another Payment can be started for the same Customer, off the printout', async () => {
  const server = fakeServer({ 'GET /api/payments/9/receipt': receipt })
  showPage(server, '/payments/9/receipt', { '/payments/:id/receipt': <ReceiptPage /> })

  const link = await screen.findByRole('link', { name: 'Record another Payment for same customer' })
  expect(link.getAttribute('href')).toBe(`/payments/new?customer=${mortgage.customer.id}`)
  expect(link.closest('.no-print')).not.toBeNull()
})

test("a Grace Payment's Receipt shows when it was received and what each piece was let off", async () => {
  const line = {
    discount: 0,
    discount_interest_paid: 0,
    discount_principal_paid: 0,
    redeemed: false,
    principal_paid: 0,
  }
  const graced: Receipt = {
    ...receipt,
    paid_on: '2026-04-13',
    received_on: '2026-04-16',
    amount: 300_000,
    lines: [
      {
        ...line,
        mortgage_id: 1,
        description: 'Gold chain',
        paid: 200_000,
        interest_paid: 200_000,
        let_off: 33_000,
        owed_after: 9_000_000,
      },
      {
        ...line,
        mortgage_id: 2,
        description: 'Bangle',
        paid: 100_000,
        interest_paid: 100_000,
        let_off: 0,
        owed_after: 4_000_000,
      },
    ],
    total_owed: 13_000_000,
  }
  const server = fakeServer({ 'GET /api/payments/9/receipt': graced })
  showPage(server, '/payments/9/receipt', { '/payments/:id/receipt': <ReceiptPage /> })

  expect(
    await screen.findByText('Received 16 Apr 2026, counted as paid on 13 Apr 2026 (Grace)'),
  ).not.toBeNull()
  const letOff = screen
    .getAllByRole('columnheader')
    .map((th) => th.textContent)
    .indexOf('Let off (Grace)')
  const column = screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.children[letOff]?.textContent)
  expect(column).toEqual(['₹330', '₹0', '₹330'])
})

test("an ordinary Payment's Receipt has no Grace", async () => {
  const server = fakeServer({ 'GET /api/payments/9/receipt': receipt })
  showPage(server, '/payments/9/receipt', { '/payments/:id/receipt': <ReceiptPage /> })

  expect(await screen.findByText('1 Oct 2026')).not.toBeNull()
  expect(screen.queryByText(/Grace/)).toBeNull()
})
