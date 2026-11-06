// Drives the real Calculator (vite's dev server, in front of the served sample book) in a
// headless browser, doing what lesson 6 has the reader do, and prints what the screen
// shows and which /api/ requests it makes: run by calculator.sh, which says how. Saves
// nothing.
//
//   node calculator.mjs <frontend url> <repo>
import { createRequire } from 'node:module'

const [, , base, repo] = process.argv
const { chromium } = createRequire(`${repo}/docs/sample-book/package.json`)('playwright')

const browser = await chromium.launch({ channel: process.env.CHROMIUM ? undefined : 'chrome' })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
page.setDefaultTimeout(15000)
await page.clock.setFixedTime(new Date('2026-10-19T11:00:00'))

let log = []
page.on('request', (request) => {
  const url = new URL(request.url())
  if (url.pathname.startsWith('/api/')) log.push(`${request.method()} ${url.pathname}`)
})
page.on('response', async (response) => {
  const url = new URL(response.url())
  if (url.pathname === '/api/simulation' && response.status() >= 400)
    console.log(`     ${response.status()} /api/simulation: ${await response.text()}`)
})
async function settle(ms = 1200) {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(ms)
}
const say = (label, value) => console.log(`  ${label}:`, typeof value === 'string' ? JSON.stringify(value) : value)
const tiles = async () =>
  (await page.locator('.tile').allInnerTexts()).map((t) => t.replace(/\s*\n\s*/g, ' | '))
const query = () => decodeURIComponent(new URL(page.url()).search)

console.log('== A fresh Calculator')
await page.goto(`${base}/calculator`)
await settle()
say('url', query())
say('tiles', await tiles())
say('hint', await page.locator('.calculator .row .hint, .calculator .row .status').first().innerText())

console.log('== Meera\'s chain typed in')
await page.getByLabel('Amount lent (₹)').fill('80000')
await page.getByLabel('Start date').fill('2025-11-10')
await page.getByLabel('Closed on').fill('2026-10-19')
await settle()
say('url after typing', query())
const lumps = ['2025-12-10:1600', '2026-01-10:1600', '2026-02-10:1600', '2026-03-10:1600', '2026-05-10:1600',
  '2026-06-10:1600', '2026-07-10:1600', '2026-08-10:1600', '2026-09-10:2000']
const chainUrl = `${base}/calculator?amount=80000&start=2025-11-10&closed=2026-10-19&span=12&rate=2&mode=compounded_yearly&rule=pro_rata&lumps=${lumps.join(',')}`
log = []
await page.goto(chainUrl)
await settle()
say('requests', log)
say('tiles', await tiles())
say('lump rows', await page.locator('.lump-sum').count())
const last = page.locator('table').last()
say('month-by-month last rows', (await last.locator('tr').allInnerTexts()).slice(-3))

console.log('== The Mortgage page')
await page.goto(`${base}/mortgages/2`)
await settle()
const body = await page.locator('main').innerText()
say('Outstanding line', body.split('\n').filter((l) => /Outstanding|83,333/.test(l)).slice(0, 4))

console.log('== Closed on 10 Nov, by hand in the URL')
await page.goto(chainUrl.replace('closed=2026-10-19', 'closed=2026-11-10'))
await settle()
say('tiles', await tiles())
console.log('== rate=abc and mode=weekly in the URL')
await page.goto(chainUrl.replace('mode=compounded_yearly', 'mode=weekly'))
await settle()
say('mode select', await page.getByLabel('Interest Mode').first().inputValue().catch((e) => e.message))
say('tiles', await tiles())

console.log('== Compare other Terms: Compounded Monthly')
await page.goto(chainUrl)
await settle()
await page.getByRole('button', { name: 'Compare other Terms' }).click()
await settle()
say('url', query())
await page.getByLabel('Interest Mode').nth(1).selectOption('compounded_monthly')
await settle()
say('url', query())
say('tiles', await tiles())
say('lend hint', await page.locator('.calculator .row .hint').first().innerText())
await page.getByRole('button', { name: 'Remove the compared Terms' }).click()
await settle()

console.log('== A Lump Sum of ₹1,00,000 on 15 Oct')
await page.getByRole('button', { name: 'Add a Lump Sum' }).click()
await page.getByLabel('Lump Sum 10 date').fill('2026-10-15')
await page.getByLabel('Lump Sum 10 amount (₹)').fill('100000')
await settle()
say('row 10', await page.locator('.lump-sum').nth(9).innerText())
say('tiles', await tiles())
say('why', await page.locator('.calculator .status').first().innerText().catch(() => null))
say('Lend this disabled', await page.getByRole('button', { name: 'Lend this' }).isDisabled())
await page.getByLabel('Lump Sum 10 amount (₹)').fill('83120')
await settle()
say('₹83,120 tiles', await tiles())
await page.getByLabel('Lump Sum 10 date').fill('2026-10-25')
await page.getByLabel('Lump Sum 10 amount (₹)').fill('10000')
await settle()
say('25 Oct row 10', await page.locator('.lump-sum').nth(9).innerText())

console.log('== Start date still to come')
await page.goto(chainUrl.replace('start=2025-11-10', 'start=2026-11-01').replace('closed=2026-10-19', 'closed=2027-11-01').replace(/&lumps=[^&]*/, ''))
await settle()
say('Lend this disabled', await page.getByRole('button', { name: 'Lend this' }).isDisabled())
say('hint', await page.locator('.calculator .row .hint').first().innerText())

console.log('== Lend this')
await page.goto(chainUrl)
await settle()
log = []
await page.getByRole('button', { name: 'Lend this' }).click()
await settle()
say('landed on', decodeURIComponent(page.url().replace(base, '')))
say('requests', log)
say('page text', (await page.locator('main').innerText()).split('\n').slice(0, 12))

await browser.close()
