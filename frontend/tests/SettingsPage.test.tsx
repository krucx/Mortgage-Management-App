// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { Terms } from '../src/api'
import { SettingsPage } from '../src/pages/SettingsPage'
import { fakeServer } from './fakeServer'
import { showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('the Default Terms are loaded, changed and saved, and the saved ones are shown', async () => {
  const saved: Terms[] = []
  const server = fakeServer({
    'GET /api/settings/default-terms': {
      monthly_rate_bps: 150,
      interest_mode: 'simple',
      part_month_rule: 'pro_rata',
    },
    'PUT /api/settings/default-terms': async (request: Request) => {
      saved.push(await request.json())
      // The backend's answer is what is shown after saving.
      return { ...saved[0], monthly_rate_bps: 175 }
    },
  })
  showPage(server, '/settings', { '/settings': <SettingsPage /> })
  const terms = (await screen.findByRole('heading', { name: 'Default Terms' })).closest('section')!

  const rate = await within(terms).findByLabelText('Monthly interest rate (%)')
  expect((rate as HTMLInputElement).value).toBe('1.5')
  fireEvent.change(rate, { target: { value: '1.8' } })
  fireEvent.click(within(terms).getByRole('button', { name: 'Save' }))
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm and save' }),
  )

  expect(await within(terms).findByText(/Saved\. New Mortgages will start/)).toBeTruthy()
  expect(saved).toEqual([{ monthly_rate_bps: 180, interest_mode: 'simple', part_month_rule: 'pro_rata' }])
  expect((within(terms).getByLabelText('Monthly interest rate (%)') as HTMLInputElement).value).toBe('1.75')
})

test('the Cash Limit is shown in rupees, and clearing it saves no limit', async () => {
  const saved: unknown[] = []
  const server = fakeServer({
    'GET /api/settings/cash-limit': { cash_limit: 2_000_000 },
    'PUT /api/settings/cash-limit': async (request: Request) => {
      saved.push(await request.json())
      return { cash_limit: null }
    },
  })
  showPage(server, '/settings', { '/settings': <SettingsPage /> })
  const section = (await screen.findByRole('heading', { name: 'Cash Limit' })).closest('section')!

  const limit = await within(section).findByLabelText('Warn at cash of (₹), or more')
  expect((limit as HTMLInputElement).value).toBe('20000')
  fireEvent.change(limit, { target: { value: '' } })
  fireEvent.click(within(section).getByRole('button', { name: 'Save' }))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('Never: no warning for cash')).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and save' }))

  expect(await within(section).findByText('Saved.')).toBeTruthy()
  expect(saved).toEqual([{ cash_limit: null }])
})
