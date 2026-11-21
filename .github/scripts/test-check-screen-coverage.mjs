import assert from 'node:assert/strict'
import test from 'node:test'
import { checkScreenCoverage } from './check-screen-coverage.mjs'

const appTsx = `
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/payments/:id" element={<PaymentPage />} />
      <Route
        path="/payments/:id/advance-instalments/:instalment/receipt"
        element={<ReceiptPage />}
      />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
`

const receipt = '/payments/:id/advance-instalments/:instalment/receipt'

test('a route no scenario covers fails the check, named', () => {
  const features = {
    'dashboard.feature': `Feature: Dashboard\n\n  @screen:/\n  Scenario: It opens\n    When the Lender opens the Dashboard\n`,
  }
  assert.deepEqual(checkScreenCoverage({ appTsx, features, gaps: {} }), [
    'No scenario covers /payments/:id: tag one @screen:/payments/:id in qa/features, or list it in qa/screens-to-cover/<issue>.txt for the ticket that will cover it.',
    `No scenario covers ${receipt}: tag one @screen:${receipt} in qa/features, or list it in qa/screens-to-cover/<issue>.txt for the ticket that will cover it.`,
    'No scenario covers *: tag one @screen:* in qa/features, or list it in qa/screens-to-cover/<issue>.txt for the ticket that will cover it.',
  ])
})

test("a route still waiting for its scenario passes while its ticket's file lists it", () => {
  const features = {
    'a.feature': `@screen:/\nFeature: A\n\n  Rule: R\n    @screen:/payments/:id @screen:*\n    Scenario: S\n`,
  }
  const gaps = { '459.txt': `${receipt}\n` }
  assert.deepEqual(checkScreenCoverage({ appTsx, features, gaps }), [])
})

test("a ticket whose routes are all covered now fails until its file is deleted", () => {
  const features = { 'a.feature': `@screen:/ @screen:/payments/:id @screen:${receipt} @screen:*\nFeature: A\n` }
  const gaps = { '459.txt': `/payments/:id\n${receipt}\n` }
  assert.deepEqual(checkScreenCoverage({ appTsx, features, gaps }), [
    'Every route in qa/screens-to-cover/459.txt is covered now: delete the file.',
  ])
})

test('a listed route that a scenario now covers fails, so the list only shrinks', () => {
  const features = { 'a.feature': `@screen:/ @screen:/payments/:id @screen:*\nFeature: A\n` }
  const gaps = { '459.txt': `/payments/:id\n${receipt}\n` }
  assert.deepEqual(checkScreenCoverage({ appTsx, features, gaps }), [
    '/payments/:id is covered now: remove it from qa/screens-to-cover/459.txt.',
  ])
})

test('a listed route the router no longer has fails', () => {
  const features = { 'a.feature': `@screen:/ @screen:/payments/:id @screen:*\nFeature: A\n` }
  const gaps = { '459.txt': `${receipt}\n`, '467.txt': '/calculator\n' }
  assert.deepEqual(checkScreenCoverage({ appTsx, features, gaps }), [
    '/calculator is not a route in frontend/src/App.tsx: remove it from qa/screens-to-cover/467.txt.',
  ])
})

test('a file is named after the ticket that covers its routes', () => {
  const features = { 'a.feature': `@screen:/ @screen:/payments/:id @screen:*\nFeature: A\n` }
  const gaps = { 'receipts.txt': `${receipt}\n` }
  assert.deepEqual(checkScreenCoverage({ appTsx, features, gaps }), [
    'qa/screens-to-cover/receipts.txt: name it after the ticket that will cover its routes, as <issue>.txt.',
  ])
})

test('a file that lists no route fails', () => {
  const features = { 'a.feature': `@screen:/ @screen:/payments/:id @screen:*\nFeature: A\n` }
  const gaps = { '459.txt': `${receipt}\n`, '460.txt': '\n' }
  assert.deepEqual(checkScreenCoverage({ appTsx, features, gaps }), [
    'qa/screens-to-cover/460.txt lists no route: delete the file.',
  ])
})

test('a route listed twice fails, naming both files', () => {
  const features = { 'a.feature': `@screen:/ @screen:/payments/:id @screen:*\nFeature: A\n` }
  const gaps = { '459.txt': `${receipt}\n`, '460.txt': `${receipt}\n` }
  assert.deepEqual(checkScreenCoverage({ appTsx, features, gaps }), [
    `${receipt} is listed twice, in qa/screens-to-cover/459.txt and qa/screens-to-cover/460.txt: keep it in one ticket's file.`,
  ])
})

test('a route listed twice in one file fails', () => {
  const features = { 'a.feature': `@screen:/ @screen:/payments/:id @screen:*\nFeature: A\n` }
  const gaps = { '459.txt': `${receipt}\n${receipt}\n` }
  assert.deepEqual(checkScreenCoverage({ appTsx, features, gaps }), [
    `${receipt} is listed twice, in qa/screens-to-cover/459.txt and qa/screens-to-cover/459.txt: keep it in one ticket's file.`,
  ])
})

test('a route is read whatever order its attributes are in', () => {
  const app = `<Route element={<CalculatorPage />} path="/calculator" />`
  assert.deepEqual(checkScreenCoverage({ appTsx: app, features: {}, gaps: {} }), [
    'No scenario covers /calculator: tag one @screen:/calculator in qa/features, or list it in qa/screens-to-cover/<issue>.txt for the ticket that will cover it.',
  ])
})
