// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { MortgagePage } from '../src/pages/MortgagePage'
import { fakeServer, type FakeServer } from './fakeServer'
import { mortgage, showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const showMortgagePage = (server: FakeServer) =>
  showPage(server, '/mortgages/7', { '/mortgages/:id': <MortgagePage /> })

test('the Mortgage page shows what the Mortgage owes', async () => {
  showMortgagePage(fakeServer({ 'GET /api/mortgages/7': mortgage }))

  expect(screen.getByText('Loading…')).toBeTruthy()
  expect(await screen.findByRole('heading', { name: /2026GoldChain/ })).toBeTruthy()
  expect(screen.getByText('₹50,750')).toBeTruthy()
})

test("the Mortgage page shows the backend's reason when it cannot load", async () => {
  showMortgagePage(fakeServer({}))

  expect(await screen.findByText('Not Found')).toBeTruthy()
})

test('deleting a photo asks first, then shows the Mortgage without it', async () => {
  const withPhoto = { ...mortgage, photos: [{ id: 5, url: '/api/photos/mortgage-7-a.jpg' }] }
  const server = fakeServer({
    'GET /api/mortgages/7': withPhoto,
    'DELETE /api/mortgages/7/photos/5': mortgage,
  })
  showMortgagePage(server)

  fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

  expect(await screen.findByText('No photos yet.')).toBeTruthy()
  expect(server.requests).toContain('DELETE /api/mortgages/7/photos/5')
})
