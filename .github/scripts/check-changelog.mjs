import { execFileSync } from 'node:child_process'
import { isReleaseCandidate } from './check-version-unchanged.mjs'

const fragmentPath = /^changelog\/unreleased\/.+\.(added|changed|deprecated|removed|fixed|security)\.md$/

const allowlistPrefixes = [
  'Documentation/',
  '.claude/',
  '.agents/',
  '.github/',
  'changelog/',
]

const allowlistFiles = new Set([
  'AGENTS.md',
  'CLAUDE.md',
  'CONTRIBUTING.md',
  'LICENSE',
  '.editorconfig',
  '.gitignore',
  '.coderabbit.yaml',
])

export function isAllowlistedPath(path) {
  if (allowlistFiles.has(path)) return true
  return allowlistPrefixes.some((prefix) => path === prefix.slice(0, -1) || path.startsWith(prefix))
}

export function checkChangelog({ read, pathsChanged, base, head, ...pullRequest }) {
  const errors = []
  const warnings = []
  if (isReleaseCandidate(pullRequest)) return { errors, warnings }
  if (!read(base, 'changelog/unreleased/README.md')) return { errors, warnings }

  if ((read(base, 'CHANGELOG.md') ?? '') !== (read(head, 'CHANGELOG.md') ?? '')) {
    errors.push(
      'This pull request changes CHANGELOG.md. Non-release PRs must not edit it; add a fragment under changelog/unreleased/ instead. See Documentation/agents/changelog.md.',
    )
  }

  const needsNotes = pathsChanged.some((path) => !isAllowlistedPath(path))
  const addedFragment = pathsChanged.some((path) => fragmentPath.test(path))
  if (needsNotes && !addedFragment) {
    warnings.push(
      'This pull request changes product or user-facing files but adds no changelog fragment. If it needs a release note, add a file under changelog/unreleased/ named <unique>.<added|changed|fixed|removed|deprecated|security>.md. See Documentation/agents/changelog.md.',
    )
  }
  return { errors, warnings }
}

function gitRead(ref, path) {
  try {
    return execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

function gitPathsChanged(base, head) {
  const output = execFileSync('git', ['diff', '--name-only', `${base}...${head}`], { encoding: 'utf8' })
  return output.split('\n').map((line) => line.trim()).filter(Boolean)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { BASE_SHA, HEAD_SHA, HEAD_BRANCH, HEAD_REPO, BASE_REPO } = process.env
  if (!BASE_SHA || !HEAD_SHA) throw new Error('BASE_SHA and HEAD_SHA are required')
  const { errors, warnings } = checkChangelog({
    read: gitRead,
    pathsChanged: gitPathsChanged(BASE_SHA, HEAD_SHA),
    base: BASE_SHA,
    head: HEAD_SHA,
    headBranch: HEAD_BRANCH,
    headRepo: HEAD_REPO,
    baseRepo: BASE_REPO,
  })
  for (const warning of warnings) console.log(`::warning::${warning}`)
  if (errors.length) {
    for (const error of errors) console.error(`::error::${error}`)
    process.exit(1)
  }
  console.log('Changelog fragment rules satisfied.')
}
