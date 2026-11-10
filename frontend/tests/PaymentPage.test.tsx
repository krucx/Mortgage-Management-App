// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { Payment, Receipt } from '../src/api'
import { PaymentPage } from '../src/pages/PaymentPage'
import { formatDate } from '../src/format'
import { changePreview, fakeServer } from './fakeServer'
import { mortgage, showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const payment: Payment = {
  id: 9,
  customer: mortgage.customer,
  paid_on: '2026-10-01',
  received_on: null,
  amount: 100_000,
  method: 'cash',
  reference: null,
  voided_at: null,
  void_reason: null,
  allocations: [
    {
      mortgage_id: 7,
      mortgage_name: mortgage.name,
      amount: 100_000,
      discount: 0,
      let_off: null,
      interest_paid: 75_000,
      principal_paid: 25_000,
      discount_interest_paid: 0,
      discount_principal_paid: 0,
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
    'POST /api/payments/9/void-preview': changePreview([]),
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

test('from a recorded Payment, another Payment can be started for the same Customer', async () => {
  const server = fakeServer({
    'GET /api/payments/9': payment,
    'GET /api/payments/9/receipt': receipt,
    'GET /api/payment-methods': [{ method: 'cash', name: 'Cash' }],
  })
  showPage(server, '/payments/9', { '/payments/:id': <PaymentPage /> })

  const link = await screen.findByRole('link', { name: 'Record another Payment for same customer' })
  expect(link.getAttribute('href')).toBe(`/payments/new?customer=${mortgage.customer.id}`)
  expect(link.nextElementSibling).toBe(screen.getByRole('button', { name: 'Void…' }))
})

test('a Grace Payment shows the date it has, the date it was received and what each Mortgage was let off', async () => {
  const grace: Payment = {
    ...payment,
    paid_on: '2026-11-06',
    received_on: '2026-11-08',
    allocations: [{ ...payment.allocations[0], let_off: 42_000 }],
  }
  const server = fakeServer({
    'GET /api/payments/9': grace,
    'GET /api/payments/9/receipt': receipt,
    'GET /api/payment-methods': [{ method: 'cash', name: 'Cash' }],
  })
  showPage(server, '/payments/9', { '/payments/:id': <PaymentPage /> })

  expect(
    await screen.findByText('6 Nov 2026 · received 8 Nov 2026 · Grace, ₹420 let off'),
  ).toBeTruthy()
  const row = screen.getByRole('row', { name: new RegExp(mortgage.name) })
  expect(within(row).getByText('₹420')).toBeTruthy()
})

test('an ordinary Payment shows no Grace', async () => {
  const server = fakeServer({
    'GET /api/payments/9': payment,
    'GET /api/payments/9/receipt': receipt,
    'GET /api/payment-methods': [{ method: 'cash', name: 'Cash' }],
  })
  showPage(server, '/payments/9', { '/payments/:id': <PaymentPage /> })

  expect(await screen.findByText(formatDate(payment.paid_on))).toBeTruthy()
  expect(screen.queryByText(/Grace|let off/i)).toBeNull()
})
