// @vitest-environment jsdom
// The closing module on its own, through a stand-in form that uses it.
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { useClosing, type Closing } from '../src/components/useClosing'
import { formatINR } from '../src/money'
import { fakeServer, type FakeServer } from './fakeServer'
import { showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const forfeiting: Closing = {
  kind: 'forfeit',
  forfeit: {
    forfeited_on: '2026-04-20',
    note: 'Auctioned',
    mortgages: [
      { mortgage_id: 3, recovered_amount: 2_300_000 },
      { mortgage_id: 4, recovered_amount: 900_000 },
    ],
  },
}

const forfeited = (profitLoss: number) => ({
  kind: 'forfeited',
  on: '2026-04-20',
  redemption_amount: 2_240_000,
  payment_id: null,
  payment_amount: null,
  waived_amount: null,
  recovered_amount: 2_240_000 + profitLoss,
  profit_loss: profitLoss,
  note: 'Auctioned',
})
const side = (closure: unknown) => ({ outstanding: 0, points: [], term_changes: [], closure })
const preview = [3, 4].map((id, i) => ({
  mortgage_id: id,
  mortgage_name: `Mortgage ${id}`,
  before: side(null),
  after: side(forfeited(i === 0 ? 60_000 : -1_340_000)),
  ledger_changes: [],
}))

/** A form closing `forfeiting`, showing each Mortgage's Closure as the Preview has it. */
function Form() {
  const [done, setDone] = useState(false)
  const closing = useClosing({
    closing: forfeiting,
    confirm: () => ({ title: 'Forfeit 2?', confirmLabel: 'Confirm Forfeiture' }),
    saved: () => setDone(true),
  })
  return (
    <form onSubmit={closing.submit}>
      {[3, 4].map((id) => (
        <p key={id}>
          {id}: {closing.closureOf(id) ? formatINR(closing.closureOf(id)?.profit_loss ?? 0) : '—'}
        </p>
      ))}
      <button type="submit" disabled={!closing.canSave}>
        Forfeit
      </button>
      {closing.error && <p>{closing.error}</p>}
      {done && <p>Closed</p>}
      {closing.confirmDialog}
    </form>
  )
}

function showForm(server: FakeServer) {
  showPage(server, '/', { '/': <Form /> })
}

async function confirmForfeiture() {
  const submit = (await screen.findByRole('button', { name: 'Forfeit' })) as HTMLButtonElement
  await vi.waitFor(() => expect(submit.disabled).toBe(false), { timeout: 2000 })
  fireEvent.click(submit)
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm Forfeiture' }),
  )
}

test("each Mortgage's Closure comes from the Preview, before anything is saved", async () => {
  const server = fakeServer({ 'POST /api/closures/forfeit-preview': preview })
  showForm(server)

  expect(await screen.findByText('3: ₹600', {}, { timeout: 2000 })).toBeTruthy()
  expect(screen.getByText('4: -₹13,400')).toBeTruthy()
  expect(server.requests).not.toContain('POST /api/closures/forfeit')
})

test('confirming closes them all in one request', async () => {
  const sent: unknown[] = []
  const server = fakeServer({
    'POST /api/closures/forfeit-preview': preview,
    'POST /api/closures/forfeit': async (request: Request) => {
      sent.push(await request.json())
      return []
    },
  })
  showForm(server)
  await confirmForfeiture()

  expect(await screen.findByText('Closed')).toBeTruthy()
  expect(sent).toEqual([forfeiting.forfeit])
})

test("a refusal shows the backend's reason and closes nothing", async () => {
  const server = fakeServer({
    'POST /api/closures/forfeit-preview': preview,
    'POST /api/closures/forfeit': () =>
      Response.json({ detail: 'Mortgage 4: There are Payments after that date' }, { status: 422 }),
  })
  showForm(server)
  await confirmForfeiture()

  expect(await screen.findByText('Mortgage 4: There are Payments after that date')).toBeTruthy()
  expect(screen.queryByText('Closed')).toBeNull()
})
