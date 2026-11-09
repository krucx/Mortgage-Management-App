// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { MortgagePreview, TermChangeIn } from '../src/api'
import { ChangeTermsPage } from '../src/pages/ChangeTermsPage'
import { MortgagePage } from '../src/pages/MortgagePage'
import { changePreview, fakeServer } from './fakeServer'
import { mortgage, showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const side = (outstanding: number) => ({ outstanding, points: [], term_changes: [], closure: null })
const preview: MortgagePreview = {
  mortgage_id: 7,
  mortgage_name: mortgage.name,
  before: side(5_075_000),
  after: side(5_075_000),
  ledger_changes: [],
  discount_room: 0,
  over_threshold: false,
}

test('a new rate is previewed, then saved as a Term Change from the chosen Accrual Date', async () => {
  const previewed: TermChangeIn[] = []
  const saved: TermChangeIn[] = []
  const server = fakeServer({
    'GET /api/mortgages/7': mortgage,
    'POST /api/mortgages/7/term-changes/preview': async (request: Request) => {
      previewed.push(await request.json())
      return changePreview([preview])
    },
    'POST /api/mortgages/7/term-changes': async (request: Request) => {
      saved.push(await request.json())
      return mortgage
    },
  })
  showPage(server, '/mortgages/7/terms', { '/mortgages/:id/terms': <ChangeTermsPage /> })

  fireEvent.change(await screen.findByLabelText('Monthly interest rate (%)'), {
    target: { value: '2' },
  })

  expect(await screen.findByText(/No change to the Ledger so far/, {}, { timeout: 2000 }))
  expect(previewed.at(-1)).toMatchObject({ effective_on: '2099-11-10', monthly_rate_bps: 200 })

  fireEvent.click(screen.getByRole('button', { name: 'Save Term Change' }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and save' }))

  expect(await screen.findByText('Now at /mortgages/7')).toBeTruthy()
  expect(saved).toEqual([previewed.at(-1)])
})

test('back on the Mortgage page, the saved Term Change shows at once, before the Mortgage is asked for again', async () => {
  const changed = {
    ...mortgage,
    term_changes: [
      {
        id: 1,
        effective_on: '2099-11-10',
        terms: { ...mortgage.terms, monthly_rate_bps: 200 },
        removable: true,
      },
    ],
  }
  let saved = false
  const server = fakeServer({
    // Once saved, asking again never answers: only what the save returned can be shown.
    'GET /api/mortgages/7': () => (saved ? new Promise(() => {}) : mortgage),
    'POST /api/mortgages/7/term-changes/preview': changePreview([preview]),
    'POST /api/mortgages/7/term-changes': () => {
      saved = true
      return changed
    },
  })
  showPage(server, '/mortgages/7', {
    '/mortgages/:id': <MortgagePage />,
    '/mortgages/:id/terms': <ChangeTermsPage />,
  })
  fireEvent.click(await screen.findByRole('link', { name: 'Change Terms…' }))

  fireEvent.change(await screen.findByLabelText('Monthly interest rate (%)'), {
    target: { value: '2' },
  })
  await screen.findByText(/No change to the Ledger so far/, {}, { timeout: 2000 })
  fireEvent.click(screen.getByRole('button', { name: 'Save Term Change' }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and save' }))

  expect(await screen.findByText('coming')).toBeTruthy()
})

const withComingChange = {
  ...mortgage,
  term_changes: [
    {
      id: 4,
      effective_on: '2099-11-10',
      terms: { ...mortgage.terms, monthly_rate_bps: 200 },
      removable: true,
    },
  ],
}

/** The Mortgage page with a coming Term Change, whose removal is previewed then made. */
function showComingChange() {
  let removed = false
  const server = fakeServer({
    'GET /api/mortgages/7': () => (removed ? mortgage : withComingChange),
    'POST /api/mortgages/7/term-changes/4/remove-preview': changePreview([preview]),
    'DELETE /api/mortgages/7/term-changes/4': () => {
      removed = true
      return mortgage
    },
  })
  showPage(server, '/mortgages/7', { '/mortgages/:id': <MortgagePage /> })
  return server
}

test('a coming Term Change is removed from the Terms panel after its removal is previewed', async () => {
  const server = showComingChange()

  fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
  const dialog = await screen.findByRole('dialog', { name: 'Remove the Term Change from 10 Nov 2099?' })
  expect(await within(dialog).findByText(/No change to the Ledger so far/)).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))

  await vi.waitFor(() => expect(screen.queryByText('coming')).toBeNull())
  expect(screen.queryByText(/From 10 Nov 2099/)).toBeNull()
  expect(server.requests).toContain('POST /api/mortgages/7/term-changes/4/remove-preview')
  expect(server.requests).toContain('DELETE /api/mortgages/7/term-changes/4')
})

test('cancelling leaves the coming Term Change as it was', async () => {
  const server = showComingChange()

  fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.getByText('coming')).toBeTruthy()
  expect(server.requests).not.toContain('DELETE /api/mortgages/7/term-changes/4')
})
