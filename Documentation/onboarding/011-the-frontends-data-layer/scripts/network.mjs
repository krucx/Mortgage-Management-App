// Drives the real screens (vite's dev server, in front of the served sample book) in a
// headless browser and prints every /api/ request each step makes: run by run_throughs.sh,
// which says how. Saves only on the scratch book run_throughs.sh made.
//
//   node network.mjs <frontend url> <repo>
import { createRequire } from 'node:module'

const [, , base, repo] = process.argv
const { chromium } = createRequire(`${repo}/docs/sample-book/package.json`)('playwright')

const browser = await chromium.launch({ channel: process.env.CHROMIUM ? undefined : 'chrome' })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()
page.setDefaultTimeout(8000)
// The day of the book in the browser too, as the forms default to today. Timers still run.
await page.clock.setFixedTime(new Date('2026-10-19T11:00:00'))

/** Every /api/ request since `clear()`, with when it went (ms since `clear()`). */
let log = []
let since = Date.now()
const clear = () => {
  log = []
  since = Date.now()
}
page.on('request', (request) => {
  const url = new URL(request.url())
  if (!url.pathname.startsWith('/api/')) return
  log.push({
    at: Date.now() - since,
    line: `${request.method()} ${url.pathname}${url.search}`,
    body: request.postData(),
  })
})
const answers = []
page.on('response', async (response) => {
  const url = new URL(response.url())
  if (url.pathname.startsWith('/api/') && response.status() >= 400) {
    answers.push({ line: `${response.status()} ${url.pathname}`, body: await response.text().catch(() => '') })
  }
})

async function settle(ms = 900) {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(ms)
}
function show(title, { bodies = false, times = false } = {}) {
  console.log(`  -- ${title}: ${log.length} request(s)`)
  for (const r of log) {
    console.log(`     ${times ? `${String(r.at).padStart(5)} ms  ` : ''}${r.line}${bodies && r.body ? `  ${r.body}` : ''}`)
  }
}
const field = (label) => page.getByLabel(label, { exact: true })
const dialog = () => page.getByRole('dialog')
const save = () => page.locator('form button[type=submit]').last()
const navTo = (name) => page.locator('nav').getByRole('link', { name, exact: true }).click()

// ---------------------------------------------------------------------------------------
console.log('== L1: Meera\'s chain, through the typed client')
clear()
await page.goto(`${base}/mortgages/2`)
await settle()
show('open /mortgages/2 (a fresh load)')
const chain = await (await fetch('http://127.0.0.1:8000/api/mortgages/2')).json()
console.log('  GET /api/mortgages/2 →', JSON.stringify({
  id: chain.id, name: chain.name, status: chain.status, amount_lent: chain.amount_lent,
  as_of: chain.as_of, terms: chain.terms, outstanding: chain.outstanding,
  ledger_steps: chain.ledger.length, keys: Object.keys(chain).length,
}))

console.log('== L1: a Payment the backend refuses')
await page.goto(`${base}/payments/new?customer=1&mortgage=2`)
await settle()
await page.getByLabel(/^Method/).selectOption('upi')
answers.length = 0
clear()
await page.getByLabel('Amount received (₹)').fill('90000')
await page.getByText('would be more than', { exact: false }).first().waitFor()
await settle()
show('amount 90000 (UPI), chain only', { bodies: true })
for (const a of answers) console.log(`     answer ${a.line}: ${a.body}`)
console.log('  shown:', JSON.stringify(await page.locator('.status.error').allInnerTexts()))
console.log('  Save disabled:', await save().isDisabled())

console.log('== L1: a failure (500) is asked once more; a refusal (422) once')
for (const status of [500, 422]) {
  await page.route('**/api/dashboard', (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ detail: `Answered ${status}` }) }),
  )
  clear()
  await page.goto(`${base}/`)
  await settle(2500)
  console.log(`  dashboard answering ${status}: asked`, log.filter((r) => r.line.startsWith('GET /api/dashboard')).length, 'time(s); shown:',
    JSON.stringify(await page.locator('.status.error').allInnerTexts()))
  await page.unroute('**/api/dashboard')
}

console.log('== L1: the server stops while the app is open')
await page.goto(`${base}/mortgages/2`)
await settle()
await page.route('**/api/**', (route) => route.abort('connectionrefused'))
clear()
await navTo('Customers')
await settle(2500)
show('click Customers with no server')
console.log('  shown:', JSON.stringify(await page.locator('.status.error').allInnerTexts()))
clear()
await page.goto(`${base}/mortgages/2`)
await settle(2500)
show('a fresh load with no server')
console.log('  shown:', JSON.stringify((await page.locator('body').innerText()).slice(0, 200)))
await page.unroute('**/api/**')

// ---------------------------------------------------------------------------------------
console.log('== L2: Customer → chain → back')
await page.goto(`${base}/customers/1`)
await settle()
clear()
await page.goto(`${base}/customers/1`)
await settle()
show('open /customers/1 (a fresh load)')
clear()
await page.locator('a[href="/mortgages/2"]').first().click()
await settle()
show('click through to /mortgages/2')
clear()
await page.goBack()
await settle()
show('Back to /customers/1')
clear()
await page.goForward()
await settle()
show('Forward to /mortgages/2 again')
// Back again, with the backend slow to answer: is the cached page shown meanwhile?
await page.route('**/api/customers/1', async (route) => {
  await new Promise((wait) => setTimeout(wait, 2000))
  await route.continue()
})
await page.goBack()
await page.waitForTimeout(200)
console.log('  Back with /api/customers/1 taking 2 s: after 200 ms the page shows',
  JSON.stringify(await page.locator('h2').first().innerText()))
await settle(2200)
await page.unroute('**/api/customers/1')

console.log('== L2: Settings twice')
clear()
await navTo('Settings')
await settle()
show('Settings, first time')
clear()
await navTo('Customers')
await settle()
show('Customers')
clear()
await navTo('Settings')
await settle()
show('Settings, second time')

// ---------------------------------------------------------------------------------------
console.log('== L3: the Customers list, sorted')
await page.goto(`${base}/customers`)
await settle()
const names = async () =>
  (await page.locator('tbody tr').allInnerTexts()).map((row) => row.split('\t').filter(Boolean)[0])
for (const step of ['by name', 'by name again', 'by Referrer']) {
  clear()
  await page.getByRole('button', { name: step === 'by Referrer' ? /^Referred by/ : /^Name/ }).click()
  await settle()
  console.log(`  click ${step}: url ${new URL(page.url()).search}`)
  show('requests')
  console.log('     rows:', JSON.stringify(await names()))
}
// A quick second click while the first sort is slow to answer.
await page.route(/sort=address(?!&descending)/, async (route) => {
  await new Promise((wait) => setTimeout(wait, 1500))
  await route.continue()
})
clear()
await page.getByRole('button', { name: /^Address/ }).click()
await page.waitForTimeout(100)
await page.getByRole('button', { name: /^Address/ }).click()
await settle(2000)
show('Address, then Address again at once (the first answer slow)', { times: true })
console.log(`     url ${new URL(page.url()).search}; rows:`, JSON.stringify(await names()))
await page.unroute(/sort=address(?!&descending)/)
await page.getByRole('button', { name: /^Referred by/ }).click()
await settle()
clear()
await page.reload()
await settle()
console.log(`  reload: url ${new URL(page.url()).search}`)
show('requests')

console.log('== L3: the Payments list, page 2, then a filter')
await page.goto(`${base}/payments`)
await settle()
console.log('  pager:', JSON.stringify(await page.getByText(/^Showing/).innerText()))
clear()
await page.getByRole('button', { name: 'Next', exact: true }).click()
await settle()
show('Next')
console.log('  pager:', JSON.stringify(await page.getByText(/^Showing/).innerText()))
clear()
await page.getByLabel('Filter Payments').fill('Meera')
await settle()
show('filter "Meera"')
console.log('  pager:', JSON.stringify(await page.getByText(/^Showing/).innerText()))
clear()
await page.getByRole('button', { name: /^Amount/ }).click()
await settle()
console.log(`  sort by amount: url ${new URL(page.url()).search}`)
show('requests')

// Page 2 emptied under the Lender (its rows acted on elsewhere): stands in an empty answer.
await page.goto(`${base}/payments`)
await settle()
await page.getByRole('button', { name: 'Next', exact: true }).click()
await settle()
await page.route(/\/api\/payments\?page=2/, (route) =>
  route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [], total: 20, page: 2, page_size: 20 }) }),
)
clear()
await page.evaluate(() => {
  window.dispatchEvent(new Event('visibilitychange'))
})
await settle()
show('page 2 comes back empty (refetched on focus)')
console.log('  pager:', JSON.stringify(await page.getByText(/^Showing/).innerText()))
await page.unroute(/\/api\/payments\?page=2/)

// ---------------------------------------------------------------------------------------
console.log("== L4: a UPI Payment to Meera's bangles, typed digit by digit")
await page.goto(`${base}/payments/new?customer=1&mortgage=5`)
await settle()
console.log('  ticked:', JSON.stringify(await page.locator('tbody input[type=checkbox]:checked').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))))
await page.getByLabel(/^Method/).selectOption('upi')
await settle()
const amount = page.getByLabel('Amount received (₹)')
await amount.click()
clear()
const typed = []
for (const key of '8000') {
  await page.keyboard.type(key)
  typed.push(Date.now() - since)
  await page.waitForTimeout(150)
}
console.log('  keys at', JSON.stringify(typed), 'ms; Save disabled just after:', await save().isDisabled())
await settle(1200)
show('typing 8000', { times: true, bodies: true })
console.log('  Save disabled once in:', await save().isDisabled())

clear()
await page.keyboard.press('Backspace')
await settle(1200)
show('Backspace (800)', { times: true })
clear()
await page.keyboard.type('0')
await settle(1200)
show('back to 8000', { times: true, bodies: true })
clear()
await page.evaluate(() => {
  window.dispatchEvent(new Event('visibilitychange'))
})
await settle()
show('the window regains focus')

console.log('== L4: the same draft in cash, at and below the Cash Limit')
console.log('  cash limit:', JSON.stringify(await (await fetch('http://127.0.0.1:8000/api/settings/cash-limit')).json()))
await page.getByLabel(/^Method/).selectOption('cash')
for (const rupees of ['20000', '19999']) {
  await amount.fill(rupees)
  await settle()
  const cash = log.findLast((r) => r.line.startsWith('POST /api/payments/preview'))
  clear()
  await save().click()
  await dialog().first().waitFor()
  console.log(`  ₹${rupees} cash, Save: dialog "${await dialog().getByRole('heading').first().innerText()}"; buttons`,
    JSON.stringify(await dialog().getByRole('button').allInnerTexts()), '; focused:', JSON.stringify(await page.evaluate(() => document.activeElement?.textContent)))
  await dialog().getByRole('button').first().click() // Go back / Keep editing
  await settle(300)
  show('requests on Save')
}

// ---------------------------------------------------------------------------------------
console.log('== L5: saving the ₹8,000 UPI Payment, and what is asked again')
await page.getByLabel(/^Method/).selectOption('upi')
await amount.fill('8000')
await page.getByLabel(/^Reference/).fill('UPI 4417').catch(() => {})
await settle()
await save().click()
await dialog().first().waitFor()
console.log('  confirmation:', JSON.stringify(await dialog().first().innerText()))
clear()
await dialog().getByRole('button', { name: 'Confirm and save' }).click()
await page.waitForURL(/receipt/)
await settle(1500)
console.log(`  now at ${new URL(page.url()).pathname}`)
show('after Confirm and save', { times: true })

console.log('== L5: the next pages after the save (in the app, not reloaded)')
clear()
await navTo('Payments')
await settle()
show('Payments')
clear()
await page.locator('a[href="/mortgages/5"]').first().click()
await settle()
show('the bangles')

console.log("== L5: approving Sunita's Notice")
await page.goto(`${base}/notices`)
await settle()
await page.getByLabel('To approve', { exact: true }).click()
await settle()
await page.locator('tbody tr').first().getByRole('button').first().click()
await dialog().first().waitFor()
clear()
await dialog().getByRole('button', { name: 'Approve' }).click()
await settle(1500)
show('after Approve')
clear()
await navTo('Dashboard')
await settle()
show('then the Dashboard')

await browser.close()
