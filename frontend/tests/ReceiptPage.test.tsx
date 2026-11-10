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
