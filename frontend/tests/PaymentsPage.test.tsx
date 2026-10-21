// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { PaymentsPage } from '../src/pages/PaymentsPage'
import { fakeServer } from './fakeServer'
import { showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('the Payments filter has a name', async () => {
  showPage(
    fakeServer({ 'GET /api/payments': { items: [], total: 0, page: 1, page_size: 20 } }),
    '/payments',
    { '/payments': <PaymentsPage /> },
  )

  expect(await screen.findByRole('searchbox', { name: 'Filter Payments' })).toBeTruthy()
})
