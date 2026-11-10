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

test('the Discount confirmation limit is shown in rupees, changed, and cleared', async () => {
  const saved: unknown[] = []
  const server = fakeServer({
    'GET /api/settings/discount-confirmation-limit': { discount_confirmation_limit: 50_000 },
    'PUT /api/settings/discount-confirmation-limit': async (request: Request) => {
      const body = await request.json()
      saved.push(body)
      return body
    },
  })
  showPage(server, '/settings', { '/settings': <SettingsPage /> })
  const section = (await screen.findByRole('heading', { name: 'Discount confirmation' })).closest(
    'section',
  )!

  const limit = await within(section).findByLabelText('Ask when Discount exceeds (₹)')
  expect((limit as HTMLInputElement).value).toBe('500')

  fireEvent.change(limit, { target: { value: '750' } })
  fireEvent.click(within(section).getByRole('button', { name: 'Save' }))
  const changeDialog = await screen.findByRole('dialog')
  expect(within(changeDialog).getByText('₹750')).toBeTruthy()
  fireEvent.click(within(changeDialog).getByRole('button', { name: 'Confirm and save' }))
  expect(await within(section).findByText('Saved.')).toBeTruthy()
  expect((within(section).getByLabelText('Ask when Discount exceeds (₹)') as HTMLInputElement).value).toBe(
    '750',
  )

  fireEvent.change(limit, { target: { value: '' } })
  fireEvent.click(within(section).getByRole('button', { name: 'Save' }))
  const clearDialog = await screen.findByRole('dialog')
  expect(within(clearDialog).getByText('Never')).toBeTruthy()
  fireEvent.click(within(clearDialog).getByRole('button', { name: 'Confirm and save' }))

  expect(await within(section).findByText('Saved.')).toBeTruthy()
  expect(saved).toEqual([
    { discount_confirmation_limit: 75_000 },
    { discount_confirmation_limit: null },
  ])
})

test("unprotected Backups warn that they hold Customers' ID Photos", async () => {
  showPage(
    fakeServer({
      'GET /api/backups': {
        enabled: true, encrypted: false, running: false, last_backup_at: null,
        last_backup_file: null, last_error: null, keep: 4,
      },
    }),
    '/settings',
    { '/settings': <SettingsPage /> },
  )

  expect(
    await screen.findByText("Backups hold Customers' ID Photos: keep the Backup folder private.", {
      exact: false,
    }),
  ).toBeTruthy()
})

test('the Grace Period is empty (off) unless set, and can be set and cleared', async () => {
  const saved: unknown[] = []
  const server = fakeServer({
    'GET /api/settings/grace-period': { grace_period_days: null },
    'PUT /api/settings/grace-period': async (request: Request) => {
      const body = await request.json()
      saved.push(body)
      return body
    },
  })
  showPage(server, '/settings', { '/settings': <SettingsPage /> })
  const section = (await screen.findByRole('heading', { name: 'Grace Period' })).closest('section')!

  const days = (await within(section).findByLabelText('Grace Period (days)')) as HTMLInputElement
  expect(days.value).toBe('')

  fireEvent.change(days, { target: { value: '3' } })
  fireEvent.click(within(section).getByRole('button', { name: 'Save' }))
  const setDialog = await screen.findByRole('dialog')
  expect(within(setDialog).getByText('3 days')).toBeTruthy()
  fireEvent.click(within(setDialog).getByRole('button', { name: 'Confirm and save' }))
  expect(await within(section).findByText('Saved.')).toBeTruthy()
  expect(days.value).toBe('3')

  fireEvent.change(days, { target: { value: '' } })
  fireEvent.click(within(section).getByRole('button', { name: 'Save' }))
  const clearDialog = await screen.findByRole('dialog')
  expect(within(clearDialog).getByText('None: no Grace')).toBeTruthy()
  fireEvent.click(within(clearDialog).getByRole('button', { name: 'Confirm and save' }))

  expect(await within(section).findByText('Saved.')).toBeTruthy()
  expect(saved).toEqual([{ grace_period_days: 3 }, { grace_period_days: null }])
})

test('a Grace Period of 0 days saves as off', async () => {
  const saved: unknown[] = []
  const server = fakeServer({
    'GET /api/settings/grace-period': { grace_period_days: 5 },
    'PUT /api/settings/grace-period': async (request: Request) => {
      saved.push(await request.json())
      return { grace_period_days: null }
    },
  })
  showPage(server, '/settings', { '/settings': <SettingsPage /> })
  const section = (await screen.findByRole('heading', { name: 'Grace Period' })).closest('section')!

  const days = (await within(section).findByLabelText('Grace Period (days)')) as HTMLInputElement
  expect(days.value).toBe('5')
  fireEvent.change(days, { target: { value: '0' } })
  fireEvent.click(within(section).getByRole('button', { name: 'Save' }))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('None: no Grace')).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and save' }))

  expect(await within(section).findByText('Saved.')).toBeTruthy()
  expect(saved).toEqual([{ grace_period_days: 0 }])
  expect(days.value).toBe('')
})

test.each(['-1', '1.5'])('a Grace Period of %s days is refused before saving', async (typed) => {
  const server = fakeServer({ 'GET /api/settings/grace-period': { grace_period_days: null } })
  showPage(server, '/settings', { '/settings': <SettingsPage /> })
  const section = (await screen.findByRole('heading', { name: 'Grace Period' })).closest('section')!

  const days = (await within(section).findByLabelText('Grace Period (days)')) as HTMLInputElement
  fireEvent.change(days, { target: { value: typed } })
  fireEvent.click(within(section).getByRole('button', { name: 'Save' }))

  expect(days.validity.valid).toBe(false)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(server.requests).not.toContain('PUT /api/settings/grace-period')
})

test('a Grace Period the backend refuses shows why', async () => {
  const server = fakeServer({
    'GET /api/settings/grace-period': { grace_period_days: null },
    'PUT /api/settings/grace-period': Response.json(
      {
        detail: [
          {
            loc: ['body', 'grace_period_days'],
            msg: 'Value error, The Grace Period must be a whole number of days, 0 or more',
          },
        ],
      },
      { status: 422 },
    ),
  })
  showPage(server, '/settings', { '/settings': <SettingsPage /> })
  const section = (await screen.findByRole('heading', { name: 'Grace Period' })).closest('section')!

  fireEvent.change(await within(section).findByLabelText('Grace Period (days)'), {
    target: { value: '4' },
  })
  fireEvent.click(within(section).getByRole('button', { name: 'Save' }))
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm and save' }),
  )

  expect(
    await within(section).findByText(/The Grace Period must be a whole number of days, 0 or more/),
  ).toBeTruthy()
})
