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

test('a route no scenario covers fails the check, named', () => {
  const features = {
    'dashboard.feature': `Feature: Dashboard\n\n  @screen:/\n  Scenario: It opens\n    When the Lender opens the Dashboard\n`,
  }
  assert.deepEqual(checkScreenCoverage({ appTsx, features, gaps: '' }), [
    'No scenario covers /payments/:id: tag one @screen:/payments/:id in qa/features.',
    'No scenario covers /payments/:id/advance-instalments/:instalment/receipt: tag one @screen:/payments/:id/advance-instalments/:instalment/receipt in qa/features.',
    'No scenario covers *: tag one @screen:* in qa/features.',
  ])
})

test('a route still waiting for its scenario passes while it is listed with its ticket', () => {
  const features = {
    'a.feature': `@screen:/\nFeature: A\n\n  Rule: R\n    @screen:/payments/:id @screen:*\n    Scenario: S\n`,
  }
  const gaps = '/payments/:id/advance-instalments/:instalment/receipt  #459\n'
  assert.deepEqual(checkScreenCoverage({ appTsx, features, gaps }), [])
})

test('a listed route that a scenario now covers fails, so the list only shrinks', () => {
  const features = { 'a.feature': `@screen:/ @screen:/payments/:id @screen:*\nFeature: A\n` }
  const gaps = '/payments/:id  #459\n/payments/:id/advance-instalments/:instalment/receipt  #459\n'
  assert.deepEqual(checkScreenCoverage({ appTsx, features, gaps }), [
    '/payments/:id is covered now: remove it from qa/screens-to-cover.txt.',
  ])
})

test('a listed route the router no longer has fails', () => {
  const features = { 'a.feature': `@screen:/ @screen:/payments/:id @screen:*\nFeature: A\n` }
  const gaps = '/payments/:id/advance-instalments/:instalment/receipt  #459\n/calculator  #467\n'
  assert.deepEqual(checkScreenCoverage({ appTsx, features, gaps }), [
    '/calculator is not a route in frontend/src/App.tsx: remove it from qa/screens-to-cover.txt.',
  ])
})

test('a listed route must name the ticket that covers it', () => {
  const features = { 'a.feature': `@screen:/ @screen:/payments/:id @screen:*\nFeature: A\n` }
  const gaps = '/payments/:id/advance-instalments/:instalment/receipt\n'
  assert.deepEqual(checkScreenCoverage({ appTsx, features, gaps }), [
    'qa/screens-to-cover.txt: "/payments/:id/advance-instalments/:instalment/receipt" needs the ticket that covers it, as "<route>  #<issue>".',
  ])
})
