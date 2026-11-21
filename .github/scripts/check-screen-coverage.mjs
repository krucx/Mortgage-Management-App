import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Every screen in the router is covered by a scenario: each route declared in
// frontend/src/App.tsx appears in at least one @screen:<route> tag in qa/features, or is
// listed, with the ticket that will cover it, in qa/screens-to-cover.txt. The list only
// shrinks: a listed route that is covered now, or is no longer a route, fails too.

const GAPS = 'qa/screens-to-cover.txt'
const routePath = /\bpath="([^"]+)"/
const screenTag = /@screen:(\S+)/g
const gapLine = /^\S+\s+#\d+$/

export function checkScreenCoverage({ appTsx, features, gaps }) {
  // Each <Route>'s own path, wherever it sits among the element's attributes.
  const routes = appTsx
    .split(/<Route\s/)
    .slice(1)
    .map((element) => element.match(routePath)?.[1])
    .filter(Boolean)
  const screens = new Set(
    Object.values(features).flatMap((text) => [...text.matchAll(screenTag)].map((match) => match[1])),
  )
  const errors = []
  const listed = new Set()
  for (const line of gaps.split('\n').map((text) => text.trim()).filter(Boolean)) {
    const route = line.split(/\s+/)[0]
    listed.add(route)
    if (!gapLine.test(line)) {
      errors.push(`${GAPS}: "${line}" needs the ticket that covers it, as "<route>  #<issue>".`)
      continue
    }
    if (!routes.includes(route)) errors.push(`${route} is not a route in frontend/src/App.tsx: remove it from ${GAPS}.`)
    else if (screens.has(route)) errors.push(`${route} is covered now: remove it from ${GAPS}.`)
  }
  for (const route of routes) {
    if (!screens.has(route) && !listed.has(route)) {
      errors.push(`No scenario covers ${route}: tag one @screen:${route} in qa/features.`)
    }
  }
  return errors
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const features = Object.fromEntries(
    readdirSync('qa/features')
      .filter((name) => name.endsWith('.feature'))
      .map((name) => [name, readFileSync(join('qa/features', name), 'utf8')]),
  )
  const errors = checkScreenCoverage({
    appTsx: readFileSync('frontend/src/App.tsx', 'utf8'),
    features,
    gaps: readFileSync(GAPS, 'utf8'),
  })
  if (errors.length) {
    for (const error of errors) console.error(`::error::${error}`)
    process.exit(1)
  }
  console.log('Every screen in the router is covered by a scenario or listed with its ticket.')
}
