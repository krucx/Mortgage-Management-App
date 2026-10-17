// api.gen.ts must be what openapi-typescript makes of the checked-in openapi.json, whose
// own freshness against the backend is checked by the backend's tests.
import { readFileSync } from 'node:fs'
import openapiTS, { astToString } from 'openapi-typescript'
import { expect, test } from 'vitest'

const root = new URL('../', import.meta.url)

test('the generated API types match the OpenAPI schema', async () => {
  const schema = readFileSync(new URL('openapi.json', root), 'utf8')
  const generated = readFileSync(new URL('src/api.gen.ts', root), 'utf8')

  const expected = astToString(await openapiTS(schema))

  expect(generated.endsWith(expected), 'run `npm run gen:types` and commit the result').toBe(true)
})
