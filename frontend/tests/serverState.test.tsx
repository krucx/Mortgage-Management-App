// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { QueryObserver } from '@tanstack/react-query'
import { afterEach, expect, test } from 'vitest'
import { ServerStateProvider } from '../src/components/ServerStateProvider'
import {
  createServerState,
  dataOrThrow,
  keys,
  LEDGER_CHANGED,
  ledgerChanged,
} from '../src/serverState'
import { fakeServer } from './fakeServer'

afterEach(cleanup)

test('a Ledger change makes every Mortgage, list, the Dashboard and the Ready to Redeem count stale', () => {
  const { queryClient } = createServerState()
  const cached = {
    mortgage: keys.mortgage(7),
    mortgageList: [...keys.lists, 'mortgages', { page: 1 }],
    paymentList: [...keys.lists, 'payments', { page: 2 }],
    dashboard: keys.dashboard,
    readyToRedeem: keys.readyToRedeem,
    goldRates: ['settings', 'gold-rates'],
  }
  for (const key of Object.values(cached)) queryClient.setQueryData(key, {})

  ledgerChanged(queryClient)

  const stale = Object.entries(cached)
    .filter(([, key]) => queryClient.getQueryState(key)?.isInvalidated)
    .map(([name]) => name)
  expect(stale).toEqual(['mortgage', 'mortgageList', 'paymentList', 'dashboard', 'readyToRedeem'])
})

test('a Ledger change saved through the old fetch functions makes the cache stale too', () => {
  const state = createServerState()
  render(<ServerStateProvider state={state}>{null}</ServerStateProvider>)
  state.queryClient.setQueryData(keys.mortgage(7), {})

  window.dispatchEvent(new Event(LEDGER_CHANGED))

  expect(state.queryClient.getQueryState(keys.mortgage(7))?.isInvalidated).toBe(true)
})

/** How many times the backend is asked for the Dashboard when it answers `status`. */
async function timesAsked(status: number): Promise<number> {
  const server = fakeServer({
    'GET /api/dashboard': () => Response.json({ detail: 'No' }, { status }),
  })
  const { client, queryClient } = createServerState({ fetch: server.fetch })
  const observer = new QueryObserver(queryClient, {
    queryKey: keys.dashboard,
    queryFn: () => dataOrThrow(client.GET('/api/dashboard')),
    retryDelay: 0,
  })
  await new Promise<void>((settled) => {
    const stop = observer.subscribe((result) => {
      if (result.isError) {
        stop()
        settled()
      }
    })
  })
  return server.requests.length
}

test('a refusal is the answer: it is not asked for again', async () => {
  expect(await timesAsked(422)).toBe(1)
})

test('a backend failure is asked for once more', async () => {
  expect(await timesAsked(500)).toBe(2)
})

test('a Ledger change does not ask again for a Preview or quote on screen: the change it previewed is made', async () => {
  const { queryClient } = createServerState({ retry: false })
  let asked = 0
  const shown = [
    [...keys.previews, 'redeem', 7],
    [...keys.redemptions, 7, '2026-10-18'],
  ]
  const observers = shown.map(
    (queryKey) => new QueryObserver(queryClient, { queryKey, queryFn: async () => ++asked }),
  )
  const stops = observers.map((observer) => observer.subscribe(() => {}))
  await Promise.all(shown.map((queryKey) => queryClient.fetchQuery({ queryKey })))
  const before = asked

  ledgerChanged(queryClient)
  await new Promise((settle) => setTimeout(settle, 10))

  expect(asked).toBe(before)
  expect(shown.map((queryKey) => queryClient.getQueryState(queryKey)?.isInvalidated)).toEqual([
    true,
    true,
  ])
  stops.forEach((stop) => stop())
})
