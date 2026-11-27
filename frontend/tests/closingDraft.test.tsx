// @vitest-environment jsdom
// The Closing draft on its own: what its fields make of a Closing, and the confirmation
// it asks, through a stand-in form that uses it.
import { act, cleanup, fireEvent, renderHook, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { ServerStateProvider } from '../src/components/ServerStateProvider'
import {
  useClosingDraft,
  type ClosingKind,
  type DraftMortgage,
} from '../src/pages/mortgage/useClosingDraft'
import { createServerState } from '../src/serverState'
import { changePreview, fakeServer } from './fakeServer'
import { showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const asha = { name: 'Asha Rao' }
const one: DraftMortgage[] = [{ id: 7, name: '2026GoldChain', customer: asha }]
const two: DraftMortgage[] = [
  { id: 3, name: 'Ring', customer: asha },
  { id: 4, name: 'Chain', customer: asha },
]

function draftOf(initial: ClosingKind | null, mortgages: DraftMortgage[]) {
  const state = createServerState({ fetch: fakeServer({}).fetch, retry: false })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ServerStateProvider state={state}>{children}</ServerStateProvider>
  )
  return renderHook(
    ({ kind }: { kind: ClosingKind | null }) =>
      useClosingDraft({ kind, mortgages, onSaved: () => {} }),
    { wrapper, initialProps: { kind: initial } },
  )
}

const type = (
  binding: { onChange: (event: { target: { value: string } }) => void },
  value: string,
) => act(() => binding.onChange({ target: { value } }))

test('with no kind chosen there is no Closing', () => {
  const { result } = draftOf(null, one)
  expect(result.current.closing).toBeNull()
})

test('a Redemption needs only a date, and carries the method and a trimmed reference', () => {
  const { result } = draftOf('redeem', one)
  type(result.current.on, '2026-04-20')
  act(() => result.current.method.onChange('upi'))
  type(result.current.reference, '  UTR9 ')

  expect(result.current.closing).toEqual({
    kind: 'redeem',
    redeem: { redeemed_on: '2026-04-20', method: 'upi', reference: 'UTR9', mortgage_ids: [7] },
  })
})

test('a Redemption with a blank reference sends none, and with no date is no Closing', () => {
  const { result } = draftOf('redeem', two)
  type(result.current.on, '2026-04-20')
  expect(result.current.closing).toMatchObject({
    redeem: { reference: null, mortgage_ids: [3, 4] },
  })

  type(result.current.on, '')
  expect(result.current.closing).toBeNull()
})

test('a Waive with no amount gives no Closing', () => {
  const { result } = draftOf('waive', one)
  type(result.current.on, '2026-04-20')
  expect(result.current.closing).toBeNull()

  type(result.current.amountOf(7), '2200')
  expect(result.current.closing).not.toBeNull()
})

test('a Waive over several Mortgages waits for every amount, and carries each in paise', () => {
  const { result } = draftOf('waive', two)
  type(result.current.on, '2026-04-20')
  type(result.current.note, 'small balance')
  type(result.current.amountOf(3), '2200')
  expect(result.current.closing).toBeNull()

  type(result.current.amountOf(4), '0')
  expect(result.current.closing).toEqual({
    kind: 'waive',
    waive: {
      waived_on: '2026-04-20',
      method: 'cash',
      reference: null,
      note: 'small balance',
      mortgages: [
        { mortgage_id: 3, amount_paid: 220_000 },
        { mortgage_id: 4, amount_paid: 0 },
      ],
    },
  })
})

test('a Forfeit body carries each Mortgage’s Recovered Amount and no method', () => {
  const { result } = draftOf('forfeit', two)
  type(result.current.on, '2026-04-20')
  type(result.current.note, 'Auctioned')
  type(result.current.amountOf(3), '23000')
  expect(result.current.closing).toBeNull()
  type(result.current.amountOf(4), '9000.50')

  expect(result.current.closing).toEqual({
    kind: 'forfeit',
    forfeit: {
      forfeited_on: '2026-04-20',
      note: 'Auctioned',
      mortgages: [
        { mortgage_id: 3, recovered_amount: 2_300_000 },
        { mortgage_id: 4, recovered_amount: 900_050 },
      ],
    },
  })
})

test('the Waive amounts and the Forfeit amounts are kept apart', () => {
  const { result, rerender } = draftOf('waive', one)
  type(result.current.amountOf(7), '2200')

  rerender({ kind: 'forfeit' })
  expect(result.current.amountOf(7).value).toBe('')
  expect(result.current.closing).toBeNull()

  rerender({ kind: 'waive' })
  expect(result.current.amountOf(7).value).toBe('2200')
})

test('a Waive is paying only when some amount is above nothing', () => {
  const { result } = draftOf('waive', two)
  expect(result.current.paying).toBe(false)
  type(result.current.amountOf(3), '0')
  expect(result.current.paying).toBe(false)
  type(result.current.amountOf(4), '1')
  expect(result.current.paying).toBe(true)
})

// ---- The confirmation ------------------------------------------------------------

const closureOf = (over: Record<string, unknown>) => ({
  kind: 'forfeited',
  on: '2026-04-20',
  outstanding: 2_240_000,
  payment_id: null,
  payment_amount: null,
  waived_amount: null,
  recovered_amount: null,
  profit_loss: null,
  note: null,
  ...over,
})
const side = (closure: unknown) => ({ outstanding: 0, points: [], term_changes: [], closure })
const previewOf = (closures: Record<number, unknown>) =>
  changePreview(
    Object.entries(closures).map(([id, closure]) => ({
      mortgage_id: Number(id),
      mortgage_name: `Mortgage ${id}`,
      before: side(null),
      after: side(closure),
      ledger_changes: [],
      advance_warnings: [],
    })),
  )

function Form({ kind, mortgages }: { kind: ClosingKind; mortgages: DraftMortgage[] }) {
  const draft = useClosingDraft({ kind, mortgages, onSaved: () => {} })
  return (
    <form onSubmit={draft.submit}>
      <input aria-label="on" {...draft.on} />
      <input aria-label="note" {...draft.note} />
      {mortgages.map((m) => (
        <input key={m.id} aria-label={`amount ${m.id}`} {...draft.amountOf(m.id)} />
      ))}
      <button type="submit" disabled={!draft.canSave}>
        Save
      </button>
      {draft.confirmDialog}
    </form>
  )
}

async function openConfirmation(kind: ClosingKind, mortgages: DraftMortgage[], amounts: string[]) {
  fireEvent.change(await screen.findByLabelText('on'), { target: { value: '2026-04-20' } })
  fireEvent.change(screen.getByLabelText('note'), { target: { value: ' Auctioned ' } })
  mortgages.forEach((m, i) => {
    if (kind !== 'redeem')
      fireEvent.change(screen.getByLabelText(`amount ${m.id}`), { target: { value: amounts[i] } })
  })
  const save = (await screen.findByRole('button', { name: 'Save' })) as HTMLButtonElement
  await vi.waitFor(() => expect(save.disabled).toBe(false), { timeout: 2000 })
  fireEvent.click(save)
  return within(await screen.findByRole('dialog'))
}

test('a Forfeit of one Mortgage confirms with its Closure from the Preview', async () => {
  const server = fakeServer({
    'POST /api/closures/forfeit-preview': previewOf({
      7: closureOf({ recovered_amount: 4_000_000, profit_loss: -240_000 }),
    }),
  })
  showPage(server, '/', { '/': <Form kind="forfeit" mortgages={one} /> })
  const dialog = await openConfirmation('forfeit', one, ['40000'])

  expect(dialog.getByText('Forfeit 2026GoldChain?')).toBeTruthy()
  expect(dialog.getByText('Recovered Amount').nextSibling?.textContent).toBe('₹40,000')
  expect(dialog.getByText('Note').nextSibling?.textContent).toBe('Auctioned')
  expect(dialog.getByRole('button', { name: 'Confirm Forfeiture' })).toBeTruthy()
})

test('a Forfeit of several Mortgages confirms with a row each and the total', async () => {
  const server = fakeServer({
    'POST /api/closures/forfeit-preview': previewOf({
      3: closureOf({ recovered_amount: 2_300_000, profit_loss: 60_000 }),
      4: closureOf({ recovered_amount: 900_000, profit_loss: -1_340_000 }),
    }),
  })
  showPage(server, '/', { '/': <Form kind="forfeit" mortgages={two} /> })
  const dialog = await openConfirmation('forfeit', two, ['23000', '9000'])

  expect(dialog.getByText('Forfeit 2 Mortgages?')).toBeTruthy()
  expect(dialog.getByText('Ring').nextSibling?.textContent).toBe('Recovered ₹23,000 of ₹22,400')
  expect(dialog.getByText('Total loss').nextSibling?.textContent).toBe('₹12,800')
})

test('a Waive of several Mortgages confirms with a row each and the total let off', async () => {
  const server = fakeServer({
    'POST /api/closures/waive-preview': previewOf({
      3: closureOf({ kind: 'waived', payment_amount: 220_000, waived_amount: 20_000 }),
      4: closureOf({ kind: 'waived', payment_amount: 0, waived_amount: 30_000 }),
    }),
  })
  showPage(server, '/', { '/': <Form kind="waive" mortgages={two} /> })
  const dialog = await openConfirmation('waive', two, ['2200', '0'])

  expect(dialog.getByText('Waive off 2 Mortgages?')).toBeTruthy()
  expect(dialog.getByText('Chain').nextSibling?.textContent).toBe('Received ₹0, waived ₹300')
  expect(dialog.getByText('Total waived off').nextSibling?.textContent).toBe('₹500')
  expect(dialog.getByText('Return the jewellery for each.')).toBeTruthy()
})

test('a Waive of one Mortgage says what the final Payment was, and to whom the jewellery goes', async () => {
  const server = fakeServer({
    'POST /api/closures/waive-preview': previewOf({
      7: closureOf({ kind: 'waived', payment_amount: 220_000, waived_amount: 20_000 }),
    }),
  })
  showPage(server, '/', { '/': <Form kind="waive" mortgages={one} /> })
  const dialog = await openConfirmation('waive', one, ['2200'])

  expect(dialog.getByText('Waive off 2026GoldChain?')).toBeTruthy()
  expect(dialog.getByText('Final Payment').nextSibling?.textContent).toBe('₹2,200 · ')
  expect(dialog.getByText('Return the jewellery to Asha Rao.')).toBeTruthy()
})

test('a Redemption confirms with its Final Payment', async () => {
  const server = fakeServer({
    'POST /api/closures/redeem-preview': previewOf({
      7: closureOf({ kind: 'redeemed', payment_amount: 5_075_000 }),
    }),
  })
  showPage(server, '/', { '/': <Form kind="redeem" mortgages={one} /> })
  const dialog = await openConfirmation('redeem', one, [])

  expect(dialog.getByText('Redeem 2026GoldChain?')).toBeTruthy()
  expect(dialog.getByText('Final Payment').nextSibling?.textContent).toBe('₹50,750')
  expect(dialog.getByRole('button', { name: 'Confirm Redemption' })).toBeTruthy()
})
