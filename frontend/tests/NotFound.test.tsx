// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { AppRoutes } from '../src/App'
import { typedFakeServer as fakeServer } from './typedFakeServer'
import { showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('an unknown address shows Page not found, the address asked for, and ways back', async () => {
  showPage(fakeServer({}), '/foo/bar', { '/*': <AppRoutes /> })

  expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy()
  expect(screen.getByText('/foo/bar')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('href')).toBe('/')
  expect(screen.getByRole('link', { name: 'Customers' }).getAttribute('href')).toBe('/customers')
})

test.each([
  ['/mortgages/99999', 'No Mortgage 99999'],
  ['/mortgages/99999/edit', 'No Mortgage 99999'],
  ['/mortgages/99999/redeem', 'No Mortgage 99999'],
  ['/mortgages/99999/terms', 'No Mortgage 99999'],
  ['/customers/99999', 'No Customer 99999'],
  ['/customers/99999/edit', 'No Customer 99999'],
  ['/payments/99999', 'No Payment 99999'],
  ['/payments/99999/receipt', 'No Payment 99999'],
  [
    '/payments/99999/advance-instalments/4/receipt',
    'No Receipt for Advance Instalment 4 of Payment 99999',
  ],
  ['/referrers/99999', 'No Referrer 99999'],
])('%s, unknown to the backend, shows %s', async (at, heading) => {
  showPage(fakeServer({}), at, { '/*': <AppRoutes /> })

  expect(await screen.findByRole('heading', { name: heading })).toBeTruthy()
  expect(screen.getByText(at)).toBeTruthy()
  expect(screen.queryByText('Not Found')).toBeNull()
})

test('any other refusal still shows what the backend said', async () => {
  const failing = Response.json({ detail: 'Database is locked' }, { status: 500 })
  showPage(fakeServer({ 'GET /api/mortgages/{mortgage_id}': failing }), '/mortgages/7', {
    '/*': <AppRoutes />,
  })

  expect(await screen.findByText('Database is locked')).toBeTruthy()
  expect(screen.queryByRole('heading')).toBeNull()
})
