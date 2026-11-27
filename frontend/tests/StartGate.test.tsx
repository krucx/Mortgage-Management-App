// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { ServerStateProvider } from '../src/components/ServerStateProvider'
import { StartGate, type StartGateProps } from '../src/components/StartGate'
import { createServerState } from '../src/serverState'
import { type FakeServer } from './fakeServer'
import { typedFakeServer as fakeServer } from './typedFakeServer'

afterEach(cleanup)

/** Fetch itself fails, as it does when nothing answers on the laptop. */
const nothingAnswers = () => {
  throw new TypeError('Failed to fetch')
}

/** The backend's Health; `problem` makes it a 503, as when the database can't be reached. */
const health = (problem?: string) =>
  Response.json(
    {
      status: problem ? 'unavailable' : 'ok',
      database: problem ? { connected: false, error: problem } : { connected: true },
      migrations: null,
      backups: { enabled: true, running: false },
    },
    { status: problem ? 503 : 200 },
  )

/** A backend that is stopped until `start()`: until then it answers as `stopped` does,
 *  and then with `running`. */
function backend(
  stopped: () => Response | Promise<Response> = nothingAnswers,
  running: () => Response | Promise<Response> = health,
) {
  let started = false
  const server = fakeServer({
    'GET /api/health': () => (started ? running() : stopped()),
  })
  return { server, start: () => (started = true) }
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

test('a 502 from a proxy in front of a stopped backend counts as stopped, and the app loads once it answers', async () => {
  const { server, start } = backend(() => new Response('Bad Gateway', { status: 502 }))
  const { reloads } = showGate(server)

  expect(await screen.findByRole('button', { name: 'Start Mortgage Management' })).toBeTruthy()
  expect(screen.queryByText('The app')).toBeNull()

  start()
  await waitFor(() => expect(reloads()).toBe(1))
})

test('a backend whose Health reports a problem (503) still answers: the app opens', async () => {
  const { server, start } = backend(nothingAnswers, () =>
    health('OperationalError: could not connect to server'),
  )
  start()
  showGate(server)

  expect(await screen.findByText('The app')).toBeTruthy()
})

test('the app loads once the backend answers, even with a Health reporting a problem', async () => {
  const { server, start } = backend(nothingAnswers, () => health('schema behind head'))
  const { reloads } = showGate(server)

  expect(await screen.findByRole('button', { name: 'Start Mortgage Management' })).toBeTruthy()
  start()
  await waitFor(() => expect(reloads()).toBe(1))
})

test('a bare 503 from a proxy, with no Health, counts as stopped', async () => {
  const { server, start } = backend(() => new Response('Service Unavailable', { status: 503 }))
  const { reloads } = showGate(server)

  expect(await screen.findByRole('button', { name: 'Start Mortgage Management' })).toBeTruthy()
  expect(screen.queryByText('The app')).toBeNull()

  start()
  await waitFor(() => expect(reloads()).toBe(1))
})

test('a JSON error from a proxy that is not a Health counts as stopped', async () => {
  const { server } = backend(() => Response.json({ detail: 'Bad Gateway' }, { status: 502 }))
  showGate(server)

  expect(await screen.findByRole('button', { name: 'Start Mortgage Management' })).toBeTruthy()
})
