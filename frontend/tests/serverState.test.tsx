// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { ServerStateProvider } from '../src/components/ServerStateProvider'
import { createServerState, keys, LEDGER_CHANGED, ledgerChanged } from '../src/serverState'

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
