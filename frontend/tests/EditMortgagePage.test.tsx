// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { MortgageEdit } from '../src/api'
import { EditMortgagePage } from '../src/pages/EditMortgagePage'
import { changePreview, fakeServer } from './fakeServer'
import { mortgage, showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** The backend for editing Mortgage 7 (₹50,000 lent) as `stored`, with a ₹20,000 Cash
 *  Limit; what is sent to be saved goes into `sent`. Its Preview says an edit lent in
 *  cash writes its Principal in cash. */
function server(stored: object, sent: unknown[]) {
  return fakeServer({
    'GET /api/mortgages/7': stored,
    'GET /api/payment-methods': [
      { method: 'cash', name: 'Cash' },
      { method: 'upi', name: 'UPI' },
    ],
    'GET /api/settings/cash-limit': { cash_limit: 2_000_000 },
    'POST /api/mortgages/7/edit-preview': async (request: Request) => {
      const edit = (await request.json()) as MortgageEdit
      return changePreview([], edit.lent_through === 'cash' ? [edit.amount_lent] : [])
    },
    'PUT /api/mortgages/7': async (request: Request) => {
      sent.push(await request.json())
      return stored
    },
  })
}

const showEdit = (stored: object, sent: unknown[]) =>
  showPage(server(stored, sent), '/mortgages/7/edit', {
    '/mortgages/:id/edit': <EditMortgagePage />,
  })

async function save() {
  const button = screen.getByRole('button', { name: /^Save/ }) as HTMLButtonElement
  await vi.waitFor(() => expect(button.disabled).toBe(false), { timeout: 2000 })
  fireEvent.click(button)
}

test('a Mortgage made before Lent Through shows none, and setting it to Cash is previewed, so warned about first', async () => {
  const sent: unknown[] = []
  showEdit({ ...mortgage, lent_through: null }, sent)

  const lent = (await screen.findByLabelText('Lent Through')) as HTMLSelectElement
  await vi.waitFor(() => expect(lent.disabled).toBe(false))
  expect(lent.selectedOptions[0].textContent).toBe('—')
  fireEvent.change(lent, { target: { value: 'cash' } })
  await save()
  const warning = await screen.findByRole('dialog', { name: '₹50,000 in cash' })
  fireEvent.click(within(warning).getByRole('button', { name: 'Record in cash anyway' }))
  const confirmation = await screen.findByRole('dialog', { name: /Save changes/ })
  expect(within(confirmation).getByText('— → Cash')).toBeTruthy()
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm and save' }))

  await screen.findByText('Now at /mortgages/7')
  expect(sent).toEqual([expect.objectContaining({ lent_through: 'cash' })])
})

test('a closed Mortgage shows its Terms as locked, with the start date and Principal', async () => {
  showEdit({ ...mortgage, status: 'redeemed' }, [])

  await screen.findByRole('heading', { name: `Edit ${mortgage.name}` })
  expect(
    screen.getByText((text) =>
      text.includes('It is redeemed, so its start date, Principal and Terms stay as they were'),
    ),
  ).toBeTruthy()
  expect((screen.getByLabelText('Start date') as HTMLInputElement).disabled).toBe(true)
  expect((screen.getByLabelText('Principal lent (₹)') as HTMLInputElement).disabled).toBe(true)
  expect((screen.getByLabelText('Monthly interest rate (%)') as HTMLInputElement).disabled).toBe(
    true,
  )
  expect((screen.getByLabelText('Interest Mode') as HTMLSelectElement).disabled).toBe(true)
  expect(
    (
      screen.getByLabelText(
        'Part-Month Rule (Interest to Date for the month under way)',
      ) as HTMLSelectElement
    ).disabled,
  ).toBe(true)
})

test('a Mortgage closing mid-edit drops the stale Terms draft, keeping other edits', async () => {
  let status: 'active' | 'redeemed' = 'active'
  const state = showPage(
    fakeServer({
      'GET /api/mortgages/7': () => ({ ...mortgage, status }),
      'GET /api/payment-methods': [{ method: 'upi', name: 'UPI' }],
      'GET /api/settings/cash-limit': { cash_limit: 2_000_000 },
    }),
    '/mortgages/7/edit',
    { '/mortgages/:id/edit': <EditMortgagePage /> },
  )

  const rate = (await screen.findByLabelText('Monthly interest rate (%)')) as HTMLInputElement
  await vi.waitFor(() => expect(rate.disabled).toBe(false))
  fireEvent.change(rate, { target: { value: '2.5' } })
  const description = screen.getByLabelText('Description of the jewellery') as HTMLTextAreaElement
  fireEvent.change(description, { target: { value: 'Gold chain, re-weighed' } })
  expect(rate.value).toBe('2.5')

  status = 'redeemed'
  await state.queryClient.refetchQueries({ queryKey: ['mortgage', 7] })

  await vi.waitFor(() => expect(rate.disabled).toBe(true))
  expect(rate.value).toBe('1.5') // the saved rate, not the stale 2.5 draft
  expect(description.value).toBe('Gold chain, re-weighed') // unrelated edits survive
})
