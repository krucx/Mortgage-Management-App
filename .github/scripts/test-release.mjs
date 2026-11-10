import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { validateVersionRequest } from './release-candidate.mjs'
import { createFakeGithubAdapter } from './fake-github-adapter.mjs'
import {
  dispatchAndWait,
  extractReleaseNotes,
  latestPublishedVersion,
  planAndCreateTag,
  planReleaseTag,
  validateApprovedCandidate,
  validateMergedRelease,
  validateReviewAndChecks,
  verifyPublishedRelease,
} from './release.mjs'

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

test('scenario: gets the highest published version through the fake GitHub adapter', () => {
  const adapter = createFakeGithubAdapter({ releaseTags: ['draft', '3.9.0-rc.1', '3.4.9', '3.10.0', '3.5.12'] })
  assert.equal(latestPublishedVersion(adapter), '3.10.0')
  assert.equal(latestPublishedVersion(createFakeGithubAdapter()), '0.0.0')
})

test('scenario: refuses a candidate that does not increase the fake GitHub published version', () => {
  const adapter = createFakeGithubAdapter({ releaseTags: ['3.4.6', '3.4.5'] })
  const latest = latestPublishedVersion(adapter)
  assert.equal(latest, '3.4.6')
  assert.throws(() => validateVersionRequest('3.4.6', latest, '3.4.5'), /higher than latest published/)
})

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

test('scenario: validates the merged PR and its current approval through the adapter', () => {
  const pullRequest = { ...event.pull_request, user: { login: 'author' } }
  const approved = [{ user: { login: 'reviewer', type: 'User' }, state: 'APPROVED', commit_id: headCommit, submitted_at: '2026-11-09T09:00:00Z' }]
  const checks = [{ name: 'backend', conclusion: 'SUCCESS' }]
  const adapter = createFakeGithubAdapter({
    pullRequests: { 266: pullRequest },
    reviews: { 266: approved },
    checks: { 266: checks },
  })
  assert.deepEqual(
    validateApprovedCandidate(adapter, { prNumber: 266, version }),
    { version, commit, headCommit, pullRequest: 266 },
  )
})

test('scenario: refuses when the PR is not approved after its last push', () => {
  const pullRequest = { ...event.pull_request, user: { login: 'author' } }
  const staleApproval = [{ user: { login: 'reviewer', type: 'User' }, state: 'APPROVED', commit_id: commit, submitted_at: '2026-11-09T09:00:00Z' }]
  const checks = [{ name: 'backend', conclusion: 'SUCCESS' }]
  const adapter = createFakeGithubAdapter({
    pullRequests: { 266: pullRequest },
    reviews: { 266: staleApproval },
    checks: { 266: checks },
  })
  assert.throws(
    () => validateApprovedCandidate(adapter, { prNumber: 266, version }),
    /no current human approval/,
  )
})

test('scenario: the release workflow re-verifies the approved PR against the tagged commit', () => {
  const pullRequest = { ...event.pull_request, user: { login: 'author' } }
  const approved = [{ user: { login: 'reviewer', type: 'User' }, state: 'APPROVED', commit_id: headCommit, submitted_at: '2026-11-09T09:00:00Z' }]
  const checks = [{ name: 'backend', conclusion: 'SUCCESS' }]
  const adapter = createFakeGithubAdapter({
    pullRequests: { 266: pullRequest },
    reviews: { 266: approved },
    checks: { 266: checks },
  })
  assert.throws(
    () => validateApprovedCandidate(adapter, { prNumber: 266, version, expectCommit: 'c'.repeat(40) }),
    /not the merged PR commit/,
  )
  assert.doesNotThrow(() => validateApprovedCandidate(adapter, { prNumber: 266, version, expectCommit: commit }))
})

test('creates a missing tag, reuses the same tag, and refuses a moved tag', () => {
  assert.equal(planReleaseTag(commit, undefined), 'create')
  assert.equal(planReleaseTag(commit, commit), 'reuse')
  assert.throws(() => planReleaseTag(commit, 'b'.repeat(40)), /points at/)
})

test('scenario: refuses to tag when the version tag already exists at another commit', () => {
  const adapter = createFakeGithubAdapter({ tags: { [version]: 'b'.repeat(40) } })
  assert.throws(() => planAndCreateTag(adapter, { version, commit }), /points at/)
  assert.equal(adapter.createdTags.length, 0)
})

test('scenario: reuses the version tag when it already exists at the merge commit', () => {
  const adapter = createFakeGithubAdapter({ tags: { [version]: commit } })
  assert.deepEqual(planAndCreateTag(adapter, { version, commit }), { action: 'reuse', tag: version })
  assert.equal(adapter.createdTags.length, 0)
})

test('scenario: creates the version tag when none exists yet', () => {
  const adapter = createFakeGithubAdapter()
  assert.deepEqual(planAndCreateTag(adapter, { version, commit }), { action: 'create', tag: version })
  assert.deepEqual(adapter.createdTags, [{ tag: version, commit, message: `Release ${version}` }])
})

test('scenario: refuses to create a tag when the adapter has no write access', () => {
  const adapter = createFakeGithubAdapter()
  assert.throws(
    () => planAndCreateTag(adapter, { version, commit, allowCreate: false }),
    /RELEASE_WORKFLOW_TOKEN/,
  )
  assert.equal(adapter.createdTags.length, 0)
})

test('extracts only the requested dated release section', () => {
  const changelog = `# Changelog\n\n## [3.4.7] - 2026-11-10\n\nNewer notes.\n\n## [${version}] - 2026-11-09\n\n${notes}\n## [3.4.4] - 2026-11-07\n\nOlder notes.\n`
  assert.equal(extractReleaseNotes(changelog, version), notes.trim())
  assert.throws(() => extractReleaseNotes(changelog, '3.4.5'), /no dated changelog section/)
})

test('extracts the last section in the file, with nothing after it', () => {
  const changelog = `# Changelog\n\n## [3.4.7] - 2026-11-10\n\nNewer notes.\n\n## [${version}] - 2026-11-09\n\n${notes}`
  assert.equal(extractReleaseNotes(changelog, version), notes.trim())
})

test('scenario: dispatches a workflow and reports the matching completed run', async () => {
  const runSha = commit
  const runs = [{ databaseId: 42, status: 'completed', conclusion: 'success', headSha: runSha, createdAt: '2026-11-10T00:00:10.000Z', url: 'https://example.invalid/run/42' }]
  const adapter = createFakeGithubAdapter({ runs })
  const result = await dispatchAndWait(adapter, {
    workflowFile: 'release.yml',
    ref: version,
    inputs: { pull_request: 266 },
    matchSha: runSha,
    now: () => Date.parse('2026-11-10T00:00:00.000Z'),
    sleep: async () => {},
  })
  assert.deepEqual(result, { url: 'https://example.invalid/run/42', conclusion: 'success' })
  assert.deepEqual(adapter.dispatched, [{ workflowFile: 'release.yml', ref: version, inputs: { pull_request: 266 } }])
  assert.deepEqual(adapter.failedRunLogs, [])
})

test('scenario: reports a completed but failed run and shows its log', async () => {
  const runs = [{ databaseId: 43, status: 'completed', conclusion: 'failure', headSha: commit, createdAt: '2026-11-10T00:00:10.000Z', url: 'https://example.invalid/run/43' }]
  const adapter = createFakeGithubAdapter({ runs })
  const result = await dispatchAndWait(adapter, {
    workflowFile: 'release.yml',
    ref: version,
    matchSha: commit,
    now: () => Date.parse('2026-11-10T00:00:00.000Z'),
    sleep: async () => {},
  })
  assert.deepEqual(result, { url: 'https://example.invalid/run/43', conclusion: 'failure' })
  assert.deepEqual(adapter.failedRunLogs, [43])
  assert.deepEqual(adapter.dispatched, [{ workflowFile: 'release.yml', ref: version, inputs: {} }])
})

test('scenario: failed candidate preflight keeps its branch and run URL for the failure summary', async () => {
  const branch = `release/${version}`
  const runUrl = 'https://example.invalid/run/45'
  const adapter = createFakeGithubAdapter({ runs: [{
    databaseId: 45,
    status: 'completed',
    conclusion: 'failure',
    headSha: commit,
    createdAt: '2026-11-10T00:00:10.000Z',
    url: runUrl,
  }] })
  const result = await dispatchAndWait(adapter, {
    workflowFile: 'test.yml',
    ref: branch,
    matchSha: commit,
    now: () => Date.parse('2026-11-10T00:00:00.000Z'),
    sleep: async () => {},
  })
  assert.deepEqual(result, { url: runUrl, conclusion: 'failure' })
  assert.deepEqual(adapter.dispatched, [{ workflowFile: 'test.yml', ref: branch, inputs: {} }])
  assert.deepEqual(adapter.failedRunLogs, [45])
})

test('scenario: times out when the dispatched run never appears', async () => {
  let clock = Date.parse('2026-11-10T00:00:00.000Z')
  const sleeps = []
  const adapter = createFakeGithubAdapter({ runs: [] })
  await assert.rejects(
    dispatchAndWait(adapter, {
      workflowFile: 'release.yml',
      ref: version,
      matchSha: commit,
      timeoutMs: 60_000,
      pollIntervalMs: 15_000,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms)
        clock += ms
      },
    }),
    /did not finish within 1 minutes/,
  )
  assert.deepEqual(sleeps, [15_000, 15_000, 15_000, 15_000])
})

test('CLI keeps stdout to one JSON document when a real adapter shows a failed run log', () => {
  const directory = mkdtempSync(join(tmpdir(), 'release-cli-'))
  try {
    const ghPath = join(directory, 'gh')
    writeFileSync(ghPath, `#!/usr/bin/env node
if (process.argv.includes('--log-failed')) { console.log('failed job output'); process.exit(0) }
if (process.argv[2] === 'run' && process.argv[3] === 'list') {
  console.log(JSON.stringify([{ databaseId: 74, status: 'completed', conclusion: 'failure', headSha: '${commit}', createdAt: new Date(Date.now() - 2000).toISOString(), url: 'https://example.invalid/run/74' }]))
  process.exit(0)
}
process.exit(0)
`)
    chmodSync(ghPath, 0o755)
    const result = spawnSync(process.execPath, [
      join(import.meta.dirname, 'release.mjs'), 'dispatch-and-wait', '--repo', 'owner/repo',
      '--workflow', 'release.yml', '--ref', version, '--match-sha', commit, '--timeout-minutes', '1',
    ], { encoding: 'utf8', env: { ...process.env, PATH: `${directory}:${process.env.PATH}` } })
    assert.equal(result.status, 1)
    assert.deepEqual(result.stdout.trim().split('\n'), [JSON.stringify({ url: 'https://example.invalid/run/74', conclusion: 'failure' })])
    assert.match(result.stderr, /failed job output/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
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
    const script = new URL('./release.mjs', import.meta.url).pathname
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

test('the CLI rejects an unrecognized command', () => {
  const script = new URL('./release.mjs', import.meta.url).pathname
  const result = spawnSync(process.execPath, [script, 'not-a-command'], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Usage: release\.mjs/)
})

test('the real GitHub adapter configures an annotated-tag identity as the release bot', () => {
  const adapterSource = readFileSync(new URL('./github-adapter.mjs', import.meta.url), 'utf8')
  assert.match(adapterSource, /'config', 'user\.name', 'github-actions\[bot\]'/)
  assert.match(adapterSource, /41898282\+github-actions\[bot\]@users\.noreply\.github\.com/)
})

test('the merge-publish and release workflows hold no copied jq or polling shell', () => {
  const publishWorkflow = readFileSync(new URL('../workflows/publish-release.yml', import.meta.url), 'utf8')
  const releaseWorkflow = readFileSync(new URL('../workflows/release.yml', import.meta.url), 'utf8')
  for (const workflow of [publishWorkflow, releaseWorkflow]) {
    assert.doesNotMatch(workflow, /for attempt in/)
    assert.doesNotMatch(workflow, /sleep 15/)
    assert.doesNotMatch(workflow, /--slurpfile/)
    assert.doesNotMatch(workflow, /jq -n/)
  }
  assert.match(publishWorkflow, /release\.mjs validate-candidate/)
  assert.match(publishWorkflow, /release\.mjs tag/)
  assert.match(publishWorkflow, /release\.mjs dispatch-and-wait/)
  assert.match(releaseWorkflow, /release\.mjs validate-candidate/)
  assert.match(publishWorkflow, /workflow_dispatch:/)
  assert.match(publishWorkflow, /secrets\.RELEASE_WORKFLOW_TOKEN \|\| github\.token/)
  assert.match(publishWorkflow, /RELEASE_WORKFLOW_TOKEN_AVAILABLE: \$\{\{ secrets\.RELEASE_WORKFLOW_TOKEN != '' \}\}/)
})

test('release candidate uses the Release module once for published version and shared preflight', () => {
  const candidate = readFileSync(new URL('../workflows/release-candidate.yml', import.meta.url), 'utf8')
  assert.match(candidate, /release\.mjs latest-published/)
  assert.doesNotMatch(candidate, /gh api .*releases/)
  assert.match(candidate, /release\.mjs dispatch-and-wait/)
  assert.doesNotMatch(candidate, /for attempt in|sleep 15/)
  assert.doesNotMatch(candidate, /default: 3\.4\.6/)
  assert.match(candidate, /git switch --detach "origin\/\$branch"[\s\S]*?node \.github\/scripts\/check-version\.mjs/)
  assert.match(candidate, /gh pr create --base main --head "\$BRANCH"/)
  assert.match(candidate, /Candidate branch: \$\{BRANCH:-unknown\}/)
  assert.match(candidate, /Preflight run: \$\{PREFLIGHT_URL:-not started or not completed\}/)
})

test('third-party workflow actions are pinned to full SHAs and release permissions are scoped per job', () => {
  const workflowDirectory = new URL('../workflows/', import.meta.url)
  for (const filename of readdirSync(workflowDirectory).filter((name) => name.endsWith('.yml'))) {
    const workflow = readFileSync(new URL(filename, workflowDirectory), 'utf8')
    for (const [, action, version] of workflow.matchAll(/^\s*uses:\s*([^\s]+)(?:\s+#\s*(v\S+))?\s*$/gm)) {
      if (action.startsWith('./')) continue
      assert.match(action, /^[^@]+@[0-9a-f]{40}$/, `${filename}: ${action}`)
      assert.match(version ?? '', /^v\S+$/, `${filename}: missing version comment for ${action}`)
    }
  }
  const releaseWorkflow = readFileSync(new URL('../workflows/release.yml', import.meta.url), 'utf8')
  assert.match(releaseWorkflow, /^permissions: \{\}$/m)
  assert.match(releaseWorkflow, /tests:[\s\S]*?permissions:\s*\n\s+contents: read/)
  assert.match(releaseWorkflow, /publish:[\s\S]*?permissions:\s*\n\s+contents: read\n\s+actions: write/)
  assert.match(releaseWorkflow, /github-release:[\s\S]*?permissions:\s*\n\s+contents: write/)
  assert.match(releaseWorkflow, /verify:[\s\S]*?permissions:\s*\n\s+contents: read/)
})
