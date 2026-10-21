// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { Payment, Receipt } from '../src/api'
import { PaymentPage } from '../src/pages/PaymentPage'
import { fakeServer } from './fakeServer'
import { mortgage, showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const payment: Payment = {
  id: 9,
  customer: mortgage.customer,
  paid_on: '2026-10-01',
  amount: 100_000,
  method: 'cash',
  reference: null,
  voided_at: null,
  void_reason: null,
  ready_to_redeem: [],
  allocations: [
    {
      mortgage_id: 7,
      mortgage_name: mortgage.name,
      amount: 100_000,
      interest_paid: 75_000,
      principal_paid: 25_000,
    },
  ],
}

const receipt: Receipt = {
  payment_id: 9,
  customer: mortgage.customer,
  paid_on: payment.paid_on,
  amount: payment.amount,
  method: 'cash',
  reference: null,
  lines: [],
  total_owed: 0,
  phones: [],
  text: 'Received ₹1,000',
}

test('after a Void, the Payment shows as voided and its Receipt, which no longer exists, is not asked for', async () => {
  let voided = false
  const server = fakeServer({
    'GET /api/payments/9': () => (voided ? voidedPayment : payment),
    'GET /api/payments/9/receipt': () =>
      voided ? Response.json({ detail: 'Voided' }, { status: 409 }) : receipt,
    'POST /api/payments/9/void-preview': [],
    'POST /api/payments/9/void': () => {
      voided = true
      return voidedPayment
    },
    'GET /api/payment-methods': [{ method: 'cash', name: 'Cash' }],
  })
  const voidedPayment = { ...payment, voided_at: '2026-10-18T10:00:00', void_reason: 'Typo' }
  showPage(server, '/payments/9', { '/payments/:id': <PaymentPage /> })

  await screen.findByText('Received ₹1,000')
  fireEvent.click(screen.getByRole('button', { name: 'Void…' }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Typo' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Void Payment' }))

  expect(await screen.findByText('voided')).toBeTruthy()
  await new Promise((settle) => setTimeout(settle, 50))
  const afterVoid = server.requests.slice(server.requests.indexOf('POST /api/payments/9/void'))
  expect(afterVoid).not.toContain('GET /api/payments/9/receipt')
})
