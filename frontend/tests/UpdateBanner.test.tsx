// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { ServerStateProvider } from '../src/components/ServerStateProvider'
import { UpdateBanner, type UpdateBannerProps } from '../src/components/UpdateBanner'
import { createServerState } from '../src/serverState'
import { fakeServer, type FakeServer } from './fakeServer'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const NOTES = '### Added\n\n- Safe updates.'

/** The backend's answer to "is there a newer release?". */
function update(running: string, available: string | null) {
  return { running, available: available && { version: available, notes: NOTES } }
}

/** The banner, checking every few milliseconds rather than seconds. */
function showBanner(server: FakeServer, props: Partial<UpdateBannerProps> = {}) {
  const opened: string[] = []
  let reloads = 0
  const view = () => (
    <ServerStateProvider state={createServerState({ fetch: server.fetch, retry: false })}>
      <UpdateBanner
        openLink={(link) => opened.push(link)}
        reload={() => reloads++}
        onWindows
        checkEveryMs={5}
        {...props}
      />
    </ServerStateProvider>
  )
  const { unmount } = render(view())
  return { opened, reloads: () => reloads, reopen: () => (unmount(), render(view())) }
}

test('a newer release is offered with its notes', async () => {
  showBanner(fakeServer({ 'GET /api/update': update('1.5.1', '1.6.0') }))

  expect(await screen.findByText('Version 1.6.0 is available')).toBeTruthy()
  expect(screen.getByText(/Safe updates/)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Install now' })).toBeTruthy()
})

test('nothing is shown when the running version is the newest', async () => {
  const server = fakeServer({ 'GET /api/update': update('1.6.0', null) })
  showBanner(server)

  await waitFor(() => expect(server.requests).toContain('GET /api/update'))
  expect(screen.queryByText(/is available/)).toBeNull()
})

test('Later hides it until a newer version than the one put off', async () => {
  let newest = '1.6.0'
  const server = fakeServer({ 'GET /api/update': () => update('1.5.1', newest) })
  const { reopen } = showBanner(server)

  fireEvent.click(await screen.findByRole('button', { name: 'Later' }))
  expect(screen.queryByText(/is available/)).toBeNull()

  reopen()
  await waitFor(() => expect(server.requests.length).toBe(2))
  expect(screen.queryByText(/is available/)).toBeNull()

  newest = '1.6.1'
  reopen()
  expect(await screen.findByText('Version 1.6.1 is available')).toBeTruthy()
})

/** A backend running `version`, that can be stopped and started as another. */
function backend(version: string) {
  let running: string | null = version
  const server = fakeServer({
    'GET /api/update': () => {
      if (!running) throw new TypeError('Failed to fetch')
      return update(running, running === '1.5.1' ? '1.6.0' : null)
    },
  })
  return { server, run: (as: string | null) => (running = as) }
}

test('Install now runs Setup through the link, and loads the app once the new version runs', async () => {
  const { server, run } = backend('1.5.1')
  const { opened, reloads } = showBanner(server)

  fireEvent.click(await screen.findByRole('button', { name: 'Install now' }))
  expect(opened).toEqual(['mortgage-management://update'])
  expect(await screen.findByText(/Updating to version 1.6.0/)).toBeTruthy()

  run(null) // stopped by Setup
  await new Promise((wait) => setTimeout(wait, 30))
  expect(reloads()).toBe(0)

  run('1.6.0')
  await waitFor(() => expect(reloads()).toBe(1))
})

test('when the version before comes back instead, it says the update failed', async () => {
  const { server, run } = backend('1.5.1')
  const { reloads } = showBanner(server)

  fireEvent.click(await screen.findByRole('button', { name: 'Install now' }))
  run(null)
  await new Promise((wait) => setTimeout(wait, 30))
  run('1.5.1') // Setup started it again

  expect(await screen.findByText(/Update failed; still on 1.5.1/)).toBeTruthy()
  expect(reloads()).toBe(0)
})

test('when nothing has happened after a while, it says where to look and can try again', async () => {
  const { server } = backend('1.5.1')
  const { opened } = showBanner(server, { giveUpAfterMs: 30 })

  fireEvent.click(await screen.findByRole('button', { name: 'Install now' }))

  expect(await screen.findByText(/hasn't finished/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Install now' }))
  expect(opened).toEqual(['mortgage-management://update', 'mortgage-management://update'])
})

test('the app loads whichever new version Setup installed, even one newer than offered', async () => {
  const { server, run } = backend('1.5.1')
  const { reloads } = showBanner(server)

  fireEvent.click(await screen.findByRole('button', { name: 'Install now' }))
  run(null)
  await new Promise((wait) => setTimeout(wait, 30))
  run('1.6.1') // released while the banner was showing 1.6.0

  await waitFor(() => expect(reloads()).toBe(1))
})

test('the notes read as the changelog does, without its Markdown marks', async () => {
  const notes =
    'Safer updates.\n\n### Added\n\n- **Update banner:** see `Install now`, or the\n  [install guide](https://example.org).\n- Start from the icon.'
  showBanner(
    fakeServer({ 'GET /api/update': { running: '1.5.1', available: { version: '2.0.0', notes } } }),
  )

  expect(await screen.findByRole('heading', { name: 'Added' })).toBeTruthy()
  const items = screen.getAllByRole('listitem').map((item) => item.textContent)
  expect(items).toEqual([
    'Update banner: see Install now, or the install guide.',
    'Start from the icon.',
  ])
  expect(screen.getByText('Update banner:').tagName).toBe('STRONG')
  expect(screen.queryByText(/\*\*|###|\]\(/)).toBeNull()
})
