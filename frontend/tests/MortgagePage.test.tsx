// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { MortgagePage } from '../src/pages/MortgagePage'
import ledger from '../src/pages/mortgage/Ledger.module.css'
import type { LedgerStep } from '../src/api'
import { customerHistoryQuery, mortgageHistoryQuery } from '../src/requests'
import { changePreview, fakeServer, type FakeServer } from './fakeServer'
import { expectWholeRupeeSteps } from './rupeeField'
import { mortgage, showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const showMortgagePage = (server: FakeServer) =>
  showPage(server, '/mortgages/7', { '/mortgages/:id': <MortgagePage /> })

test('the Mortgage page shows what the Mortgage owes', async () => {
  showMortgagePage(fakeServer({ 'GET /api/mortgages/7': mortgage }))

  expect(screen.getByText('Loading…')).toBeTruthy()
  expect(await screen.findByRole('heading', { name: /2026GoldChain/ })).toBeTruthy()
  expect(screen.getByText('₹50,750')).toBeTruthy()
})

test('weights are written in grams', async () => {
  showMortgagePage(fakeServer({ 'GET /api/mortgages/7': mortgage }))

  expect(await screen.findByText('20 grams gross, 18 grams net, 22K')).toBeTruthy()
})

test('how the Mortgage was lent is shown, or a dash if it was made before that was asked', async () => {
  const methods = {
    'GET /api/payment-methods': [
      { method: 'cash', name: 'Cash' },
      { method: 'upi', name: 'UPI' },
    ],
  }
  showMortgagePage(fakeServer({ 'GET /api/mortgages/7': mortgage, ...methods }))
  const lent = (await screen.findByText('Lent Through')).nextElementSibling!
  await vi.waitFor(() => expect(lent.textContent).toBe('UPI'))
  cleanup()

  showMortgagePage(
    fakeServer({ 'GET /api/mortgages/7': { ...mortgage, lent_through: null }, ...methods }),
  )
  expect((await screen.findByText('Lent Through')).nextElementSibling!.textContent).toBe('—')
})

test('setting how a Mortgage was lent shows in its History by name', async () => {
  const entry = {
    id: 1,
    at: '2026-10-18T10:00:00',
    entity: 'mortgage',
    entity_id: 7,
    action: 'edited',
    field: 'lent_through',
    old_value: null,
    new_value: 'bank_transfer',
    note: null,
    mortgage_name: mortgage.name,
  }
  showMortgagePage(
    fakeServer({
      'GET /api/mortgages/7': mortgage,
      'GET /api/mortgages/7/history': { items: [[entry]], total: 1, page: 1, page_size: 20 },
      'GET /api/payment-methods': [{ method: 'bank_transfer', name: 'Bank transfer' }],
    }),
  )

  const line = (await screen.findByText(/Lent Through/, { selector: 'span' })).textContent
  await vi.waitFor(() =>
    expect(screen.getByText(/Lent Through/, { selector: 'span' }).textContent).toContain(
      'Bank transfer',
    ),
  )
  expect(line).toContain('(none)')
})

test('History shows the latest changes, and the complete history a page of changes at a time', async () => {
  // Change n is an edit of the Jewellery (to "Jewellery n") on day n; a page holds 20 changes, newest first.
  const change = (n: number) => [
    {
      id: n,
      at: `2026-10-${String(n).padStart(2, '0')}T10:00:00`,
      entity: 'mortgage',
      entity_id: 7,
      action: 'edited',
      field: 'description',
      old_value: null,
      new_value: `Jewellery ${n}`,
      note: null,
      mortgage_name: mortgage.name,
    },
  ]
  const server = fakeServer({
    'GET /api/mortgages/7': mortgage,
    'GET /api/mortgages/7/history': (request: Request) => {
      const page = Number(new URL(request.url).searchParams.get('page'))
      const newest = page === 1 ? 23 : 3
      const count = page === 1 ? 20 : 3
      return {
        items: Array.from({ length: count }, (_, i) => change(newest - i)),
        total: 23,
        page,
        page_size: 20,
      }
    },
  })
  showMortgagePage(server)

  expect(await screen.findByText('Showing the latest 5 of 23 changes.')).toBeTruthy()
  expect(screen.getByText(/Jewellery 19/)).toBeTruthy()
  expect(screen.queryByText(/Jewellery 18/)).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Show complete history' }))
  const popup = within(await screen.findByRole('dialog'))
  expect(popup.getByText('Showing 1–20 of 23')).toBeTruthy()
  expect(popup.getByText(/Jewellery 4/)).toBeTruthy()

  fireEvent.click(popup.getByRole('button', { name: 'Next' }))

  expect(await popup.findByText(/Jewellery 1$/)).toBeTruthy()
  expect(popup.getByText('Showing 21–23 of 23')).toBeTruthy()
  expect(popup.queryByText(/Jewellery 23/)).toBeNull()
})

test("an Active pro-rata Mortgage's Ledger ends with its Interest to Date, growing daily", async () => {
  const toDate = {
    on: '2026-10-18',
    event: 'interest_to_date' as const,
    amount: 22_500,
    principal: 5_000_000,
    unpaid_interest: 75_000,
    charged_on: 5_000_000,
    interest_to_date_days: 9,
    part_month_rule: 'pro_rata' as const,
    interest_paid: 0,
    principal_paid: 0,
    payment_id: null,
    terms: null,
  }
  showMortgagePage(fakeServer({ 'GET /api/mortgages/7': { ...mortgage, ledger: [toDate] } }))

  expect(
    await screen.findByText(
      'Interest to Date: 9 days of this month, today included (Pro-rata by day) on ₹50,000, ' +
        'to date: grows each day until the next Accrual Date',
    ),
  ).toBeTruthy()
})

test("the Interest to Date shows the Part-Month Rule of its month, not the Mortgage's current one", async () => {
  const toDate = {
    on: '2026-10-18',
    event: 'interest_to_date' as const,
    amount: 50_000,
    principal: 5_000_000,
    unpaid_interest: 0,
    charged_on: 5_000_000,
    interest_to_date_days: 9,
    part_month_rule: 'full_month' as const, // the Mortgage is now Pro-rata
    interest_paid: 0,
    principal_paid: 0,
    payment_id: null,
    terms: null,
  }
  const now = { ...mortgage.terms, part_month_rule: 'pro_rata' as const }
  showMortgagePage(
    fakeServer({ 'GET /api/mortgages/7': { ...mortgage, terms: now, ledger: [toDate] } }),
  )

  expect(
    await screen.findByText(
      'Interest to Date: 9 days of this month, today included (Full month) on ₹50,000, ' +
        'to date: until the next Accrual Date',
    ),
  ).toBeTruthy()
})

test('the Ledger says how much of a month was paid ahead', async () => {
  const step = {
    on: '2026-10-18',
    event: 'interest' as const,
    amount: 75_000,
    principal: 5_000_000,
    unpaid_interest: 30_000,
    charged_on: 5_000_000,
    monthly_rate_bps: 150,
    interest_to_date_days: 0,
    paid_ahead: 45_000,
    interest_paid: 0,
    principal_paid: 0,
    payment_id: null,
    terms: null,
  }
  showMortgagePage(fakeServer({ 'GET /api/mortgages/7': { ...mortgage, ledger: [step] } }))

  expect(await screen.findByText('Interest: 1.5% of ₹50,000, ₹450 of it paid ahead')).toBeTruthy()
})

test('an Interest step shows the rate charged then, not the Mortgage current rate', async () => {
  const step = {
    on: '2026-10-18',
    event: 'interest' as const,
    amount: 100_000,
    principal: 5_000_000,
    unpaid_interest: 100_000,
    charged_on: 5_000_000,
    monthly_rate_bps: 200, // the Mortgage's rate is now 1.5%
    interest_to_date_days: 0,
    paid_ahead: 0,
    interest_paid: 0,
    principal_paid: 0,
    payment_id: null,
    terms: null,
  }
  showMortgagePage(fakeServer({ 'GET /api/mortgages/7': { ...mortgage, ledger: [step] } }))

  expect(await screen.findByText('Interest: 2% of ₹50,000')).toBeTruthy()
})

test('deleting a photo asks first, then shows the Mortgage without it', async () => {
  let stored = { ...mortgage, photos: [{ id: 5, url: '/api/photos/mortgage-7-a.jpg' }] }
  const server = fakeServer({
    'GET /api/mortgages/7': () => stored,
    'DELETE /api/mortgages/7/photos/5': () => (stored = mortgage),
  })
  showMortgagePage(server)

  fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

  expect(await screen.findByText('No photos yet.')).toBeTruthy()
  expect(server.requests).toContain('DELETE /api/mortgages/7/photos/5')
})

test("adding a photo shows it, and makes the Mortgage's and its Customer's History stale", async () => {
  let stored = mortgage
  const server = fakeServer({
    'GET /api/mortgages/7': () => stored,
    'POST /api/mortgages/7/photos': () =>
      (stored = { ...mortgage, photos: [{ id: 5, url: '/api/photos/mortgage-7-a.jpg' }] }),
  })
  const state = showMortgagePage(server)
  const customerHistory = customerHistoryQuery(state.client, 3, 1).queryKey
  state.queryClient.setQueryData(customerHistory, { items: [], total: 0, page: 1, page_size: 20 })

  fireEvent.change(await screen.findByLabelText('Upload photos'), {
    target: { files: [new File(['x'], 'ring.jpg', { type: 'image/jpeg' })] },
  })

  expect(await screen.findByRole('img', { name: 'Photo 1' })).toBeTruthy()
  expect(state.queryClient.getQueryState(customerHistory)?.isInvalidated).toBe(true)
})

test('a photo over 20 MB is refused in plain words, and not sent', async () => {
  const server = fakeServer({ 'GET /api/mortgages/7': mortgage })
  showMortgagePage(server)

  fireEvent.change(await screen.findByLabelText('Upload photos'), {
    target: {
      files: [new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'ring.jpg', { type: 'image/jpeg' })],
    },
  })

  expect(await screen.findByText('The photo is too large (over 20 MB).')).toBeTruthy()
  expect(server.requests).not.toContain('POST /api/mortgages/7/photos')
})

test("the backend's refusal of a photo too large is shown as it says it", async () => {
  const server = fakeServer({
    'GET /api/mortgages/7': mortgage,
    'POST /api/mortgages/7/photos': Response.json(
      { detail: 'The file is too large (over 20 MB).' },
      { status: 413 },
    ),
  })
  showMortgagePage(server)

  fireEvent.change(await screen.findByLabelText('Upload photos'), {
    target: { files: [new File(['x'], 'ring.jpg', { type: 'image/jpeg' })] },
  })

  expect(await screen.findByText('The file is too large (over 20 MB).')).toBeTruthy()
})

// What the Mortgage owes on 20 Apr 2026, whatever the date asked.
const quote = {
  on: '2026-04-20',
  principal: 5_000_000,
  unpaid_interest: 75_000,
  interest_to_date_days: 6,
  part_month_rule: 'full_month' as const,
  interest_to_date: 0,
  total: 5_075_000,
  advance_held: 0,
  to_pay: 5_075_000,
}
const closure = (fields: Record<string, unknown>) => ({
  on: '2026-04-20',
  outstanding: quote.total,
  advance_held: 0,
  payment_id: null,
  payment_amount: null,
  waived_amount: null,
  recovered_amount: null,
  profit_loss: null,
  note: null,
  ...fields,
})
const side = (closure: unknown) => ({ outstanding: 0, points: [], term_changes: [], closure })
/** A closing Preview of Mortgage 7, its Closure worked out from what was sent; or the
 *  backend's refusal. */
const closingPreview =
  (closureOf: (body: Record<string, unknown>) => unknown) => async (request: Request) => {
    const body = (await request.json()) as Record<string, unknown>
    const made = closureOf(body)
    if (typeof made === 'string') return Response.json({ detail: made }, { status: 422 })
    return changePreview([
      {
        mortgage_id: 7,
        mortgage_name: mortgage.name,
        before: side(null),
        after: side(made),
        ledger_changes: [],
        advance_warnings: [],
      },
    ])
  }
const paidOf = (body: Record<string, unknown>) =>
  (body.mortgages as { amount_paid: number }[])[0].amount_paid
const waivePreview = closingPreview((body) =>
  paidOf(body) >= quote.total
    ? `${mortgage.name}: ₹50,750 covers the ₹50,750 owed: Redeem it instead`
    : closure({
        kind: 'waived',
        payment_amount: paidOf(body),
        waived_amount: quote.total - paidOf(body),
      }),
)

test('waiving off shows what is let off, asks first, then shows the Waiver', async () => {
  const waived = {
    ...mortgage,
    status: 'waived' as const,
    closure: closure({
      kind: 'waived' as const,
      payment_id: 12,
      payment_amount: 5_000_000,
      waived_amount: 75_000,
      note: 'Small balance',
    }),
  }
  let body: unknown = null
  const server = fakeServer({
    'GET /api/mortgages/7': () => (body ? waived : mortgage),
    'GET /api/mortgages/7/outstanding-on-closure': quote,
    'POST /api/closures/waive-preview': waivePreview,
    'POST /api/closures/waive': async (request: Request) => {
      body = await request.json()
      return [waived]
    },
  })
  showMortgagePage(server)

  fireEvent.click(await screen.findByRole('button', { name: 'Waive off…' }))
  fireEvent.change(await screen.findByLabelText(/Received now/), { target: { value: '50000' } })
  // What is let off comes from the Preview.
  expect(await screen.findByText('Waived off: ₹750', {}, { timeout: 2000 })).toBeTruthy()
  // A Mortgage being Waived has no interest to come, so takes no Advance (ADR 0021).
  expect(screen.queryByLabelText(/Advance/)).toBeNull()
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Small balance' } })
  const submit = await screen.findByRole('button', { name: 'Waive off ₹750' })
  await vi.waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(submit)
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm Waiver' }))

  expect(await screen.findByText(/Waived off on/)).toBeTruthy()
  expect(body).toMatchObject({
    note: 'Small balance',
    mortgages: [{ mortgage_id: 7, amount_paid: 5_000_000 }],
  })
  expect(server.requests).not.toContain('POST /api/mortgages/7/waive')
})

test('a Waived Mortgage shows its final Payment and what was let off', async () => {
  const waived = {
    ...mortgage,
    status: 'waived' as const,
    closure: {
      kind: 'waived' as const,
      on: '2026-04-20',
      outstanding: 5_075_000,
      payment_id: 12,
      payment_amount: 5_000_000,
      waived_amount: 75_000,
      recovered_amount: null,
      profit_loss: null,
      note: 'Small balance',
    },
  }
  showMortgagePage(fakeServer({ 'GET /api/mortgages/7': waived }))

  const paid = await screen.findByRole('link', { name: '₹50,000 (receipt)' })
  expect(paid.getAttribute('href')).toBe('/payments/12')
  const owed = screen.getByText('Outstanding on the Closure date').closest('div')!
  expect(within(owed).getByText('₹50,750')).toBeTruthy()
  expect(screen.queryByText(/Redemption Amount/)).toBeNull()
})

test('a Redeemed Mortgage gives the Outstanding it was Redeemed for', async () => {
  const redeemed = {
    ...mortgage,
    status: 'redeemed' as const,
    closure: closure({ kind: 'redeemed' as const, payment_id: 12, payment_amount: 5_075_000 }),
  }
  showMortgagePage(fakeServer({ 'GET /api/mortgages/7': redeemed }))

  expect(
    await screen.findByText(
      (_, el) =>
        el?.textContent ===
        'Redeemed on 20 Apr 2026, paying its Outstanding of ₹50,750. Final Payment (receipt)',
    ),
  ).toBeTruthy()
})

test('the Projection shows one Outstanding per date, the Interest to Date included', async () => {
  const point = (months: number, on: string, owed: number) => ({
    months,
    on,
    principal: 5_000_000,
    unpaid_interest: owed - 5_000_000,
    outstanding: owed + 22_500,
    loan_to_value: null,
  })
  showMortgagePage(
    fakeServer({
      'GET /api/mortgages/7': mortgage,
      'GET /api/mortgages/7/projection': {
        as_of: '2026-04-20',
        collateral_value: null,
        monthly_payment: null,
        baseline: {
          points: [
            point(3, '2026-07-20', 5_525_000),
            point(6, '2026-10-20', 5_975_000),
            point(12, '2027-04-20', 6_875_000),
          ],
          term_changes: [],
          paid_off_on: null,
        },
        what_if: null,
      },
    }),
  )

  const owed = (await screen.findByRole('cell', { name: 'Outstanding' })).closest('tr')!
  expect(
    within(owed)
      .getAllByRole('cell')
      .map((td) => td.textContent),
  ).toEqual(['Outstanding', '₹55,475', '₹59,975', '₹68,975'])
  expect(screen.queryByText(/Redemption Amount/)).toBeNull()
})

test("waiving off the whole Outstanding is refused by the backend's Preview", async () => {
  showMortgagePage(
    fakeServer({
      'GET /api/mortgages/7': mortgage,
      'GET /api/mortgages/7/outstanding-on-closure': quote,
      'POST /api/closures/waive-preview': waivePreview,
    }),
  )

  fireEvent.click(await screen.findByRole('button', { name: 'Waive off…' }))
  fireEvent.change(await screen.findByLabelText(/Received now/), { target: { value: '50750' } })

  expect(
    await screen.findByText(
      `${mortgage.name}: ₹50,750 covers the ₹50,750 owed: Redeem it instead`,
      {},
      { timeout: 2000 },
    ),
  ).toBeTruthy()
  expect((screen.getByRole('button', { name: /^Waive off/ }) as HTMLButtonElement).disabled).toBe(
    true,
  )
})

test('forfeiting shows the profit or loss from the Preview, then Forfeits it alone', async () => {
  let body: unknown = null
  const forfeited = (recovered: number) =>
    closure({
      kind: 'forfeited',
      recovered_amount: recovered,
      profit_loss: recovered - quote.total,
    })
  const server = fakeServer({
    'GET /api/mortgages/7': () =>
      body ? { ...mortgage, status: 'forfeited', closure: forfeited(4_000_000) } : mortgage,
    'GET /api/mortgages/7/outstanding-on-closure': quote,
    'POST /api/closures/forfeit-preview': closingPreview((body) =>
      forfeited((body.mortgages as { recovered_amount: number }[])[0].recovered_amount),
    ),
    'POST /api/closures/forfeit': async (request: Request) => {
      body = await request.json()
      return [{ ...mortgage, status: 'forfeited', closure: forfeited(4_000_000) }]
    },
  })
  showMortgagePage(server)

  fireEvent.click(await screen.findByRole('button', { name: 'Forfeit…' }))
  fireEvent.change(await screen.findByLabelText(/Recovered Amount/), { target: { value: '40000' } })
  // Recovered ₹40,000 of ₹50,750.
  expect(await screen.findByText('Loss of ₹10,750', {}, { timeout: 2000 })).toBeTruthy()
  const submit = screen.getByRole('button', { name: 'Forfeit' }) as HTMLButtonElement
  await vi.waitFor(() => expect(submit.disabled).toBe(false))
  fireEvent.click(submit)
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm Forfeiture' }),
  )

  expect(await screen.findByText(/Forfeited on/)).toBeTruthy()
  expect(body).toMatchObject({ mortgages: [{ mortgage_id: 7, recovered_amount: 4_000_000 }] })
})

test("the quote names the Part-Month Rule of the month it charges, not the Mortgage's current one", async () => {
  showMortgagePage(
    fakeServer({
      // The Mortgage is now Pro-rata; the month charged was under Full month.
      'GET /api/mortgages/7': {
        ...mortgage,
        terms: { ...mortgage.terms, part_month_rule: 'pro_rata' },
      },
      'GET /api/mortgages/7/outstanding-on-closure': { ...quote, part_month_rule: 'full_month' },
    }),
  )

  fireEvent.click(await screen.findByRole('button', { name: 'Redeem…' }))

  expect(
    await screen.findByText('₹0 (6 days of the month, that day included; Full month)'),
  ).toBeTruthy()
})

test('the quote takes the Advance held off the Outstanding, and Redeems for the rest', async () => {
  showMortgagePage(
    fakeServer({
      'GET /api/mortgages/7': mortgage,
      'GET /api/mortgages/7/outstanding-on-closure': {
        ...quote,
        advance_held: 600_000,
        to_pay: 4_475_000,
      },
      'POST /api/closures/redeem-preview': closingPreview(() =>
        closure({ kind: 'redeemed', advance_held: 600_000, payment_amount: 4_475_000 }),
      ),
    }),
  )

  fireEvent.click(await screen.findByRole('button', { name: 'Redeem…' }))

  const held = (await screen.findByText('Advance held')).closest('div')!
  expect(within(held).getByText('− ₹6,000')).toBeTruthy()
  const toPay = screen.getByText('To pay').closest('div')!
  expect(within(toPay).getByText('₹44,750')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Redeem for ₹44,750' })).toBeTruthy()
})

test('a Redeemed Mortgage says how much of it the Advance held paid', async () => {
  const redeemed = {
    ...mortgage,
    status: 'redeemed' as const,
    closure: closure({
      kind: 'redeemed' as const,
      advance_held: 600_000,
      payment_id: 12,
      payment_amount: 4_475_000,
    }),
  }
  showMortgagePage(fakeServer({ 'GET /api/mortgages/7': redeemed }))

  expect(
    await screen.findByText(
      (_, el) =>
        el?.textContent ===
        'Redeemed on 20 Apr 2026, paying its Outstanding of ₹50,750, ₹6,000 of it from the ' +
          'Advance held. Final Payment (receipt)',
    ),
  ).toBeTruthy()
})

test('a future date is quoted, but the backend refuses to record it', async () => {
  showMortgagePage(
    fakeServer({
      'GET /api/mortgages/7': mortgage,
      'GET /api/mortgages/7/outstanding-on-closure': quote,
      'POST /api/closures/redeem-preview': closingPreview(
        () =>
          `${mortgage.name}: A Redemption, Waiver or Forfeiture cannot be recorded for a future date`,
      ),
    }),
  )

  fireEvent.click(await screen.findByRole('button', { name: 'Redeem…' }))
  fireEvent.change(await screen.findByLabelText('Redeemed on'), { target: { value: '2099-01-01' } })

  // The quote still shows; the backend's refusal keeps it from being saved.
  const owed = (await screen.findByText('Outstanding on 1 Jan 2099')).closest('div')!
  expect(within(owed).getByText('₹50,750')).toBeTruthy()
  expect(screen.queryByText(/Redemption Amount/)).toBeNull()
  expect(
    await screen.findByText(/cannot be recorded for a future date/, {}, { timeout: 2000 }),
  ).toBeTruthy()
  expect((screen.getByRole('button', { name: /^Redeem for/ }) as HTMLButtonElement).disabled).toBe(
    true,
  )
})

test("a Grace Payment's Ledger row shows both dates and what this Mortgage was let off", async () => {
  const payment = (id: number, on: string) => ({
    on,
    event: 'payment' as const,
    amount: 100_000,
    principal: 5_000_000,
    unpaid_interest: 0,
    interest_paid: 75_000,
    principal_paid: 25_000,
    payment_id: id,
    terms: null,
  })
  showMortgagePage(
    fakeServer({
      'GET /api/mortgages/7': {
        ...mortgage,
        ledger: [payment(8, '2026-10-01'), payment(9, '2026-11-06')],
        graces: [{ payment_id: 9, received_on: '2026-11-08', let_off: 42_000 }],
      },
    }),
  )

  const grace = await screen.findByText('6 Nov 2026 · received 8 Nov 2026 · Grace, ₹420 let off')
  expect(within(grace.closest('tr')!).getByRole('link').getAttribute('href')).toBe('/payments/9')
  const ordinary = screen.getByText('1 Oct 2026').closest('tr')!
  expect(within(ordinary).getByRole('link').getAttribute('href')).toBe('/payments/8')
  expect(within(ordinary).queryByText(/Grace|received|let off/)).toBeNull()
})

test('the Ledger shows applied Advance Instalments on their dates and upcoming ones last, in grey', async () => {
  const step = {
    on: '2026-10-10',
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
    instalment_id: 21,
  }
  const instalment = (id: number, on: string, number: number, upcoming: boolean) => ({
    id,
    payment_id: 4,
    on,
    amount: 75_000,
    received_on: '2026-09-20',
    number,
    of: 2,
    upcoming,
    cancelled_on: null,
  })
  showMortgagePage(
    fakeServer({
      'GET /api/mortgages/7': {
        ...mortgage,
        ledger: [step],
        advance_instalments: [
          instalment(21, '2026-10-10', 1, false),
          instalment(22, '2026-11-10', 2, true),
        ],
      },
    }),
  )

  const applied = (await screen.findByText(/^Advance Instalment 1 of 2:/)).closest('tr')!
  expect(applied.className).toBe(ledger.payment)
  const upcoming = screen.getByText('Advance Instalment 2 of 2').closest('tr')!
  expect(upcoming.className).toBe(ledger.upcoming)
  expect(within(upcoming).getByText('Upcoming')).toBeTruthy()
  expect(upcoming.previousElementSibling).toBe(applied)
})

test('Collateral Value, Received now and Recovered Amount step by whole rupees', async () => {
  showMortgagePage(
    fakeServer({
      'GET /api/mortgages/7': mortgage,
      'GET /api/mortgages/7/outstanding-on-closure': quote,
    }),
  )

  fireEvent.click(await screen.findByRole('button', { name: 'Set by hand…' }))
  expectWholeRupeeSteps(screen.getByLabelText('Collateral Value (₹)'), '0.01')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Waive off…' }))
  const received = await screen.findByLabelText(/Received now/)
  expectWholeRupeeSteps(received, '0')
  fireEvent.click(
    within(received.closest('form') as HTMLElement).getAllByRole('button', { name: 'Cancel' })[0],
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Forfeit…' }))
  expectWholeRupeeSteps(await screen.findByLabelText(/Recovered Amount/), '0')
})

// A Ledger step as the backend sends it: nothing but what `fields` sets.
const ledgerStep = (
  fields: Partial<LedgerStep> & Pick<LedgerStep, 'on' | 'event'>,
): LedgerStep => ({
  amount: 0,
  principal: 5_000_000,
  unpaid_interest: 0,
  charged_on: 0,
  interest_to_date_days: 0,
  monthly_rate_bps: 0,
  paid_ahead: 0,
  interest_paid: 0,
  principal_paid: 0,
  discount: 0,
  discount_interest_paid: 0,
  discount_principal_paid: 0,
  payment_id: null,
  terms: null,
  ...fields,
})

test('the Ledger shows its latest 8 steps, and the complete Ledger in a popup', async () => {
  const interest = (n: number) =>
    ledgerStep({
      on: `2026-${String(n + 1).padStart(2, '0')}-10`,
      event: 'interest',
      amount: 75_000,
      charged_on: 5_000_000,
      monthly_rate_bps: 150,
    })
  const ledger = [
    ledgerStep({ on: '2026-01-10', event: 'started', amount: 5_000_000 }),
    ...[1, 2, 3, 4, 5, 6, 7].map(interest),
    ledgerStep({
      on: '2026-08-12',
      event: 'payment',
      amount: 100_000,
      interest_paid: 75_000,
      principal_paid: 25_000,
      payment_id: 8,
    }),
    ledgerStep({ on: '2026-09-10', event: 'capitalised', amount: 75_000, principal: 5_050_000 }),
  ]
  showMortgagePage(fakeServer({ 'GET /api/mortgages/7': { ...mortgage, ledger } }))

  expect(await screen.findByText('Showing the latest 8 of 10 steps.')).toBeTruthy()
  expect(screen.queryByText('Mortgage started: Principal lent')).toBeNull()
  expect(
    screen.getByRole('link', { name: 'Payment: ₹750 cash to interest, ₹250 cash to Principal' }),
  ).toBeTruthy()
  expect(screen.getByText('Unpaid interest capitalised into Principal')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Show complete Ledger' }))
  const popup = within(await screen.findByRole('dialog'))
  expect(popup.getByText('Ledger of 2026GoldChain')).toBeTruthy()
  expect(popup.getByText('Mortgage started: Principal lent')).toBeTruthy()
  expect(popup.getAllByText('Interest: 1.5% of ₹50,000')).toHaveLength(7)
  expect(popup.getByText('Unpaid interest capitalised into Principal')).toBeTruthy()
})

test("removing a coming Term Change asks first, then shows the Terms without it and makes the Mortgage's History stale", async () => {
  const coming = {
    id: 3,
    effective_on: '2099-11-10',
    terms: { ...mortgage.terms, monthly_rate_bps: 200 },
    removable: true,
  }
  let stored: typeof mortgage = { ...mortgage, term_changes: [coming] }
  const server = fakeServer({
    'GET /api/mortgages/7': () => stored,
    'DELETE /api/mortgages/7/term-changes/3': () => (stored = mortgage),
  })
  const state = showMortgagePage(server)
  const history = mortgageHistoryQuery(state.client, 7, 1).queryKey
  state.queryClient.setQueryData(history, { items: [], total: 0, page: 1, page_size: 20 })

  fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }))

  await vi.waitFor(() => expect(screen.queryByText(/From 10 Nov 2099/)).toBeNull())
  expect(server.requests).toContain('DELETE /api/mortgages/7/term-changes/3')
  expect(state.queryClient.getQueryState(history)?.isInvalidated).toBe(true)
})

test("a Collateral Value set by hand shows on the page, and makes the Mortgage's History stale", async () => {
  const revalued: typeof mortgage = {
    ...mortgage,
    collateral: { value: 9_000_000, source: 'manual', set_on: '2026-10-18', loan_to_value: 0.56 },
  }
  let stored = mortgage
  const server = fakeServer({
    'GET /api/mortgages/7': () => stored,
    'PUT /api/mortgages/7/collateral': () => (stored = revalued),
  })
  const state = showMortgagePage(server)
  const history = mortgageHistoryQuery(state.client, 7, 1).queryKey
  state.queryClient.setQueryData(history, { items: [], total: 0, page: 1, page_size: 20 })

  fireEvent.click(await screen.findByRole('button', { name: 'Set by hand…' }))
  fireEvent.change(screen.getByLabelText('Collateral Value (₹)'), { target: { value: '90000' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm and save' }),
  )

  expect(await screen.findByText('set by hand on 18 Oct 2026')).toBeTruthy()
  expect(screen.getByText('₹90,000')).toBeTruthy()
  expect(state.queryClient.getQueryState(history)?.isInvalidated).toBe(true)
})

test('a Call Note recorded on the Mortgage page shows in its Call Notes', async () => {
  const saved = {
    id: 1,
    called_on: '2026-10-18',
    note: 'Will pay Friday',
    created_at: '2026-10-18T10:00:00',
  }
  let notes: unknown[] = []
  showMortgagePage(
    fakeServer({
      'GET /api/mortgages/7': mortgage,
      'GET /api/mortgages/7/call-notes': () => ({
        items: notes,
        total: notes.length,
        page: 1,
        page_size: 20,
      }),
      'POST /api/mortgages/7/call-notes': () => {
        notes = [saved]
        return saved
      },
    }),
  )

  expect(await screen.findByText('Not called yet.')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Call Note for 2026GoldChain'), {
    target: { value: 'Will pay Friday' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Called' }))
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save Call Note' }),
  )

  expect(await screen.findByText('Will pay Friday')).toBeTruthy()
})

test('a refused photo deletion is shown with the photos', async () => {
  const server = fakeServer({
    'GET /api/mortgages/7': {
      ...mortgage,
      photos: [{ id: 5, url: '/api/photos/mortgage-7-a.jpg' }],
    },
    'DELETE /api/mortgages/7/photos/5': Response.json(
      { detail: 'Photo is in use' },
      { status: 409 },
    ),
  })
  showMortgagePage(server)

  fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))

  const refusal = await screen.findByText('Photo is in use')
  const photos = screen.getByRole('heading', { name: 'Photos' })
  expect(photos.compareDocumentPosition(refusal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.getByRole('img', { name: 'Photo 1' })).toBeTruthy()
})

test('reopening a Closed Mortgage needs a reason, then shows it Active again', async () => {
  const redeemed = {
    ...mortgage,
    status: 'redeemed' as const,
    closure: closure({ kind: 'redeemed' as const, payment_id: 12, payment_amount: 5_075_000 }),
  }
  let stored: unknown = redeemed
  const server = fakeServer({
    'GET /api/mortgages/7': () => stored,
    'POST /api/mortgages/7/reopen': async (request: Request) => {
      expect(await request.json()).toEqual({ reason: 'Paid by mistake' })
      return (stored = mortgage)
    },
  })
  showMortgagePage(server)

  fireEvent.click(await screen.findByRole('button', { name: 'Reopen…' }))
  const dialog = within(await screen.findByRole('dialog'))
  expect(dialog.getByText(/Its final Payment is voided/)).toBeTruthy()
  fireEvent.change(dialog.getByLabelText('Reason (kept on record)'), {
    target: { value: 'Paid by mistake' },
  })
  fireEvent.click(dialog.getByRole('button', { name: 'Reopen' }))

  expect(await screen.findByRole('heading', { name: 'Close this Mortgage' })).toBeTruthy()
  expect(server.requests).toContain('POST /api/mortgages/7/reopen')
})
