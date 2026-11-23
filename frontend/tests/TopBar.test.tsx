// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { TopBar } from '../src/components/TopBar'
import styles from '../src/components/TopBar.module.css'
import { APP_VERSION } from '../src/version'
import { fakeServer } from './fakeServer'
import { showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
})

const server = () =>
  fakeServer({ 'GET /api/closures/dormant': { items: [], total: 0, page: 1, page_size: 20 } })

test('the top bar names the app, links home, shows the version, the pages and the theme switch', async () => {
  showPage(server(), '/', { '/': <TopBar /> })

  const bar = screen.getByRole('banner')
  const title = within(bar).getByRole('heading', { level: 1 })
  expect(
    within(title).getByRole('link', { name: 'Mortgage Management' }).getAttribute('href'),
  ).toBe('/')
  expect(within(title).getByTitle(`Version ${APP_VERSION}`).textContent).toBe(`v${APP_VERSION}`)
  expect(within(bar).getByRole('navigation')).toBeTruthy()
  expect(
    within(bar).getByRole('button', { name: /^Switch to the (light|dark) theme$/ }),
  ).toBeTruthy()
})

test('the top bar is styled by its own scoped classes', () => {
  showPage(server(), '/', { '/': <TopBar /> })

  const bar = screen.getByRole('banner')
  expect(styles.bar).toBeTruthy()
  expect(bar.className).toBe(styles.bar)
  expect(screen.getByRole('heading', { level: 1 }).className).toBe(styles.title)
})
