import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export function validateVersionRequest(version, latestPublished, currentMain) {
  if (!versionPattern.test(version ?? '')) throw new Error('Requested version must be major.minor.patch without leading zeroes')
  if (!versionPattern.test(latestPublished ?? '')) throw new Error('Latest published version must be major.minor.patch')
  if (!versionPattern.test(currentMain ?? '')) throw new Error('Current main version must be major.minor.patch')
  const floor = compareVersions(latestPublished, currentMain) > 0 ? latestPublished : currentMain
  if (compareVersions(version, floor) <= 0) {
    throw new Error(`Requested version ${version} must be higher than latest published version ${latestPublished} and current main version ${currentMain}`)
  }
}

export function compareVersions(left, right) {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return 0
}

export function releaseNotes(changelog) {
  const heading = /^## Unreleased[ \t]*\r?\n/m.exec(changelog)
  if (!heading) throw new Error('CHANGELOG.md is missing its Unreleased heading')
  const bodyStart = heading.index + heading[0].length
  const remainder = changelog.slice(bodyStart)
  const nextSection = /^## \[/m.exec(remainder)
  const notes = remainder.slice(0, nextSection?.index ?? remainder.length).trim()
  if (!notes || !notes.replace(/^#{1,6}[^\n]*$/gm, '').trim()) {
    throw new Error('CHANGELOG.md has no human-authored release notes under Unreleased')
  }
  return notes
}

export function prepareRelease(root, version, date) {
  const changelogPath = resolve(root, 'CHANGELOG.md')
  const changelog = readFileSync(changelogPath, 'utf8')
  const notes = releaseNotes(changelog)
  const parsedDate = new Date(`${date}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid release date: ${date}`)
  }
  const updated = changelog.replace(
    /^## Unreleased[ \t]*\r?\n(?:[ \t]*\r?\n)*/m,
    `## Unreleased\n\n## [${version}] - ${date}\n\n`,
  )
  if (updated === changelog) throw new Error('CHANGELOG.md is missing its Unreleased heading')
  writeFileSync(resolve(root, 'VERSION'), `${version}\n`)
  writeFileSync(changelogPath, updated)
}

function option(name) {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const version = option('--version')
  const latest = option('--latest-published')
  const current = option('--current-version')
  const root = option('--root') ?? resolve(new URL('../..', import.meta.url).pathname)
  const date = option('--date') ?? new Date().toISOString().slice(0, 10)
  validateVersionRequest(version, latest, current)
  prepareRelease(root, version, date)
  console.log(`Prepared release ${version} dated ${date}`)
}
