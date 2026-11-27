import { readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CHANGELOG_FILE, FRAGMENTS_DIR, FRAGMENTS_README, VERSION_FILE } from './lib/release-candidate-files.mjs'

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

const fragmentTypes = ['added', 'changed', 'deprecated', 'removed', 'fixed', 'security']
const typeHeadings = {
  added: 'Added',
  changed: 'Changed',
  deprecated: 'Deprecated',
  removed: 'Removed',
  fixed: 'Fixed',
  security: 'Security',
}
const fragmentName = /^(.+)\.(added|changed|deprecated|removed|fixed|security)\.md$/

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

export function listFragments(dir) {
  const entries = readdirSync(dir).filter((name) => name !== FRAGMENTS_README && name.endsWith('.md'))
  const fragments = []
  for (const name of entries) {
    const match = fragmentName.exec(name)
    if (!match) throw new Error(`Invalid changelog fragment name: ${name} (expected <unique>.<added|changed|deprecated|removed|fixed|security>.md)`)
    const body = readFileSync(join(dir, name), 'utf8').trim()
    if (!body) throw new Error(`Changelog fragment ${name} is empty`)
    fragments.push({ name, type: match[2], body, path: join(dir, name) })
  }
  fragments.sort((left, right) => left.name.localeCompare(right.name))
  return fragments
}

export function assembleFragments(fragments) {
  if (!fragments.length) throw new Error('changelog/unreleased has no authored fragments')
  const byType = Object.fromEntries(fragmentTypes.map((type) => [type, []]))
  for (const fragment of fragments) {
    byType[fragment.type].push(fragment.body.trim())
  }
  const sections = []
  for (const type of fragmentTypes) {
    const bodies = byType[type]
    if (!bodies.length) continue
    sections.push(`### ${typeHeadings[type]}\n\n${bodies.join('\n\n')}`)
  }
  return sections.join('\n\n')
}

export function prepareRelease(root, version, date) {
  const changelogPath = resolve(root, CHANGELOG_FILE)
  const changelog = readFileSync(changelogPath, 'utf8')
  const fragmentsDir = resolve(root, FRAGMENTS_DIR)
  const fragments = listFragments(fragmentsDir)
  const notes = assembleFragments(fragments)
  const parsedDate = new Date(`${date}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid release date: ${date}`)
  }
  const heading = /^## Unreleased[ \t]*\r?\n/m.exec(changelog)
  if (!heading) throw new Error('CHANGELOG.md is missing its Unreleased heading')
  const bodyStart = heading.index + heading[0].length
  const remainder = changelog.slice(bodyStart)
  const nextSection = /^## \[/m.exec(remainder)
  const after = nextSection ? remainder.slice(nextSection.index) : ''
  const updated = `${changelog.slice(0, heading.index)}## Unreleased\n\n## [${version}] - ${date}\n\n${notes}\n\n${after}`
  writeFileSync(resolve(root, VERSION_FILE), `${version}\n`)
  writeFileSync(changelogPath, updated)
  for (const fragment of fragments) unlinkSync(fragment.path)
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
  if (process.argv.includes('--check-only')) {
    console.log(`Version ${version} is higher than published ${latest} and main ${current}`)
  } else {
    prepareRelease(root, version, date)
    console.log(`Prepared release ${version} dated ${date}`)
  }
}
