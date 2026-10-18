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

const side = (outstanding: number) => ({ outstanding, points: [], term_changes: [] })
const preview = [
  {
    mortgage_id: 7,
    mortgage_name: mortgage.name,
    before: side(5_075_000),
    after: side(6_075_000),
    ledger_changes: [],
  },
]

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
