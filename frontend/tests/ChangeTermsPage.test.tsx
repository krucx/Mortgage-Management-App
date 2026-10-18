// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { MortgagePreview, TermChangeIn } from '../src/api'
import { ChangeTermsPage } from '../src/pages/ChangeTermsPage'
import { MortgagePage } from '../src/pages/MortgagePage'
import { fakeServer } from './fakeServer'
import { mortgage, showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const side = (outstanding: number) => ({ outstanding, points: [], term_changes: [] })
const preview: MortgagePreview = {
  mortgage_id: 7,
  mortgage_name: mortgage.name,
  before: side(5_075_000),
  after: side(5_075_000),
  ledger_changes: [],
}

test('a new rate is previewed, then saved as a Term Change from the chosen Accrual Date', async () => {
  const previewed: TermChangeIn[] = []
  const saved: TermChangeIn[] = []
  const server = fakeServer({
    'GET /api/mortgages/7': mortgage,
    'POST /api/mortgages/7/term-changes/preview': async (request: Request) => {
      previewed.push(await request.json())
      return [preview]
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
    'POST /api/mortgages/7/term-changes/preview': [preview],
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
