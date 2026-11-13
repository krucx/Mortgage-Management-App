import { execFileSync } from 'node:child_process'

const versionFiles = {
  VERSION: (text) => text.trim(),
  'backend/pyproject.toml': (text) => text.match(/^version = "([^"]+)"/m)?.[1],
  'backend/uv.lock': (text) => text.match(/name = "mortgage-backend"\nversion = "([^"]+)"/)?.[1],
  'frontend/package.json': (text) => JSON.parse(text).version,
  'frontend/package-lock.json': (text) => {
    const metadata = JSON.parse(text)
    return `${metadata.version}/${metadata.packages?.['']?.version}`
  },
  'frontend/openapi.json': (text) => text.match(/"version": "([^"]+)"/)?.[1],
}

export function isReleaseCandidate({ headBranch, headRepo, baseRepo }) {
  return headRepo === baseRepo && /^release\/\d+\.\d+\.\d+$/.test(headBranch)
}

// `read(ref, path)` returns the file's text at that ref, or null when it does not exist.
export function changedVersionFiles(read, base, head) {
  return Object.entries(versionFiles).filter(([path, extract]) => {
    const before = read(base, path)
    const after = read(head, path)
    return (before && extract(before)) !== (after && extract(after))
  }).map(([path]) => path)
}

export function checkVersionUnchanged({ read, base, head, ...pullRequest }) {
  if (isReleaseCandidate(pullRequest)) return []
  return changedVersionFiles(read, base, head)
}

function gitRead(ref, path) {
  try {
    return execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { BASE_SHA, HEAD_SHA, HEAD_BRANCH, HEAD_REPO, BASE_REPO } = process.env
  if (!BASE_SHA || !HEAD_SHA) throw new Error('BASE_SHA and HEAD_SHA are required')
  const changed = checkVersionUnchanged({
    read: gitRead, base: BASE_SHA, head: HEAD_SHA,
    headBranch: HEAD_BRANCH, headRepo: HEAD_REPO, baseRepo: BASE_REPO,
  })
  if (changed.length) {
    console.error(`::error::This pull request changes the release version in: ${changed.join(', ')}.`)
    console.error('VERSION is bumped only by the Prepare release candidate workflow. Revert the version change')
    console.error('and add your notes under "## Unreleased" in CHANGELOG.md. See Documentation/RELEASE_CHECKLIST.md.')
    process.exit(1)
  }
  console.log('No release version files changed.')
}
