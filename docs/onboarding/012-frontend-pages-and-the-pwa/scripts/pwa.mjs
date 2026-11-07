// Lesson 6: the built screens, served with a fresh sample book by serve.py on :8765, in a
// headless browser with the service worker running. Starts and stops serve.py itself, to
// show what the app does while the server is stopped. Run by run_throughs.sh, which says how.
//
//   REPO=<repo> BOOK=<a freshly built book> node pwa.mjs
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const { REPO: repo, BOOK: book } = process.env
const { chromium } = createRequire(`${repo}/docs/sample-book/package.json`)('playwright')
const base = 'http://127.0.0.1:8765'

let server = null
async function startServer() {
  server = spawn('uv', ['run', 'python', '../docs/sample-book/serve.py', book], {
    cwd: `${repo}/backend`,
    stdio: 'ignore',
  })
  for (;;) {
    try {
      if ((await fetch(`${base}/api/payment-methods`)).ok) return
    } catch {}
    await new Promise((wait) => setTimeout(wait, 300))
  }
}
async function stopServer() {
  const exited = new Promise((done) => server.once('exit', done))
  server.kill('SIGINT')
  await exited
  for (;;) {
    try {
      await fetch(`${base}/api/payment-methods`)
    } catch {
      return
    }
    await new Promise((wait) => setTimeout(wait, 200))
  }
}
const say = (label, value) => console.log(`  ${label}:`, typeof value === 'string' ? JSON.stringify(value) : value)

await startServer()

console.log('== L6: what the server says about caching')
for (const path of ['/', '/index.html', '/sw.js', '/manifest.webmanifest', '/registerSW.js']) {
  const response = await fetch(`${base}${path}`)
  say(`${path} Cache-Control`, `${response.status} ${response.headers.get('cache-control')}`)
}
const html = await (await fetch(`${base}/`)).text()
const asset = html.match(/\/assets\/[^"]+\.js/)[0]
say(`${asset.replace(/-[\w-]+\.js/, '-….js')} Cache-Control`, (await fetch(`${base}${asset}`)).headers.get('cache-control'))
say('/api/update', JSON.stringify(await (await fetch(`${base}/api/update`)).json()))
const manifest = await (await fetch(`${base}/manifest.webmanifest`)).json()
say('manifest', JSON.stringify({ name: manifest.name, short_name: manifest.short_name, display: manifest.display, start_url: manifest.start_url, icons: manifest.icons.length }))

console.log('== L6: the service worker and its caches')
const browser = await chromium.launch({ channel: process.env.CHROMIUM ? undefined : 'chrome' })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()
page.setDefaultTimeout(20000)
await page.clock.setFixedTime(new Date('2026-10-19T11:00:00'))
const api = []
page.on('request', (r) => {
  const url = new URL(r.url())
  if (url.pathname.startsWith('/api/')) api.push(`${r.method()} ${url.pathname}${url.search}`)
})
await page.goto(`${base}/`)
await page.evaluate(async () => {
  await navigator.serviceWorker.ready
})
say('version in the top bar', await page.locator('sup.version').innerText())
say('controlling this first load', await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
await page.reload()
await page.waitForLoadState('networkidle')
say('controlling after a reload', await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
await page.goto(`${base}/mortgages/2`)
await page.waitForLoadState('networkidle')
await page.goto(`${base}/customers/1`)
await page.waitForLoadState('networkidle')
const caches = await page.evaluate(async () => {
  const out = {}
  for (const name of await caches.keys()) {
    const cache = await caches.open(name)
    out[name] = (await cache.keys()).map((r) => new URL(r.url).pathname + new URL(r.url).search)
  }
  return out
})
for (const [name, urls] of Object.entries(caches)) {
  say(`cache ${name}`, `${urls.length} entries`)
  say('  any /api/', urls.some((u) => u.startsWith('/api/')))
  say('  any /ocr/', urls.some((u) => u.startsWith('/ocr/')))
  if (name.startsWith('workbox-precache')) say('  files', urls.map((u) => u.replace(/\?__WB_REVISION__=\w+/, '').replace(/-[\w-]{8,}\.(js|css)$/, '-….$1')))
  else say('  pages', urls.filter((u) => !u.includes('.')).concat(urls.filter((u) => u.endsWith('.html'))).map((u) => u.replace(/\?__WB_REVISION__=\w+/, '?__WB_REVISION__=…')))
}

console.log('== L6: the Dashboard on a fresh book')
const dash = await (await fetch(`${base}/api/dashboard`)).json()
say('collateral_value, loan_to_value', `${dash.collateral_value} ${dash.loan_to_value}`)
say('reminders_to_send, reminders_to_approve, call_list_count', `${dash.reminders_to_send} ${dash.reminders_to_approve} ${dash.call_list_count}`)
const active = (await (await fetch(`${base}/api/mortgages?status=active&paged=false`)).json()).items
let owed = 0
let valued = 0
for (const row of active) {
  const m = await (await fetch(`${base}/api/mortgages/${row.id}`)).json()
  say(`  ${m.id} ${m.name}`, `owes ${m.outstanding.total}, ${m.purity_karat ?? '?'}K, collateral ${m.collateral ? `${m.collateral.value} (${m.collateral.source ?? m.collateral.kind ?? ''})` : 'none'}`)
  if (m.collateral) {
    owed += m.outstanding.total
    valued += m.collateral.value
  }
}
say('owed where valued / value', `${owed} / ${valued} = ${owed / valued}`)

console.log('== L6: the server stops')
await page.goto(`${base}/`)
await page.waitForLoadState('networkidle')
await stopServer()
api.length = 0
const started = Date.now()
await page.reload()
await page.getByText(/The app isn't running/).waitFor()
say('reload while stopped: shown after', `${Math.round((Date.now() - started) / 100) / 10} s`)
say('shown', await page.locator('main').innerText())
say('api asked', api)
await page.goto(`${base}/mortgages/7`)
await page.getByText(/The app isn't running/).waitFor()
say('a page never visited, while stopped', await page.locator('main').innerText())
await page.waitForTimeout(4500)
say('api asked while waiting (every 2 s)', api.length)

console.log('== L6: the server starts again')
let reloaded = false
page.once('load', () => (reloaded = true))
await startServer()
const back = Date.now()
await page.locator('h2', { hasText: 'Gold earrings' }).or(page.locator('section.card h2')).first().waitFor()
say('reloaded by itself', reloaded)
say('after', `${Math.round((Date.now() - back) / 100) / 10} s`)
say('shown', await page.locator('section.card h2').first().innerText())

await browser.close()
await stopServer()
