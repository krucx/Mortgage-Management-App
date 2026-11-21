import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Every screen in the router is covered by a scenario: each route declared in
// frontend/src/App.tsx appears in at least one @screen:<route> tag in qa/features, or is
// listed in qa/screens-to-cover/<issue>.txt, one route per line, by the ticket that will
// cover it. The lists only shrink: a listed route that is covered now, or is no longer a
// route, fails too, and a ticket whose routes are all covered deletes its own file.

const GAPS = 'qa/screens-to-cover'
const routePath = /\bpath="([^"]+)"/
const screenTag = /@screen:(\S+)/g
const ticketFile = /^\d+\.txt$/

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
  const listedIn = new Map()
  for (const [name, text] of Object.entries(gaps).sort(([a], [b]) => a.localeCompare(b))) {
    const file = `${GAPS}/${name}`
    if (!ticketFile.test(name)) errors.push(`${file}: name it after the ticket that will cover its routes, as <issue>.txt.`)
    const listed = text.split('\n').map((line) => line.trim()).filter(Boolean)
    if (!listed.length) {
      errors.push(`${file} lists no route: delete the file.`)
      continue
    }
    const fileErrors = []
    for (const route of listed) {
      if (listedIn.has(route)) {
        fileErrors.push(`${route} is listed twice, in ${listedIn.get(route)} and ${file}: keep it in one ticket's file.`)
        continue
      }
      listedIn.set(route, file)
      if (!routes.includes(route)) fileErrors.push(`${route} is not a route in frontend/src/App.tsx: remove it from ${file}.`)
      else if (screens.has(route)) fileErrors.push(`${route} is covered now: remove it from ${file}.`)
    }
    if (listed.every((route) => screens.has(route))) errors.push(`Every route in ${file} is covered now: delete the file.`)
    else errors.push(...fileErrors)
  }
  for (const route of routes) {
    if (!screens.has(route) && !listedIn.has(route)) {
      errors.push(
        `No scenario covers ${route}: tag one @screen:${route} in qa/features, or list it in ${GAPS}/<issue>.txt for the ticket that will cover it.`,
      )
    }
  }
  return errors
}

// Git keeps no empty folder, so once every ticket has deleted its file the folder is gone.
const readFolder = (dir, suffix) =>
  Object.fromEntries(
    (existsSync(dir) ? readdirSync(dir) : [])
      .filter((name) => !name.startsWith('.') && name.endsWith(suffix))
      .map((name) => [name, readFileSync(join(dir, name), 'utf8')]),
  )

if (import.meta.url === `file://${process.argv[1]}`) {
  const errors = checkScreenCoverage({
    appTsx: readFileSync('frontend/src/App.tsx', 'utf8'),
    features: readFolder('qa/features', '.feature'),
    gaps: readFolder(GAPS, ''),
  })
  if (errors.length) {
    for (const error of errors) console.error(`::error::${error}`)
    process.exit(1)
  }
  console.log('Every screen in the router is covered by a scenario or listed in its ticket\'s file.')
}
