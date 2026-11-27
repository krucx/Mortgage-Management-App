// @vitest-environment jsdom
import { cleanup, renderHook, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import { AppRoutes } from '../src/App'
import { useNumericId } from '../src/useNumericId'
import { typedFakeServer as fakeServer } from './typedFakeServer'
import { showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const at =
  (path: string, route: string) =>
  ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={children} />
      </Routes>
    </MemoryRouter>
  )

test('reads a whole number from the route', () => {
  const { result } = renderHook(() => useNumericId(), {
    wrapper: at('/mortgages/42', '/mortgages/:id'),
  })
  expect(result.current).toBe(42)
})

test('reads a named parameter', () => {
  const { result } = renderHook(() => useNumericId('instalment'), {
    wrapper: at('/p/3/i/4', '/p/:id/i/:instalment'),
  })
  expect(result.current).toBe(4)
})

test.each(['abc', '0', '-5', '1.5', '1e3', ' '])('refuses %j', (bad) => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(() =>
    renderHook(() => useNumericId(), {
      wrapper: at('/mortgages/' + encodeURIComponent(bad), '/mortgages/:id'),
    }),
  ).toThrow()
})

test('refuses a parameter the route does not have', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(() =>
    renderHook(() => useNumericId(), { wrapper: at('/mortgages', '/mortgages') }),
  ).toThrow()
})

test.each([
  '/mortgages/abc',
  '/mortgages/abc/edit',
  '/mortgages/-1/redeem',
  '/mortgages/0/terms',
  '/customers/abc',
  '/payments/abc',
  '/payments/abc/receipt',
  '/referrers/abc',
])('%s shows Page not found and asks the backend nothing', async (path) => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const server = fakeServer({})
  showPage(server, path, { '/*': <AppRoutes /> })

  expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy()
  expect(server.requests).toEqual([])
})
