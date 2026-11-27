// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import type { Receipt } from '../src/api'
import { ReceiptPage } from '../src/pages/ReceiptPage'
import { typedFakeServer as fakeServer } from './typedFakeServer'
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
  advance_due_on: null,
  total_owed: 0,
  phones: [],
  text: 'Received ₹1,000',
}

test('from the printable Receipt, another Payment can be started for the same Customer, off the printout', async () => {
  const server = fakeServer({ 'GET /api/payments/{payment_id}/receipt': receipt })
  showPage(server, '/payments/9/receipt', { '/payments/:id/receipt': <ReceiptPage /> })

  const link = await screen.findByRole('link', { name: 'Record another Payment for same customer' })
  expect(link.getAttribute('href')).toBe(`/payments/new?customer=${mortgage.customer.id}`)
  expect(link.closest('.no-print')).not.toBeNull()
})

test("a Grace Payment's Receipt shows when it was received and what each Mortgage was let off", async () => {
  const line = {
    discount: 0,
    discount_interest_paid: 0,
    discount_principal_paid: 0,
    redeemed: false,
    principal_paid: 0,
    advance_parts: [],
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
  const server = fakeServer({ 'GET /api/payments/{payment_id}/receipt': graced })
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
  const server = fakeServer({ 'GET /api/payments/{payment_id}/receipt': receipt })
  showPage(server, '/payments/9/receipt', { '/payments/:id/receipt': <ReceiptPage /> })

  expect(await screen.findByText('1 Oct 2026')).not.toBeNull()
  expect(screen.queryByText(/Grace/)).toBeNull()
})

test('the printed Receipt tells two Mortgages described alike apart by start date and shows no id', async () => {
  const line = {
    discount: 0,
    discount_interest_paid: 0,
    discount_principal_paid: 0,
    redeemed: false,
    principal_paid: 0,
    let_off: 0,
    paid: 100_000,
    interest_paid: 100_000,
    owed_after: 9_000_000,
    advance_parts: [],
  }
  const twins: Receipt = {
    ...receipt,
    payment_id: 9191,
    amount: 200_000,
    lines: [
      { ...line, mortgage_id: 4242, description: 'Silver anklet (from 14 Jan 2026)' },
      { ...line, mortgage_id: 4343, description: 'Silver anklet (from 14 Feb 2026)' },
    ],
    total_owed: 18_000_000,
  }
  const server = fakeServer({ 'GET /api/payments/{payment_id}/receipt': twins })
  showPage(server, '/payments/9191/receipt', { '/payments/:id/receipt': <ReceiptPage /> })

  expect(await screen.findByText('Silver anklet (from 14 Jan 2026)')).not.toBeNull()
  expect(screen.getByText('Silver anklet (from 14 Feb 2026)')).not.toBeNull()
  const printed = document.body.textContent ?? ''
  expect(printed).toContain(mortgage.customer.name)
  for (const id of ['4242', '4343', '9191']) expect(printed).not.toContain(id)
})

const chainLine = {
  mortgage_id: 1,
  description: 'Gold chain',
  discount: 0,
  discount_interest_paid: 0,
  discount_principal_paid: 0,
  redeemed: false,
  let_off: 0,
  principal_paid: 0,
}

test("a Receipt with an Advance shows what was paid now and each part's date and amount", async () => {
  const advanced: Receipt = {
    ...receipt,
    amount: 1_800_000,
    lines: [
      {
        ...chainLine,
        paid: 900_000,
        interest_paid: 900_000,
        owed_after: 10_300_000,
        advance_parts: [
          { on: '2026-05-14', amount: 300_000 },
          { on: '2026-06-14', amount: 300_000 },
          { on: '2026-07-14', amount: 300_000 },
        ],
      },
    ],
    total_owed: 10_300_000,
  }
  const server = fakeServer({ 'GET /api/payments/{payment_id}/receipt': advanced })
  showPage(server, '/payments/9/receipt', { '/payments/:id/receipt': <ReceiptPage /> })

  expect(await screen.findByRole('columnheader', { name: 'Paid now' })).not.toBeNull()
  expect(screen.getByText('₹3,000 on 14 May 2026')).not.toBeNull()
  expect(screen.getByText('₹3,000 on 14 Jun 2026')).not.toBeNull()
  expect(screen.getByText('₹3,000 on 14 Jul 2026')).not.toBeNull()
})

test("a Receipt's Paid now total leaves out what is held as an Advance", async () => {
  const advanced: Receipt = {
    ...receipt,
    amount: 1_900_000,
    lines: [
      {
        ...chainLine,
        paid: 900_000,
        interest_paid: 900_000,
        owed_after: 10_300_000,
        advance_parts: [{ on: '2026-05-14', amount: 900_000 }],
      },
      {
        ...chainLine,
        mortgage_id: 2,
        description: 'Gold ring',
        paid: 100_000,
        interest_paid: 100_000,
        owed_after: 5_000_000,
        advance_parts: [],
      },
    ],
    total_owed: 15_300_000,
  }
  const server = fakeServer({ 'GET /api/payments/{payment_id}/receipt': advanced })
  showPage(server, '/payments/9/receipt', { '/payments/:id/receipt': <ReceiptPage /> })

  const total = await screen.findByRole('rowheader', { name: 'Total' })
  expect(total.nextElementSibling!.textContent).toBe('₹10,000')
})

test('a Receipt without an Advance has no Advance column', async () => {
  const server = fakeServer({ 'GET /api/payments/{payment_id}/receipt': receipt })
  showPage(server, '/payments/9/receipt', { '/payments/:id/receipt': <ReceiptPage /> })

  expect(await screen.findByRole('columnheader', { name: 'Paid' })).not.toBeNull()
  expect(screen.queryByRole('columnheader', { name: 'Advance' })).toBeNull()
})

test("a cancelled part's Receipt says what it paid on the day it was applied", async () => {
  const applied: Receipt = {
    ...receipt,
    paid_on: '2026-05-20',
    amount: 300_000,
    advance_due_on: '2026-06-14',
    lines: [
      {
        ...chainLine,
        paid: 300_000,
        interest_paid: 300_000,
        owed_after: 10_000_000,
        advance_parts: [],
      },
    ],
    total_owed: 10_000_000,
  }
  const server = fakeServer({ 'GET /api/payments/{payment_id}/advance-instalments/{instalment_id}/receipt': applied })
  showPage(server, '/payments/9/advance-instalments/22/receipt', {
    '/payments/:id/advance-instalments/:instalment/receipt': <ReceiptPage />,
  })

  expect(await screen.findByRole('heading', { name: 'Advance applied' })).not.toBeNull()
  expect(
    screen.getByText('Applied 20 May 2026, from the Advance part due 14 Jun 2026'),
  ).not.toBeNull()
})
