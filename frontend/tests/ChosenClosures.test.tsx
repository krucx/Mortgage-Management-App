// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ForfeitChosen } from '../src/pages/closures/ForfeitChosen'
import { WaiveChosen } from '../src/pages/closures/WaiveChosen'
import { fakeServer } from './fakeServer'
import { showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const chosen = [
  { id: 3, name: '2025-Arjun-GoldRing' },
  { id: 4, name: '2025-Arjun-Bangles' },
]

test('WaiveChosen renders its fields for the chosen Mortgages', async () => {
  showPage(fakeServer({}), '/', { '/': <WaiveChosen chosen={chosen} onDone={() => {}} /> })

  expect(await screen.findByText('Waive off the 2 chosen')).toBeTruthy()
  expect(screen.getByLabelText('Received now for 2025-Arjun-GoldRing')).toBeTruthy()
  expect(screen.getByLabelText('Received now for 2025-Arjun-Bangles')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Waive off 2' })).toBeTruthy()
})

test('ForfeitChosen renders its fields for the chosen Mortgages', async () => {
  showPage(fakeServer({}), '/', { '/': <ForfeitChosen chosen={chosen} onDone={() => {}} /> })

  expect(await screen.findByText('Forfeit the 2 chosen')).toBeTruthy()
  expect(screen.getByLabelText('Recovered Amount for 2025-Arjun-GoldRing')).toBeTruthy()
  expect(screen.getByLabelText('Recovered Amount for 2025-Arjun-Bangles')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Forfeit 2' })).toBeTruthy()
})

test('WaiveChosen renders method and reference fields after a final Payment is entered', async () => {
  showPage(fakeServer({}), '/', { '/': <WaiveChosen chosen={chosen} onDone={() => {}} /> })

  fireEvent.change(await screen.findByLabelText('Received now for 2025-Arjun-GoldRing'), {
    target: { value: '1' },
  })
  expect(screen.getByLabelText('Final Payments made by')).toBeTruthy()
  expect(screen.getByLabelText('Reference (for all)')).toBeTruthy()
})
