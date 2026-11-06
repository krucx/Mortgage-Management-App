// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { Nav } from '../src/components/Nav'
import { fakeServer } from './fakeServer'
import { showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const dormant = (total: number) => ({
  'GET /api/closures/dormant': { items: [], total, page: 1, page_size: 20 },
})

test('the Closures tab shows a red dot while any Mortgage is Dormant', async () => {
  showPage(fakeServer(dormant(2)), '/', { '/': <Nav /> })

  expect(await screen.findByLabelText('2 Dormant, to Redeem')).toBeTruthy()
  expect(screen.getByRole('link', { name: /^Closures/ }).getAttribute('href')).toBe('/closures')
})

test('no dot while no Mortgage is Dormant', async () => {
  const server = fakeServer(dormant(0))
  showPage(server, '/', { '/': <Nav /> })

  await vi.waitFor(() => expect(server.requests).toContain('GET /api/closures/dormant'))
  expect(screen.getByRole('link', { name: 'Closures' })).toBeTruthy()
  expect(screen.queryByLabelText(/Dormant/)).toBeNull()
  expect(screen.queryByText('Redeem / Forfeit')).toBeNull()
})

test('the Calculator sits between Mortgages and Call List', async () => {
  showPage(fakeServer(dormant(0)), '/', { '/': <Nav /> })

  const tabs = (await screen.findAllByRole('link')).map((link) => link.textContent)
  expect(tabs.slice(tabs.indexOf('Mortgages'), tabs.indexOf('Call List') + 1)).toEqual([
    'Mortgages',
    'Calculator',
    'Call List',
  ])
  expect(screen.getByRole('link', { name: 'Calculator' }).getAttribute('href')).toBe('/calculator')
})
