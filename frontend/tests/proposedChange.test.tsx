// @vitest-environment jsdom
// The propose-a-change flow, through one of its pages (Edit Mortgage).
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { EditMortgagePage } from '../src/pages/EditMortgagePage'
import { fakeServer, type FakeServer } from './fakeServer'
import { mortgage, showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const side = (outstanding: number) => ({ outstanding, points: [], term_changes: [], closure: null })
/** The edit's Preview, writing `cash`: the sums in cash, as the backend works them out. */
const previewWith = (cash: number[]) => ({
  mortgages: [
    {
      mortgage_id: 7,
      mortgage_name: mortgage.name,
      before: side(5_075_000),
      after: side(6_075_000),
      ledger_changes: [],
    },
  ],
  cash,
})
const preview = previewWith([])

function editPrincipal(server: FakeServer, rupees: string) {
  showPage(server, '/mortgages/7/edit', { '/mortgages/:id/edit': <EditMortgagePage /> })
  return screen.findByLabelText('Principal lent (₹)').then((field) => {
    fireEvent.change(field, { target: { value: rupees } })
  })
}

const saveButton = () => screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement

test("while the Preview says the change would be refused, it can't be saved", async () => {
  const server = fakeServer({
    'GET /api/mortgages/7': mortgage,
    'POST /api/mortgages/7/edit-preview': () =>
      Response.json({ detail: 'There is a Payment before that start date' }, { status: 422 }),
  })
  await editPrincipal(server, '60000')

  expect(await screen.findByText('There is a Payment before that start date', {}, { timeout: 2000 }))
  expect(saveButton().disabled).toBe(true)
})

test('going back from the confirmation saves nothing', async () => {
  const server = fakeServer({
    'GET /api/mortgages/7': mortgage,
    'POST /api/mortgages/7/edit-preview': preview,
  })
  await editPrincipal(server, '60000')
  await screen.findByText(/No change to the Ledger so far/, {}, { timeout: 2000 })

  fireEvent.click(saveButton())
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Keep editing' }))

  expect(screen.queryByRole('dialog')).toBeNull()
  expect(server.requests).not.toContain('PUT /api/mortgages/7')
  expect(saveButton().disabled).toBe(false)
})

test('confirming saves the change, then goes where the page says', async () => {
  const server = fakeServer({
    'GET /api/mortgages/7': mortgage,
    'POST /api/mortgages/7/edit-preview': preview,
    'PUT /api/mortgages/7': { ...mortgage, amount_lent: 6_000_000 },
  })
  await editPrincipal(server, '60000')
  await screen.findByText(/No change to the Ledger so far/, {}, { timeout: 2000 })

  fireEvent.click(saveButton())
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm and save' }))

  expect(await screen.findByText('Now at /mortgages/7')).toBeTruthy()
  expect(server.requests).toContain('PUT /api/mortgages/7')
})

test("a refused save shows the backend's reason and can be tried again", async () => {
  const server = fakeServer({
    'GET /api/mortgages/7': mortgage,
    'POST /api/mortgages/7/edit-preview': preview,
    'PUT /api/mortgages/7': () =>
      Response.json({ detail: 'The Mortgage Name 2026GoldChain is already used' }, { status: 409 }),
  })
  await editPrincipal(server, '60000')
  await screen.findByText(/No change to the Ledger so far/, {}, { timeout: 2000 })

  fireEvent.click(saveButton())
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm and save' }))

  expect(await screen.findByText('The Mortgage Name 2026GoldChain is already used')).toBeTruthy()
  expect(saveButton().disabled).toBe(false)
})

// --- The Cash Limit's warning (never a refusal), from what the Preview says is cash.

/** Saving a change whose Preview writes `cash`, with the Cash Limit at `limit`. */
async function saveWithCash(cash: number[], limit: number | null) {
  const server = fakeServer({
    'GET /api/mortgages/7': mortgage,
    'GET /api/settings/cash-limit': { cash_limit: limit },
    'POST /api/mortgages/7/edit-preview': previewWith(cash),
    'PUT /api/mortgages/7': { ...mortgage, amount_lent: 6_000_000 },
  })
  await editPrincipal(server, '60000')
  await screen.findByText(/No change to the Ledger so far/, {}, { timeout: 2000 })
  fireEvent.click(saveButton())
  return { server, dialog: await screen.findByRole('dialog') }
}

test('a sum in cash at or above the Cash Limit is warned about first, the largest named', async () => {
  const { server, dialog } = await saveWithCash([500_000, 2_500_000], 2_000_000)

  expect(within(dialog).getByRole('heading', { name: '₹25,000 in cash' })).toBeTruthy()
  // The rules' figure, whatever Cash Limit the Lender has set.
  expect(
    within(dialog).getByText(
      'Government of India rules ask for ₹20,000 or more to be lent or received by UPI or bank transfer, not cash.',
    ),
  ).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Go back' }))

  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(server.requests).not.toContain('PUT /api/mortgages/7')
})

test('the Lender can go on in cash anyway, to the confirmation as usual', async () => {
  const { server, dialog } = await saveWithCash([2_000_000], 2_000_000) // exactly the limit

  fireEvent.click(within(dialog).getByRole('button', { name: 'Record in cash anyway' }))
  const confirmation = await screen.findByRole('dialog', { name: /Save changes/ })
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm and save' }))

  expect(await screen.findByText('Now at /mortgages/7')).toBeTruthy()
  expect(server.requests).toContain('PUT /api/mortgages/7')
})

test.each([
  ['under the Cash Limit', [1_999_900], 2_000_000],
  ['with nothing in cash', [], 2_000_000],
  ['with no Cash Limit set', [2_500_000], null],
])('no warning %s', async (_, cash, limit) => {
  const { dialog } = await saveWithCash(cash, limit)

  expect(within(dialog).queryByText(/in cash/)).toBeNull()
  expect(within(dialog).getByRole('button', { name: 'Confirm and save' })).toBeTruthy()
})
