// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ClosuresPage } from '../src/pages/ClosuresPage'
import { fakeServer } from './fakeServer'
import { showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const row = {
  id: 3, name: '2025-Arjun-GoldRing', customer: { kind: 'customer', id: 2, name: 'Arjun Patel' },
  start_date: '2025-06-15', amount_lent: 2_000_000, status: 'active', outstanding_total: 2_180_000,
}
const redemption = {
  on: '2026-04-20', principal: 2_000_000, unpaid_interest: 180_000, last_accrual_on: '2026-04-14',
  part_month_days: 6,
  part_month_charge: 60_000, total: 2_240_000,
}

/** Waiving off a Mortgage owing ₹22,400, as the backend's Preview would answer: what is
 *  let off, or (if what is paid covers it) a refusal. */
async function waivePreview(request: Request) {
  const { mortgages } = (await request.json()) as {
    mortgages: { mortgage_id: number; amount_paid: number }[]
  }
  const covering = mortgages.find((m) => m.amount_paid >= redemption.total)
  if (covering)
    return Response.json(
      { detail: '2025-Arjun-GoldRing: ₹22,400 covers the ₹22,400 owed: Redeem it instead' },
      { status: 422 },
    )
  const closure = (paid: number) => ({
    kind: 'waived',
    on: '2026-04-20',
    redemption_amount: redemption.total,
    payment_id: paid > 0 ? 50 : null,
    payment_amount: paid > 0 ? paid : null,
    waived_amount: redemption.total - paid,
    recovered_amount: null,
    profit_loss: null,
    note: null,
  })
  const side = (closure: unknown) => ({ outstanding: 0, points: [], term_changes: [], closure })
  return mortgages.map((m) => ({
    mortgage_id: m.mortgage_id,
    mortgage_name: row.name,
    before: side(null),
    after: side(closure(m.amount_paid)),
    ledger_changes: [],
  }))
}

async function waiveOff(rupees: string) {
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Choose 2025-Arjun-GoldRing' }))
  fireEvent.click(screen.getByRole('radio', { name: 'Waive off' }))
  fireEvent.change(await screen.findByLabelText('Received now for 2025-Arjun-GoldRing'), {
    target: { value: rupees },
  })
}

async function confirmWaiver() {
  const submit = screen.getByRole('button', { name: 'Waive off 1' }) as HTMLButtonElement
  await vi.waitFor(() => expect(submit.disabled).toBe(false), { timeout: 2000 })
  fireEvent.click(submit)
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm Waiver' }),
  )
}

test('the chosen Mortgages can be Waived off instead of Forfeited, each with what it brought in', async () => {
  const waived: unknown[] = []
  let listed = [row]
  const server = fakeServer({
    'GET /api/closures/ready-to-redeem': { items: [], total: 0, page: 1, page_size: 20 },
    'GET /api/mortgages': () => ({ items: listed, total: listed.length, page: 1, page_size: 20 }),
    'GET /api/mortgages/3/redemption': redemption,
    'GET /api/payment-methods': [{ method: 'cash', name: 'Cash' }],
    'POST /api/closures/waive-preview': waivePreview,
    'POST /api/closures/waive': async (request: Request) => {
      waived.push(await request.json())
      listed = []
      return []
    },
  })
  showPage(server, '/closures', { '/closures': <ClosuresPage /> })

  await waiveOff('22000')
  fireEvent.change(screen.getByLabelText('Reference (for all)'), { target: { value: 'UTR9' } })
  expect(await screen.findByText('Total waived off ₹400', {}, { timeout: 2000 })).toBeTruthy()
  await confirmWaiver()

  expect(await screen.findByText('No Active Mortgages with anything Outstanding.')).toBeTruthy()
  expect(waived).toEqual([
    expect.objectContaining({
      method: 'cash',
      reference: 'UTR9',
      mortgages: [{ mortgage_id: 3, amount_paid: 2_200_000 }],
    }),
  ])
  expect(server.requests).not.toContain('POST /api/closures/forfeit')
})

test("receiving all that is owed cannot be Waived off: the Preview gives the backend's reason", async () => {
  const server = fakeServer({
    'GET /api/closures/ready-to-redeem': { items: [], total: 0, page: 1, page_size: 20 },
    'GET /api/mortgages': { items: [row], total: 1, page: 1, page_size: 20 },
    'GET /api/mortgages/3/redemption': redemption,
    'POST /api/closures/waive-preview': waivePreview,
  })
  showPage(server, '/closures', { '/closures': <ClosuresPage /> })

  await waiveOff('22400')

  expect(
    await screen.findByText(
      '2025-Arjun-GoldRing: ₹22,400 covers the ₹22,400 owed: Redeem it instead',
      {},
      { timeout: 2000 },
    ),
  ).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Waive off 1' }) as HTMLButtonElement).disabled).toBe(true)
})

test("if the backend refuses the Waiver when it is saved, nothing is Waived off and its reason is shown", async () => {
  const server = fakeServer({
    'GET /api/closures/ready-to-redeem': { items: [], total: 0, page: 1, page_size: 20 },
    'GET /api/mortgages': { items: [row], total: 1, page: 1, page_size: 20 },
    'GET /api/mortgages/3/redemption': redemption,
    'POST /api/closures/waive-preview': waivePreview,
    'POST /api/closures/waive': () =>
      Response.json({ detail: '2025-Arjun-GoldRing is already forfeited' }, { status: 422 }),
  })
  showPage(server, '/closures', { '/closures': <ClosuresPage /> })

  await waiveOff('22000')
  await confirmWaiver()

  expect(await screen.findByText('2025-Arjun-GoldRing is already forfeited')).toBeTruthy()
  expect(
    (screen.getByRole('checkbox', { name: 'Choose 2025-Arjun-GoldRing' }) as HTMLInputElement).checked,
  ).toBe(true)
})

const second = { ...row, id: 4, name: '2025-Arjun-Bangles' }
const forfeited = (recovered: number) => ({
  kind: 'forfeited',
  on: '2026-04-20',
  redemption_amount: 2_240_000,
  payment_id: null,
  payment_amount: null,
  waived_amount: null,
  recovered_amount: recovered,
  profit_loss: recovered - 2_240_000,
  note: null,
})
const side = (closure: unknown) => ({ outstanding: 0, points: [], term_changes: [], closure })

/** The Forfeit-or-Waive list of `row` and `second`, with each one's Forfeiture as the
 *  Preview works it out from what was sent. */
function forfeitRoutes(extra: Record<string, unknown>) {
  return {
    'GET /api/closures/ready-to-redeem': { items: [], total: 0, page: 1, page_size: 20 },
    'GET /api/mortgages': { items: [row, second], total: 2, page: 1, page_size: 20 },
    'GET /api/mortgages/3/redemption': redemption,
    'GET /api/mortgages/4/redemption': redemption,
    'POST /api/closures/forfeit-preview': async (request: Request) => {
      const { mortgages } = (await request.json()) as {
        mortgages: { mortgage_id: number; recovered_amount: number }[]
      }
      return mortgages.map((m) => ({
        mortgage_id: m.mortgage_id,
        mortgage_name: m.mortgage_id === 3 ? row.name : second.name,
        before: side(null),
        after: side(forfeited(m.recovered_amount)),
        ledger_changes: [],
      }))
    },
    ...extra,
  }
}

async function forfeitBoth() {
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Choose 2025-Arjun-GoldRing' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Choose 2025-Arjun-Bangles' }))
  fireEvent.change(await screen.findByLabelText('Recovered Amount for 2025-Arjun-GoldRing'), {
    target: { value: '23000' },
  })
  fireEvent.change(screen.getByLabelText('Recovered Amount for 2025-Arjun-Bangles'), {
    target: { value: '20000' },
  })
}

test("forfeiting several shows each one's profit or loss from the Preview before confirming", async () => {
  const server = fakeServer(forfeitRoutes({}))
  showPage(server, '/closures', { '/closures': <ClosuresPage /> })
  await forfeitBoth()

  // Recovered ₹23,000 and ₹20,000 of ₹22,400 each.
  expect(await screen.findByText('₹600', {}, { timeout: 2000 })).toBeTruthy()
  expect(screen.getByText('-₹2,400')).toBeTruthy()
  expect(screen.getByText('Total loss ₹1,800')).toBeTruthy()
  expect(server.requests).not.toContain('POST /api/closures/forfeit')
})

test('confirming Forfeits all the chosen in one request', async () => {
  const sent: unknown[] = []
  let listed = [row, second]
  const server = fakeServer(
    forfeitRoutes({
      'GET /api/mortgages': () => ({ items: listed, total: listed.length, page: 1, page_size: 20 }),
      'POST /api/closures/forfeit': async (request: Request) => {
        sent.push(await request.json())
        listed = []
        return []
      },
    }),
  )
  showPage(server, '/closures', { '/closures': <ClosuresPage /> })
  await forfeitBoth()
  const submit = screen.getByRole('button', { name: 'Forfeit 2' }) as HTMLButtonElement
  await vi.waitFor(() => expect(submit.disabled).toBe(false), { timeout: 2000 })
  fireEvent.click(submit)
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm Forfeiture' }),
  )

  expect(await screen.findByText('No Active Mortgages with anything Outstanding.')).toBeTruthy()
  expect(sent).toEqual([
    {
      forfeited_on: expect.any(String),
      note: '',
      mortgages: [
        { mortgage_id: 3, recovered_amount: 2_300_000 },
        { mortgage_id: 4, recovered_amount: 2_000_000 },
      ],
    },
  ])
  expect(server.requests.filter((r) => r.endsWith('/forfeit'))).toEqual(['POST /api/closures/forfeit'])
})

test("if the backend refuses one, none are Forfeited and its reason is shown", async () => {
  const server = fakeServer(
    forfeitRoutes({
      'POST /api/closures/forfeit': () =>
        Response.json(
          { detail: '2025-Arjun-Bangles: There are Payments after that date' },
          { status: 422 },
        ),
    }),
  )
  showPage(server, '/closures', { '/closures': <ClosuresPage /> })
  await forfeitBoth()
  const submit = screen.getByRole('button', { name: 'Forfeit 2' }) as HTMLButtonElement
  await vi.waitFor(() => expect(submit.disabled).toBe(false), { timeout: 2000 })
  fireEvent.click(submit)
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm Forfeiture' }),
  )

  expect(
    await screen.findByText('2025-Arjun-Bangles: There are Payments after that date'),
  ).toBeTruthy()
  expect(
    (screen.getByRole('checkbox', { name: 'Choose 2025-Arjun-Bangles' }) as HTMLInputElement).checked,
  ).toBe(true)
})

test("a Forfeiture the Preview says would be refused can't be confirmed, and its reason is shown", async () => {
  const server = fakeServer(
    forfeitRoutes({
      'POST /api/closures/forfeit-preview': () =>
        Response.json(
          { detail: '2025-Arjun-Bangles: There are Payments after that date' },
          { status: 422 },
        ),
    }),
  )
  showPage(server, '/closures', { '/closures': <ClosuresPage /> })
  await forfeitBoth()

  expect(
    await screen.findByText('2025-Arjun-Bangles: There are Payments after that date', {}, { timeout: 2000 }),
  ).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Forfeit 2' }) as HTMLButtonElement).disabled).toBe(true)
  expect(server.requests).not.toContain('POST /api/closures/forfeit')
})

test('each Mortgage Ready to Redeem shows its Redemption Amount today and the part-month days behind it', async () => {
  const paidOff = { ...row, outstanding_total: 0, ready_to_redeem: true }
  const charge = { ...redemption, principal: 0, unpaid_interest: 0, total: 60_000 }
  showPage(
    fakeServer({
      'GET /api/closures/ready-to-redeem': {
        items: [{ mortgage: paidOff, redemption: charge }],
        total: 1,
        page: 1,
        page_size: 20,
      },
      'GET /api/mortgages': { items: [], total: 0, page: 1, page_size: 20 },
    }),
    '/closures',
    { '/closures': <ClosuresPage /> },
  )

  const ready = (await screen.findByRole('link', { name: row.name })).closest('tr')!
  expect(within(ready).getByText('₹600')).toBeTruthy()
  expect(within(ready).getByText('(part-month charge for 6 days)')).toBeTruthy()
})
