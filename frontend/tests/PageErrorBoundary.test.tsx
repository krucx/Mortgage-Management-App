// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AppRoutes } from '../src/App'
import { TopBar } from '../src/components/TopBar'
import { fakeServer } from './fakeServer'
import { showPage } from './showPage'

// Rendering the Dashboard fails while `broken.dashboard` is set; every other page is untouched.
const broken = vi.hoisted(() => ({ dashboard: true }))
vi.mock('../src/pages/DashboardPage', () => ({
  DashboardPage: () => {
    if (broken.dashboard) throw new Error('Cannot read properties of undefined')
    return <h2>Dashboard is back</h2>
  },
}))

beforeEach(() => {
  broken.dashboard = true
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  // React and the boundary log the error they catch; that is expected here.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const server = () =>
  fakeServer({ 'GET /api/closures/dormant': { items: [], total: 0, page: 1, page_size: 20 } })

const showApp = (at: string) =>
  showPage(server(), at, {
    '/*': (
      <>
        <TopBar />
        <main>
          <AppRoutes />
        </main>
      </>
    ),
  })

test('a page that fails to display shows an explanation instead of a blank screen', () => {
  showApp('/')

  expect(screen.getByRole('heading', { name: 'This page could not be displayed' })).toBeTruthy()
  expect(screen.getByRole('alert').textContent).toContain('Something went wrong')
})

test('the top bar stays on screen and working while the page has failed', () => {
  showApp('/')

  const bar = screen.getByRole('banner')
  expect(within(bar).getByRole('link', { name: 'Mortgage Management' })).toBeTruthy()
  expect(within(bar).getByRole('navigation')).toBeTruthy()
  const toggle = within(bar).getByRole('button', { name: /^Switch to the (light|dark) theme$/ })
  fireEvent.click(toggle)
  expect(
    within(bar).getByRole('button', { name: /^Switch to the (light|dark) theme$/ }),
  ).toBeTruthy()
})

test('Reload page reloads the app', () => {
  const reload = vi.fn()
  vi.stubGlobal('location', { ...window.location, reload })
  showApp('/')

  fireEvent.click(screen.getByRole('button', { name: 'Reload page' }))

  expect(reload).toHaveBeenCalledOnce()
})

test('Return to Dashboard shows the Dashboard again once it can be displayed', () => {
  showApp('/')
  broken.dashboard = false

  const back = screen.getByRole('link', { name: 'Return to Dashboard' })
  expect(back.getAttribute('href')).toBe('/')
  fireEvent.click(back)

  expect(screen.getByRole('heading', { name: 'Dashboard is back' })).toBeTruthy()
})

test('leaving a failed page by the navigation shows the next page, not the failure', async () => {
  showApp('/')

  fireEvent.click(screen.getByRole('link', { name: 'Customers' }))

  expect(screen.queryByRole('heading', { name: 'This page could not be displayed' })).toBeNull()
})

test('the technical error and where it happened are in a collapsed section', () => {
  showApp('/')

  const details = screen.getByText('Technical details').closest('details')!
  expect(details.open).toBe(false)
  expect(details.textContent).toContain('Cannot read properties of undefined')
  expect(details.textContent).toContain('Component stack')
})
