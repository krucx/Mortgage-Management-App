// The typed fake backend answers by the API's own routes and bodies. The `@ts-expect-error`
// lines are the pin: if the fake stopped checking, they would be unused and `tsc` would fail.
import { expect, expectTypeOf, test } from 'vitest'
import type { components } from '../src/api.gen'
import { typedFakeServer, type Answer, type Route } from './typedFakeServer'

type Schemas = components['schemas']

test('a route that is not in the API fails the typecheck', () => {
  // @ts-expect-error no such route (a renamed path)
  typedFakeServer({ 'GET /api/mortgage/{mortgage_id}': {} })
  // @ts-expect-error the path exists, but not with that method
  typedFakeServer({ 'DELETE /api/payment-methods': {} })
  // @ts-expect-error a concrete id is not a path template
  typedFakeServer({ 'GET /api/customers/3': {} })

  expectTypeOf<'GET /api/customers/{customer_id}'>().toExtend<Route>()
})

test('an answer that is not the operation’s success body fails the typecheck', () => {
  typedFakeServer({ 'GET /api/payment-methods': [{ method: 'cash', name: 'Cash' }] })
  // @ts-expect-error a response field is missing (`name`)
  typedFakeServer({ 'GET /api/payment-methods': [{ method: 'cash' }] })
  // @ts-expect-error the wrong shape altogether
  typedFakeServer({ 'GET /api/payment-methods': { items: [] } })
  // @ts-expect-error a function of the request must give the same body
  typedFakeServer({ 'GET /api/payment-methods': () => ({ items: [] }) })

  expectTypeOf<Schemas['PaymentMethodName'][]>().toExtend<Answer<'GET /api/payment-methods'>>()
})

test('an error answer can still be a Response, direct or from a function', () => {
  typedFakeServer({
    'GET /api/payment-methods': Response.json({ detail: 'down' }, { status: 503 }),
    'POST /api/payments/preview': async () => Response.json({ detail: 'no' }, { status: 422 }),
  })
})

test('a request is answered by the template it matches, and recorded as asked', async () => {
  const server = typedFakeServer({
    'GET /api/payment-methods': [{ method: 'cash', name: 'Cash' }],
    'GET /api/settings/grace-period': () => ({ grace_period_days: 2 }),
  })

  const methods = await server.fetch(new Request('http://x/api/payment-methods'))
  const grace = await server.fetch(new Request('http://x/api/settings/grace-period'))
  const missing = await server.fetch(new Request('http://x/api/nothing'))
  const wrongMethod = await server.fetch(
    new Request('http://x/api/payment-methods', { method: 'POST' }),
  )

  expect(await methods.json()).toEqual([{ method: 'cash', name: 'Cash' }])
  expect(await grace.json()).toEqual({ grace_period_days: 2 })
  expect(missing.status).toBe(404)
  expect(wrongMethod.status).toBe(404)
  expect(server.requests).toEqual([
    'GET /api/payment-methods',
    'GET /api/settings/grace-period',
    'GET /api/nothing',
    'POST /api/payment-methods',
  ])
})

test('{id} in a template stands for one path segment', async () => {
  const server = typedFakeServer({
    'GET /api/mortgages/{mortgage_id}/history': { items: [], total: 0, page: 1, page_size: 20 },
  })

  const found = await server.fetch(new Request('http://x/api/mortgages/7/history'))
  const deeper = await server.fetch(new Request('http://x/api/mortgages/7/8/history'))

  expect(found.status).toBe(200)
  expect(deeper.status).toBe(404)
})
