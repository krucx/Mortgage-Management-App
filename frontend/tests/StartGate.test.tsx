// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { ServerStateProvider } from '../src/components/ServerStateProvider'
import { StartGate, type StartGateProps } from '../src/components/StartGate'
import { createServerState } from '../src/serverState'
import { fakeServer, type FakeServer } from './fakeServer'

afterEach(cleanup)

/** A backend that is stopped until `start()`: until then fetch itself fails, as it does
 *  when nothing answers on the laptop. */
function backend() {
  let running = false
  const server = fakeServer({
    'GET /api/payment-methods': () => {
      if (!running) throw new TypeError('Failed to fetch')
      return []
    },
  })
  return { server, start: () => (running = true) }
}

/** The app inside the gate, checking every few milliseconds rather than seconds. */
function showGate(server: FakeServer, props: Partial<StartGateProps> = {}) {
  const opened: string[] = []
  let reloads = 0
  render(
    <ServerStateProvider state={createServerState({ fetch: server.fetch, retry: false })}>
      <StartGate
        openLink={(link) => opened.push(link)}
        reload={() => reloads++}
        checkEveryMs={5}
        onWindows
        {...props}
      >
        <p>The app</p>
      </StartGate>
    </ServerStateProvider>,
  )
  return { opened, reloads: () => reloads }
}

test('the app opens as usual when the backend answers', async () => {
  const { server, start } = backend()
  start()
  showGate(server)

  expect(await screen.findByText('The app')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Start Mortgage Management' })).toBeNull()
})

test('when the backend is stopped, Start opens the link, and the app loads once it answers', async () => {
  const { server, start } = backend()
  const { opened, reloads } = showGate(server)

  fireEvent.click(await screen.findByRole('button', { name: 'Start Mortgage Management' }))
  expect(opened).toEqual(['mortgage-management://start'])
  expect(await screen.findByText(/Starting Mortgage Management/)).toBeTruthy()
  expect(reloads()).toBe(0)

  start()
  await waitFor(() => expect(reloads()).toBe(1))
  expect(screen.queryByText('The app')).toBeNull()
})

test('when the app has not started in time, it says how to see what went wrong, and can try again', async () => {
  const { server } = backend()
  const { opened } = showGate(server, { giveUpAfterMs: 30 })

  fireEvent.click(await screen.findByRole('button', { name: 'Start Mortgage Management' }))

  expect(await screen.findByText(/hasn't started.*shortcut on the Desktop/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(opened).toEqual(['mortgage-management://start', 'mortgage-management://start'])
  expect(await screen.findByText(/Starting Mortgage Management/)).toBeTruthy()
})

test('off Windows there is no link to start it with: it says to start the server, and loads once it answers', async () => {
  const { server, start } = backend()
  const { reloads } = showGate(server, { onWindows: false })

  expect(await screen.findByText(/Start its server/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Start Mortgage Management' })).toBeNull()

  start()
  await waitFor(() => expect(reloads()).toBe(1))
})
