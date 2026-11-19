// @vitest-environment jsdom
// An Advance after saving (ADR 0021): its parts on the Mortgage page, what is held, and
// cancelling an upcoming part; the Payments list's tag and the Customer's total.
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { AdvanceInstalment, Mortgage, PaymentRow } from '../src/api'
import { CustomerPage } from '../src/pages/CustomerPage'
import { MortgagePage } from '../src/pages/MortgagePage'
import { PaymentsPage } from '../src/pages/PaymentsPage'
import { changePreview, fakeServer } from './fakeServer'
import { mortgage, showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const part = (
  id: number,
  on: string,
  number: number,
  fields: Partial<AdvanceInstalment> = {},
): AdvanceInstalment => ({
  id,
  payment_id: 4,
  received_on: '2026-08-20',
  on,
  amount: 75_000,
  number,
  of: 3,
  upcoming: true,
  cancelled_on: null,
  ...fields,
})

const withAdvance: Mortgage = {
  ...mortgage,
  advance_instalments: [
    part(21, '2026-10-10', 1, { upcoming: false }),
    part(22, '2026-11-10', 2),
    part(23, '2026-12-10', 3),
  ],
  advance_held: 150_000,
}

const side = (outstanding: number) => ({
  outstanding,
  points: [],
  term_changes: [],
  closure: null,
})

/** The Mortgage page with an Advance, whose 10 Nov part's cancel is previewed then
 *  made by `cancel`; the Mortgage is then as it returned. */
function showAdvance(cancel: (request: Request) => unknown = () => cancelled) {
  let saved: unknown = null
  const server = fakeServer({
    'GET /api/mortgages/7': () => saved ?? withAdvance,
    'POST /api/mortgages/7/advance-instalments/22/cancel-preview': changePreview([
      {
        mortgage_id: 7,
        mortgage_name: mortgage.name,
        before: side(5_075_000),
        after: side(5_000_000),
        ledger_changes: [],
        advance_warnings: [],
      },
    ]),
    'POST /api/mortgages/7/advance-instalments/22/cancel': (request: Request) => {
      const answer = cancel(request)
      if (!(answer instanceof Response)) saved = answer
      return answer
    },
  })
  showPage(server, '/mortgages/7', { '/mortgages/:id': <MortgagePage /> })
  return server
}

const cancelled: Mortgage = {
  ...withAdvance,
  advance_instalments: [
    part(21, '2026-10-10', 1, { upcoming: false }),
    part(22, '2026-11-10', 2, { upcoming: false, cancelled_on: '2026-10-18' }),
    part(23, '2026-12-10', 3),
  ],
  advance_held: 75_000,
}

test('the Mortgage page shows each part of an Advance and the Advance held', async () => {
  showAdvance()

  expect(await screen.findByText('Advance held')).toBeTruthy()
  expect(screen.getByText('Advance held').nextElementSibling!.textContent).toBe('₹1,500')
  expect(screen.getByRole('link', { name: 'Received 20 Aug 2026' }).getAttribute('href')).toBe(
    '/payments/4',
  )
  expect(screen.getByText(/₹2,250 over 3 months/)).toBeTruthy()
  const row = (on: string) =>
    screen
      .getAllByText(on)
      .find((e) => e.closest('td'))!
      .closest('tr')!
  expect(within(row('10 Oct 2026')).getByText('Applied')).toBeTruthy()
  expect(within(row('10 Oct 2026')).queryByRole('button')).toBeNull()
  expect(within(row('10 Nov 2026')).getByText('Upcoming')).toBeTruthy()
  expect(within(row('10 Nov 2026')).getByRole('button', { name: 'Cancel…' })).toBeTruthy()
})

test('a Mortgage without an Advance shows neither the panel nor the Advance held', async () => {
  showPage(fakeServer({ 'GET /api/mortgages/7': mortgage }), '/mortgages/7', {
    '/mortgages/:id': <MortgagePage />,
  })

  expect(await screen.findByRole('heading', { name: /2026GoldChain/ })).toBeTruthy()
  expect(screen.queryByText('Advance held')).toBeNull()
  expect(screen.queryByRole('heading', { name: 'Advances' })).toBeNull()
})

test('cancelling an upcoming part shows its Preview first, then shows it Cancelled', async () => {
  const server = showAdvance()

  const upcoming = (await screen.findAllByRole('button', { name: 'Cancel…' }))[0]
  fireEvent.click(upcoming)
  const dialog = await screen.findByRole('dialog', {
    name: 'Cancel the Advance Instalment due 10 Nov 2026?',
  })
  expect(within(dialog).getByText(/Its ₹750 is applied today/)).toBeTruthy()
  expect(await within(dialog).findByText('₹50,000')).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel this Advance Instalment' }))

  expect(await screen.findByText('Cancelled on 18 Oct 2026')).toBeTruthy()
  expect(screen.getByText('Advance held').nextElementSibling!.textContent).toBe('₹750')
  expect(server.requests).toContain('POST /api/mortgages/7/advance-instalments/22/cancel-preview')
  expect(server.requests).toContain('POST /api/mortgages/7/advance-instalments/22/cancel')
})

test('keeping the part cancels nothing', async () => {
  const server = showAdvance()

  fireEvent.click((await screen.findAllByRole('button', { name: 'Cancel…' }))[0])
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Keep it' }),
  )

  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(server.requests).not.toContain('POST /api/mortgages/7/advance-instalments/22/cancel')
})

test('a refused cancel says why', async () => {
  showAdvance(() =>
    Response.json({ detail: 'This Advance Instalment has been applied' }, { status: 409 }),
  )

  fireEvent.click((await screen.findAllByRole('button', { name: 'Cancel…' }))[0])
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel this Advance Instalment' }))

  expect(await screen.findByText('This Advance Instalment has been applied')).toBeTruthy()
})

test('the Ledger names a cancelled part, applied on the day it was cancelled', async () => {
  const step = {
    on: '2026-10-18',
    event: 'payment' as const,
    amount: 75_000,
    principal: 5_000_000,
    unpaid_interest: 0,
    charged_on: 0,
    interest_to_date_days: 0,
    paid_ahead: 0,
    interest_paid: 75_000,
    principal_paid: 0,
    discount: 0,
    discount_interest_paid: 0,
    discount_principal_paid: 0,
    payment_id: 4,
    terms: null,
    instalment_id: 22,
  }
  showPage(
    fakeServer({ 'GET /api/mortgages/7': { ...cancelled, ledger: [step] } }),
    '/mortgages/7',
    { '/mortgages/:id': <MortgagePage /> },
  )

  expect(
    await screen.findByText(/^Advance Instalment 2 of 3, cancelled \(due 10 Nov 2026\):/),
  ).toBeTruthy()
  // Only the upcoming 10 Dec part is listed after the Ledger, in grey.
  const upcoming = document.querySelectorAll('tr.ledger-upcoming')
  expect([...upcoming].map((row) => row.textContent)).toEqual([
    expect.stringContaining('Advance Instalment 3 of 3'),
  ])
})

test('the Payments list tags a Payment with an Advance by its upcoming parts', async () => {
  const row = (id: number, advance: PaymentRow['advance']): PaymentRow => ({
    id,
    paid_on: '2026-09-20',
    received_on: null,
    customer: { kind: 'customer', id: 3, name: 'Asha Rao' },
    amount: 300_000,
    method: 'cash',
    reference: null,
    mortgages: [{ id: 7, name: `2026GoldChain${id}` }],
    voided: false,
    advance,
  })
  const items = [row(1, { upcoming: 2, of: 3 }), row(2, null)]
  showPage(
    fakeServer({ 'GET /api/payments': { items, total: 2, page: 1, page_size: 20 } }),
    '/payments',
    { '/payments': <PaymentsPage /> },
  )

  const rowOf = async (id: number) =>
    (await screen.findByRole('link', { name: `2026GoldChain${id}` })).closest('tr')!
  expect(within(await rowOf(1)).getByText('Advance · 2 of 3 upcoming')).toBeTruthy()
  expect(within(await rowOf(2)).queryByText(/Advance/)).toBeNull()
})

test('the Customer page shows the Advance held across their Mortgages', async () => {
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
    advance_held: 150_000,
  }
  const empty = { items: [], total: 0, page: 1, page_size: 20 }
  showPage(
    fakeServer({
      'GET /api/customers/3': asha,
      'GET /api/customers/3/favours': empty,
      'GET /api/customers/3/history': empty,
      'GET /api/mortgages': empty,
    }),
    '/customers/3',
    { '/customers/:id': <CustomerPage /> },
  )

  expect((await screen.findByText('Advance held')).nextElementSibling!.textContent).toBe('₹1,500')
})
