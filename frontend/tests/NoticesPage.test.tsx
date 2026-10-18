// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { Notice } from '../src/api'
import { NoticesPage } from '../src/pages/NoticesPage'
import { fakeServer } from './fakeServer'
import { showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const notice: Notice = {
  id: 1,
  customer: { kind: 'customer', id: 6, name: 'Sunita Rao' },
  phones: ['9860067890'],
  accrues_on: '2026-10-21',
  created_on: '2026-10-19',
  status: 'queued',
  message: 'Namaste Sunita Rao, interest of ₹700 will be added on 21 Oct 2026.',
  mortgages: [{ id: 8, name: '2026-Sunita-Mangalsutra' }],
  sent_at: null,
}

test("a Notice to send has a compact WhatsApp button in its row that opens the message", async () => {
  const server = fakeServer({
    'GET /api/notices': { items: [notice], total: 1, page: 1, page_size: 20 },
  })
  showPage(server, '/notices?status=queued', { '/notices': <NoticesPage /> })

  const send = await screen.findByRole('button', { name: 'Send on WhatsApp' })
  expect(send.textContent?.trim()).toBe('Send')
  expect(within(send.closest('tr')!).getByRole('button', { name: 'Skip' })).toBeTruthy()

  fireEvent.click(send)
  expect(await screen.findByRole('heading', { name: 'Notice to Sunita Rao' })).toBeTruthy()
})
