import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  extractReleaseNotes,
  planReleaseTag,
  validateMergedRelease,
  validateReviewAndChecks,
  verifyPublishedRelease,
} from './publish-release.mjs'

const version = '3.4.6'
const commit = 'a'.repeat(40)
const headCommit = 'b'.repeat(40)
const notes = '### Changed\n\n- The release workflow verifies published files and images.\n'
const event = {
  action: 'closed',
  pull_request: {
    number: 266,
    merged: true,
    merge_commit_sha: commit,
    base: { ref: 'main' },
    head: { ref: `release/${version}`, sha: headCommit },
  },
}

test('validates the merged release PR and derives its version and merge commit', () => {
  assert.deepEqual(validateMergedRelease(event, version), { version, commit, headCommit, pullRequest: 266 })
  assert.throws(() => validateMergedRelease({ ...event, action: 'opened' }, version), /closed as merged/)
  assert.throws(() => validateMergedRelease({ ...event, pull_request: { ...event.pull_request, merged: false } }, version), /closed as merged/)
  assert.throws(() => validateMergedRelease({ ...event, pull_request: { ...event.pull_request, base: { ref: 'develop' } } }, version), /target main/)
  assert.throws(() => validateMergedRelease({ ...event, pull_request: { ...event.pull_request, head: { ref: 'release/3.4.5' } } }, version), /does not match VERSION/)
})

test('requires an approved human review and every reported check to pass', () => {
  const checks = [
    { name: 'backend', conclusion: 'SUCCESS' },
    { name: 'CodeRabbit', conclusion: 'SUCCESS' },
    { name: 'release-publish', status: 'IN_PROGRESS' },
    { name: 'Publish merged release candidate / release-publish', status: 'IN_PROGRESS' },
  ]
  const approved = [{ user: { login: 'reviewer', type: 'User' }, state: 'APPROVED', commit_id: headCommit, submitted_at: '2026-11-09T09:00:00Z' }]
  assert.doesNotThrow(() => validateReviewAndChecks(approved, checks, 'author', headCommit))
  assert.throws(() => validateReviewAndChecks([], checks, 'author', headCommit), /no current human approval/)
  assert.throws(() => validateReviewAndChecks([{ user: { login: 'author', type: 'User' }, state: 'APPROVED', commit_id: headCommit }], checks, 'author', headCommit), /no current human approval/)
  assert.throws(() => validateReviewAndChecks([{ user: { login: 'review-bot[bot]', type: 'Bot' }, state: 'APPROVED', commit_id: headCommit }], checks, 'author', headCommit), /no current human approval/)
  assert.throws(() => validateReviewAndChecks([{ ...approved[0], commit_id: commit }], checks, 'author', headCommit), /no current human approval/)
  assert.throws(() => validateReviewAndChecks([
    ...approved,
    { user: { login: 'reviewer', type: 'User' }, state: 'CHANGES_REQUESTED', commit_id: headCommit, submitted_at: '2026-11-09T10:00:00Z' },
  ], checks, 'author', headCommit), /no current human approval/)
  assert.doesNotThrow(() => validateReviewAndChecks([
    ...approved,
    { user: { login: 'reviewer', type: 'User' }, state: 'COMMENTED', commit_id: headCommit, submitted_at: '2026-11-09T10:00:00Z' },
  ], checks, 'author', headCommit))
  assert.throws(() => validateReviewAndChecks(approved, [{ name: 'backend', conclusion: 'FAILURE' }], 'author', headCommit), /backend.*FAILURE/)
  assert.throws(() => validateReviewAndChecks(approved, [], 'author', headCommit), /no completed checks/)
})

test('creates a missing tag, reuses the same tag, and refuses a moved tag', () => {
  assert.equal(planReleaseTag(commit, undefined), 'create')
  assert.equal(planReleaseTag(commit, commit), 'reuse')
  assert.throws(() => planReleaseTag(commit, 'b'.repeat(40)), /points at/)
})

test('extracts only the requested dated release section', () => {
  const changelog = `# Changelog\n\n## [3.4.7] - 2026-11-10\n\nNewer notes.\n\n## [${version}] - 2026-11-09\n\n${notes}\n## [3.4.4] - 2026-11-07\n\nOlder notes.\n`
  assert.equal(extractReleaseNotes(changelog, version), notes.trim())
  assert.throws(() => extractReleaseNotes(changelog, '3.4.5'), /no dated changelog section/)
})

test('verifies the GitHub release body, downloadable ZIP, version image, and latest image', () => {
  const image = { schemaVersion: 2, manifests: [{ digest: `sha256:${'a'.repeat(64)}` }] }
  const release = {
    tagName: version,
    body: notes,
    isLatest: true,
    assets: [{ name: `mortgage-management-${version}.zip`, size: 1234 }],
  }
  assert.doesNotThrow(() => verifyPublishedRelease({ version, expectedNotes: notes.trim(), release, image, latestImage: image, expectedLatest: true }))
  assert.throws(() => verifyPublishedRelease({ version, expectedNotes: 'different', release, image, latestImage: image, expectedLatest: true }), /release notes do not match/)
  assert.throws(() => verifyPublishedRelease({ version, expectedNotes: notes.trim(), release: { ...release, assets: [] }, image, latestImage: image, expectedLatest: true }), /downloadable ZIP/)
  assert.throws(() => verifyPublishedRelease({ version, expectedNotes: notes.trim(), release, image: {}, latestImage: image, expectedLatest: true }), /container image/)
  assert.throws(() => verifyPublishedRelease({ version, expectedNotes: notes.trim(), release: { ...release, isLatest: false }, image, expectedLatest: true }), /latest-release flag/)
  assert.throws(() => verifyPublishedRelease({
    version,
    expectedNotes: notes.trim(),
    release,
    image,
    latestImage: { schemaVersion: 2, manifests: [{ digest: `sha256:${'b'.repeat(64)}` }] },
    expectedLatest: true,
  }), /does not point at the published version image/)
})

test('the CLI verifies a release using fixture files without publishing', () => {
  const root = mkdtempSync(join(tmpdir(), 'publish-release-'))
  try {
    const script = new URL('./publish-release.mjs', import.meta.url).pathname
    const changelog = join(root, 'CHANGELOG.md')
    const release = join(root, 'release.json')
    const image = join(root, 'image.json')
    writeFileSync(changelog, `## [${version}] - 2026-11-09\n\n${notes}\n## [3.4.4] - 2026-11-07\n\nOlder.\n`)
    writeFileSync(release, JSON.stringify({ tagName: version, body: notes, isLatest: true, assets: [{ name: `mortgage-management-${version}.zip`, size: 1234 }] }))
    writeFileSync(image, JSON.stringify({ schemaVersion: 2, manifests: [{ digest: `sha256:${'a'.repeat(64)}` }] }))
    const result = spawnSync(process.execPath, [script, 'verify-published', '--version', version, '--changelog', changelog, '--release', release, '--image', image, '--latest-image', image, '--expected-latest', 'true'], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Verified published release 3\.4\.6/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the CLI validates a merged release, human review, checks, and idempotent tag plan', () => {
  const root = mkdtempSync(join(tmpdir(), 'publish-release-'))
  try {
    const script = new URL('./publish-release.mjs', import.meta.url).pathname
    const eventPath = join(root, 'event.json')
    const reviewPath = join(root, 'reviews.json')
    writeFileSync(eventPath, JSON.stringify(event))
    writeFileSync(reviewPath, JSON.stringify({
      author: 'author',
      headCommit,
      reviews: [{ user: { login: 'reviewer', type: 'User' }, state: 'APPROVED', commit_id: headCommit, submitted_at: '2026-11-09T09:00:00Z' }],
      statusCheckRollup: [{ name: 'backend', conclusion: 'SUCCESS' }],
    }))
    const validated = spawnSync(process.execPath, [script, 'validate-merged', '--event', eventPath, '--version', version], { encoding: 'utf8' })
    assert.equal(validated.status, 0, validated.stderr)
    assert.deepEqual(JSON.parse(validated.stdout), { version, commit, headCommit, pullRequest: 266 })

    const reviewed = spawnSync(process.execPath, [script, 'validate-review', '--input', reviewPath], { encoding: 'utf8' })
    assert.equal(reviewed.status, 0, reviewed.stderr)

    const create = spawnSync(process.execPath, [script, 'plan-tag', '--commit', commit], { encoding: 'utf8' })
    assert.equal(create.status, 0, create.stderr)
    assert.equal(create.stdout.trim(), 'create')
    const reuse = spawnSync(process.execPath, [script, 'plan-tag', '--commit', commit, '--existing-tag-sha', commit], { encoding: 'utf8' })
    assert.equal(reuse.status, 0, reuse.stderr)
    assert.equal(reuse.stdout.trim(), 'reuse')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('publisher configures an annotated-tag identity and supports safe manual recovery', () => {
  const workflow = readFileSync(new URL('../workflows/publish-release.yml', import.meta.url), 'utf8')
  assert.match(workflow, /git config user\.name "github-actions\[bot\]"/)
  assert.match(workflow, /git config user\.email "41898282\+github-actions\[bot\]@users\.noreply\.github\.com"/)
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /repos\/\$GITHUB_REPOSITORY\/pulls\/\$PR_NUMBER/)
  assert.match(workflow, /secrets\.RELEASE_WORKFLOW_TOKEN \|\| github\.token/)
  assert.match(workflow, /RELEASE_WORKFLOW_TOKEN_AVAILABLE: \$\{\{ secrets\.RELEASE_WORKFLOW_TOKEN != '' \}\}/)
})
