// Takes the GitHub Pages screenshots from the sample book, as served by serve.py, and the
// place of each numbered marker on them (story.html's SPOTS): see README.md.
//
//   node shots.mjs <out folder> [base url]
//
// Writes <out>/<name>.png for each screenshot and <out>/spots.json; publish.py turns them
// into docs/shots/*.webp and story.html's SPOTS. Scenes that change the book (approving a
// Notice, Payments) come last, so every other screenshot shows the book as built.
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const [, , out, base = 'http://127.0.0.1:8765'] = process.argv
if (!out) {
  console.error('node shots.mjs <out folder> [base url]')
  process.exit(1)
}
mkdirSync(out, { recursive: true })

// Installed Chrome, else Playwright's own Chromium (npx playwright install chromium).
const browser = await chromium.launch({ channel: process.env.CHROMIUM ? undefined : 'chrome' })
// A Windows laptop, as the Lender's is: the app offers its Windows-only buttons.
const context = await browser.newContext({
  viewport: { width: 1280, height: 860 },
  colorScheme: 'light',
  reducedMotion: 'reduce',
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
})
const page = await context.newPage()
page.setDefaultTimeout(5000)
// The day of the story in the browser too, as the forms default to today.
await page.clock.setFixedTime(new Date('2026-10-19T11:00:00'))
const spots = {}

async function open(path) {
  await page.goto(base + path)
  await page.waitForLoadState('networkidle')
  await settle()
}

/** Let the page finish what a change started: Previews, quotes, charts. */
async function settle() {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(400)
}

/** The rectangle of a locator, or of a clip, on the page. */
async function rect(target) {
  if (!target.locator) return target
  await target.scrollIntoViewIfNeeded()
  return page.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }
  }, await target.elementHandle())
}

/**
 * Screenshot `target` (a locator, or a page rectangle) as `name`, with each of `marks`
 * (key → locator) as a fraction of it, for the markers.
 */
async function shot(name, target, marks = {}) {
  const box = await rect(target)
  const b = {}
  for (const [key, locator] of Object.entries(marks)) {
    const r = await rect(locator.first ? locator.first() : locator)
    const f = (n) => Math.round(n * 10000) / 10000
    b[key] = [f((r.x - box.x) / box.width), f((r.y - box.y) / box.height), f(r.width / box.width), f(r.height / box.height)]
  }
  const height = Math.round(box.height)
  if (box.y + height > (await page.evaluate(() => document.documentElement.scrollHeight))) {
    throw new Error(`${name} runs off the page`)
  }
  await page.screenshot({
    path: `${out}/${name}.png`,
    clip: { x: box.x, y: box.y, width: Math.round(box.width), height },
    fullPage: true,
  })
  spots[name] = { w: Math.round(box.width), h: height, b }
  console.log(name, Math.round(box.width), height, Object.keys(b).join(' '))
}

/** The whole window as it stands, scrolled to the top. */
async function view(name, marks = {}) {
  await page.evaluate(() => scrollTo(0, 0))
  const r = { x: 0, y: 0, width: 1280, height: 860 }
  const b = {}
  for (const [key, locator] of Object.entries(marks)) {
    const box = await locator.first().boundingBox()
    const f = (n) => Math.round(n * 10000) / 10000
    b[key] = [f(box.x / r.width), f(box.y / r.height), f(box.width / r.width), f(box.height / r.height)]
  }
  await page.screenshot({ path: `${out}/${name}.png` })
  spots[name] = { w: 1280, h: 860, b }
  console.log(name, 1280, 860, Object.keys(b).join(' '))
}

const card = (n = 0) => page.locator('main .card').nth(n)
const dialog = () => page.locator('dialog[open]').last()
const heading = (name, level = 3) => page.getByRole('heading', { level, name, exact: true })
const button = (name) => page.getByRole('button', { name, exact: true })
const field = (label) => page.getByLabel(label, { exact: true })

/**
 * A section of a card that has no box of its own: from its heading to the next heading
 * of the same level (or the end of the card), across the card's content.
 */
async function section(name, level = 3) {
  const h = heading(name, level).first()
  return page.evaluate(
    ([el, tag]) => {
      const card = el.closest('.card')
      const c = card.getBoundingClientRect()
      const pad = parseFloat(getComputedStyle(card).paddingLeft)
      const top = el.getBoundingClientRect().top
      const later = [...card.querySelectorAll(tag)].filter((other) => other.getBoundingClientRect().top > top + 1)
      const bottom = later.length ? later[0].getBoundingClientRect().top - 12 : c.bottom - pad + 8
      return { x: c.left + pad, y: top + scrollY, width: c.width - 2 * pad, height: bottom - top }
    },
    [await h.elementHandle(), `h${level}`],
  )
}

/** From the top of `first` to the bottom of `last`, across the card's content. */
async function between(first, last) {
  const a = await rect(first.first())
  const z = await rect(last.first())
  const c = await rect(card())
  const pad = 25
  return { x: c.x + pad, y: a.y - 8, width: c.width - 2 * pad, height: z.y + z.height - a.y + 16 }
}

// The morning ---------------------------------------------------------------------------

await open('/')
await view('dashboard', {
  owed: page.locator('.group.owed > :first-child'),
  ltv: page.locator('.tile').filter({ hasText: 'Loan-to-Value' }),
  follow: page.locator('.tile').filter({ hasText: "On today's Call List" }),
  dot: page.locator('nav .dot'),
  theme: page.locator('header button').last(),
})
await shot('dashboard-chart', await section('Payments received each month, and the year ahead'))
await shot('dashboard-ahead', await section('Looking ahead'))
await shot('dashboard-closed', await section('Closed in Oct 2026'))

// House rules -----------------------------------------------------------------------------

await open('/settings')
await shot('settings-terms', card(0), { rate: field('Monthly interest rate (%)') })
await shot('settings-gold', card(1), {
  g22: card(1).locator('tr', { hasText: '22K' }).locator('input'),
  updated: card(1).locator('tr', { hasText: '22K' }).locator('td').last(),
})
await shot('settings-calls', card(2))
await shot('settings-messages', card(3), {
  template: card(3).locator('textarea').first(),
  preview: card(3).locator('.whatsapp, .bubble, [class*=preview]').first(),
  approve: card(3).getByText('Approve each Notice', { exact: false }),
})
await shot('settings-backups', card(4), { last: card(4).locator('dl, table, p').filter({ hasText: 'mortgage-backup' }) })

// Meera ------------------------------------------------------------------------------------

await open('/customers')
await shot('customers', card(), {
  filter: card().getByRole('searchbox').or(card().locator('input[type=search], input').first()),
  active: card().getByText('Only Customers with an Active Mortgage'),
  sort: card().locator('th button').first(),
  new: card().getByRole('link', { name: 'New Customer' }),
})
await open('/customers/new')
await field('Contact number 1').fill('9810012345')
await settle()
await shot('customer-new', card(), {
  phone: page.getByLabel('Contact number 1'),
  warning: card().getByText('already', { exact: false }),
  referrer: card().locator('fieldset').last(),
})
await open('/customers/1')
await shot('customer', card(), {
  photo: card().locator('img').first(),
  shared: card().getByText('also', { exact: false }),
  referrer: card().getByText('Referred by', { exact: false }),
  mortgages: heading('Mortgages'),
  history: heading('History'),
})
await open('/referrers/1')
await shot('referrer', card())

// Weighing the gold --------------------------------------------------------------------

await open('/mortgages/new?customer=1')
await field('Description of the jewellery').fill('Gold nose pin')
await field('Principal lent (₹)').fill('20000')
await field('Gross weight (g)').fill('3.2')
await field('Net weight, gold only (g)').fill('2.8')
await settle()
await shot('mortgage-new', card(), {
  active: heading('Active Mortgages'),
  name: page.getByLabel('Mortgage Name'),
  terms: card().locator('fieldset').filter({ hasText: 'Monthly interest rate' }),
  photos: card().locator('fieldset').filter({ hasText: 'Upload photos' }),
})
await button('Create Mortgage').click()
await settle()
await shot('mortgage-new-confirm', dialog())
await dialog().getByRole('button', { name: 'Keep editing' }).click()

// The life of a pledge -------------------------------------------------------------------

await open('/mortgages/2')
await view('mortgage', {
  tiles: page.locator('.tiles, .stats').first(),
  pay: page.getByRole('link', { name: 'Record a Payment' }),
  edit: page.getByRole('link', { name: 'Edit', exact: true }),
})
await shot('mortgage-collateral', await section('Collateral Value'))
await shot('mortgage-ledger', await section('Ledger'))
await shot('mortgage-history', await section('History'))
await field('What if they pay every month (₹), on each Accrual Date').fill('3000')
await settle()
await shot('mortgage-projection', await section('Projection'), {
  whatif: field('What if they pay every month (₹), on each Accrual Date'),
})
await open('/mortgages/5')
await shot('mortgage-terms', await section('Terms'), { coming: page.getByRole('button', { name: /Remove/ }) })
await open('/mortgages/1')
await shot('mortgage-photos', await section('Photos'))

// Second thoughts ------------------------------------------------------------------------

await open('/mortgages/2/edit')
await field('Principal lent (₹)').fill('90000')
await settle()
await shot('edit-preview', card(), {
  principal: field('Principal lent (₹)'),
  owed: card().locator('.change-tile, .tile').first(),
  ledger: card().getByText('Ledger steps that change').first(),
})
await open('/mortgages/2/terms')
await field('Monthly interest rate (%)').fill('1.5')
await settle()
await shot('terms-preview', card(), {
  from: card().locator('select').first(),
  owed: card().locator('.change-tile, .tile').first(),
})

// Meera pays ------------------------------------------------------------------------------

await open('/payments/new?customer=1')
await page.getByLabel('Amount received (₹)').fill('8000')
await settle()
await shot('payment-new', card(), {
  amount: page.getByLabel('Amount received (₹)'),
  modes: card().getByText('Equally', { exact: false }).first(),
  split: card().locator('table').first(),
  redeem: card().locator('th').filter({ hasText: 'To redeem on' }),
  full: page.getByRole('button', { name: /^Pay the full Redemption Amount/ }),
  preview: heading('What changes'),
})
await page.getByLabel('Amount received (₹)').fill('900000')
await card().getByText('would be more than', { exact: false }).waitFor()
await settle()
await shot('payment-refused', await between(card().locator('fieldset').first(), card().locator('button[type=submit]').last()), {
  refusal: card().locator('.status.error').last(),
  save: card().locator('button[type=submit]').last(),
})
await open('/payments/23')
await shot('payment', card(), {
  alloc: await section('Allocations'),
  receipt: await section('Receipt'),
  void: button('Void…'),
})
await open('/payments/23/receipt')
await shot('receipt', card())
await open('/payments/28')
await button('Void…').click()
await settle()
await shot('payment-void', dialog())
await dialog().getByRole('button', { name: 'Cancel' }).click()
await open('/payments')
await page.getByLabel('Show Voided Payments').check()
await settle()
await shot('payments', card(), { voided: card().getByText('voided', { exact: true }) })

// Meanwhile, Arjun ------------------------------------------------------------------------

await open('/call-list')
await shot('call-list', card(), {
  customer: card().locator('td.call-customer'),
  count: card().locator('.call-who a').filter({ hasText: /2 Mortgages/ }),
  reach: card().locator('.call-who .reach'),
  why: card().locator('.reasons').nth(1),
  legend: card().locator('.reason-legend'),
  called: card().locator('.called-cell'),
  mark: button('Mark called…'),
  chat: card().locator('.call-who .reach a, .call-who .reach button').last(),
})
await card().locator('.call-who a').filter({ hasText: /2 Mortgages/ }).click()
await settle()
await shot('mortgages-customer', card(), { note: card().getByText('Show every Customer').locator('..') })

// How pledges end -------------------------------------------------------------------------

await open('/closures')
await shot('closures', card(), { ready: card().getByRole('link', { name: '2026-Lakshmi-TempleNecklace' }) })
await open('/mortgages/4/redeem')
await shot('redeem', page.locator('.close-panel'), {
  date: field('Redeemed on'),
  amount: card().getByText('Redemption Amount', { exact: true }).first(),
})
await open('/mortgages/8')
await button('Waive off…').click()
await settle()
await field('Received now (₹): the final Payment; the rest of the Redemption Amount is let off').fill('46500')
await field('Reason').fill('Pays as he can; ₹300 let off')
await settle()
await shot('waive', page.locator('.close-panel'))
await open('/closures')
await card().locator('tbody input[type=checkbox]').nth(1).check()
await page.getByLabel('Waive off', { exact: true }).check()
await settle()
await card().getByRole('spinbutton').last().fill('46500')
await settle()
// Down to the amounts received: the Preview below is as on any Waive off.
const top = await rect(card())
const cut = await rect(page.getByText('Final Payments made by').first())
await shot('closures-waive', { x: top.x, y: top.y, width: top.width, height: cut.y - top.y - 8 })
await open('/mortgages/3')
const closed = () => between(page.locator('.close-panel'), button('Reopen…'))
await shot('redeemed', await closed())
await open('/mortgages/7')
await shot('forfeited', await closed())
await open('/mortgages/6')
await shot('waived', await closed())

// Starting and updating the app on Windows ----------------------------------------------

// Nothing answers: the installed app offers to start it.
await page.route('**/api/**', (route) => route.abort('connectionrefused'))
await open('/')
await page.locator('main.start-gate').waitFor()
await shot('start-screen', page.locator('main.start-gate'), { start: button('Start Mortgage Management') })
await page.unroute('**/api/**')
// A newer release is out (invented for the picture).
await page.route('**/api/update', (route) =>
  route.fulfill({
    json: {
      running: '2.0.0',
      available: {
        version: '2.1.0',
        notes: '### Added\n\n- **Example:** what a release adds is listed here, from its changelog.',
      },
    },
  }),
)
await open('/')
await page.locator('.update-banner summary').click()
await shot('update-banner', page.locator('.update-banner'))
await page.unroute('**/api/update')

// Scenes that change the book -------------------------------------------------------------

// Sunita's Notice: read, approved, then To send.
await open('/notices')
await page.getByLabel('To approve', { exact: true }).click()
await settle()
await shot('notices', card(), {
  tabs: card().locator('label', { hasText: 'To approve' }).locator('..'),
  row: card().locator('tbody tr').first(),
})
await card().locator('tbody tr').first().getByRole('button').first().click()
await settle()
await shot('notice', dialog(), { approve: dialog().getByRole('button', { name: 'Approve' }) })
await dialog().getByRole('button', { name: 'Approve' }).click()
await settle()
await page.getByLabel('To send', { exact: true }).click()
await settle()
await shot('notices-send', card(), { send: card().getByRole('button', { name: /Send/ }).first() })

// Arjun pays his chain's whole Redemption Amount: it is Redeemed with the Payment.
await open('/payments/new?customer=2')
await card().locator('tbody tr', { hasText: 'GoldRingRuby' }).locator('input[type=checkbox]').uncheck()
await page.getByRole('button', { name: /^Pay the full Redemption Amount/ }).click()
await settle()
await card().locator('button[type=submit]').last().click()
await settle()
await shot('payment-redeem', dialog())
await dialog().getByRole('button', { name: /Redeem/ }).last().click()
await settle()
await shot('receipt-redeemed', card())

// Sunita pays off what she owes, leaving a part-month: offered to Redeem it now.
await open('/payments/new?customer=7')
await page.getByLabel('Amount received (₹)').fill('35000')
await settle()
await card().locator('button[type=submit]').last().click()
await settle()
await dialog().getByRole('button', { name: /Record|Confirm/ }).last().click()
await settle()
// The offer itself; below it is the Preview of the Redemption.
const offer = await rect(dialog())
const owed = await rect(dialog().getByText('Owed today').first().locator('..'))
await shot('paid-off', { x: offer.x, y: offer.y, width: offer.width, height: owed.y + owed.height - offer.y + 20 })

writeFileSync(`${out}/spots.json`, JSON.stringify(spots))
await browser.close()
