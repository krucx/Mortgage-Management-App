import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { reportBlocked, rerunCommand, resolveBlocked } from './release-blocked.mjs'

const REPO = 'o/r'
const RUN = 'https://github.com/o/r/actions/runs/7'

// An in-memory issue store with the same interface as the GitHub client's issuesLabeled().
function fakeIssueStore(existing = []) {
  const issues = existing.map((issue) => ({ comments: [], ...issue }))
  return {
    issues,
    async list() { return issues },
    async create(issue) {
      const created = { ...issue, number: 100 + issues.length, state: 'open', comments: [] }
      issues.push(created)
      return created
    },
    async update(number, changes) {
      const issue = issues.find((candidate) => candidate.number === number)
      Object.assign(issue, changes)
      return issue
    },
    async comment(number, body) {
      issues.find((candidate) => candidate.number === number).comments.push(body)
    },
  }
}

const failure = (overrides = {}) => ({ repo: REPO, version: '1.4.0', stage: 'preflight', runUrl: RUN, ...overrides })

test('a first failure opens one release-blocked issue naming the stage, run link and rerun command', async () => {
  const store = fakeIssueStore()
  const result = await reportBlocked(store, failure({ detailUrl: 'https://github.com/o/r/actions/runs/8' }))
  assert.deepEqual(result, { action: 'created', number: 100 })
  assert.equal(store.issues.length, 1)
  const [issue] = store.issues
  assert.equal(issue.title, 'Release 1.4.0 blocked')
  assert.deepEqual(issue.labels, ['release-blocked'])
  assert.match(issue.body, /Stage: \*\*preflight\*\*/)
  assert.ok(issue.body.includes(RUN))
  assert.ok(issue.body.includes('https://github.com/o/r/actions/runs/8'))
  assert.ok(issue.body.includes('gh workflow run release-candidate.yml --repo o/r --ref main -f version=1.4.0'))
})

test('a second failure for the same version updates the open issue instead of opening another', async () => {
  const store = fakeIssueStore()
  await reportBlocked(store, failure())
  const result = await reportBlocked(store, failure({ stage: 'tag', pullRequest: 42, runUrl: 'https://github.com/o/r/actions/runs/9' }))
  assert.deepEqual(result, { action: 'updated', number: 100 })
  assert.equal(store.issues.length, 1)
  const [issue] = store.issues
  assert.match(issue.body, /Stage: \*\*tag\*\*/)
  assert.ok(issue.body.includes('runs/9'))
  assert.equal(issue.comments.length, 1)
  assert.match(issue.comments[0], /tag.*runs\/9/s)
})

test('another version, a closed issue or a plain mention of the version gets its own new issue', async () => {
  const store = fakeIssueStore([
    { number: 1, state: 'open', title: 'Release 1.3.0 blocked', body: '<!-- release-blocked:1.3.0 -->' },
    { number: 2, state: 'closed', title: 'Release 1.4.0 blocked', body: '<!-- release-blocked:1.4.0 -->' },
    { number: 3, state: 'open', title: 'Notes on 1.4.0', body: 'release-blocked 1.4.0 discussion' },
  ])
  const result = await reportBlocked(store, failure())
  assert.equal(result.action, 'created')
  assert.equal(store.issues.length, 4)
})

test('an issue whose title was edited is still found by its marker', async () => {
  const store = fakeIssueStore([{ number: 5, state: 'open', title: 'renamed', body: 'x\n<!-- release-blocked:1.4.0 -->' }])
  assert.deepEqual(await reportBlocked(store, failure()), { action: 'updated', number: 5 })
  assert.equal(store.issues.length, 1)
})

test('the rerun command restarts preparation for early stages and the publisher once the pull request merged', () => {
  for (const stage of ['preparation', 'preflight', 'merge']) {
    assert.equal(rerunCommand({ repo: REPO, version: '1.4.0', stage }),
      'gh workflow run release-candidate.yml --repo o/r --ref main -f version=1.4.0')
  }
  for (const stage of ['validate', 'tag', 'publish']) {
    assert.equal(rerunCommand({ repo: REPO, version: '1.4.0', stage, pullRequest: 42 }),
      'gh workflow run publish-release.yml --repo o/r --ref main -f pull_request=42')
  }
})

test('an unknown stage, or tag/publish without a pull request, is refused', async () => {
  await assert.rejects(reportBlocked(fakeIssueStore(), failure({ stage: 'deploy' })), /stage/)
  assert.throws(() => rerunCommand({ repo: REPO, version: '1.4.0', stage: 'publish' }), /pull request/)
})

test('a successful publish closes the open issue for its version, and nothing else', async () => {
  const store = fakeIssueStore([{ number: 1, state: 'open', title: 'Release 1.3.0 blocked', body: '<!-- release-blocked:1.3.0 -->' }])
  await reportBlocked(store, failure())
  assert.deepEqual(await resolveBlocked(store, { version: '1.4.0', runUrl: RUN }), { action: 'closed', number: 101 })
  assert.equal(store.issues[1].state, 'closed')
  assert.match(store.issues[1].comments.at(-1), /published/)
  assert.equal(store.issues[0].state, 'open')
  assert.deepEqual(await resolveBlocked(store, { version: '1.4.0', runUrl: RUN }), { action: 'none' })
})

// The release path reports and stops: no automatic retry, rollback, or tag/image removal (#572).
test('no release workflow or script retries a run or removes a tag, release or image', async () => {
  const root = new URL('../', import.meta.url)
  const files = [
    'workflows/release-candidate.yml', 'workflows/publish-release.yml', 'workflows/release.yml',
    'scripts/release.mjs', 'scripts/github-adapter.mjs', 'scripts/auto-merge.mjs', 'scripts/release-blocked.mjs',
  ]
  const forbidden = [
    /gh run rerun/, /\/rerun\b/, /git push[^\n]*(--delete|\s:refs\/)/, /git tag (-d|--delete)/,
    /gh release delete/, /docker (rmi|image rm)/, /\bDELETE\b/, /hub\.docker\.com/,
  ]
  for (const file of files) {
    const text = readFileSync(new URL(file, root), 'utf8')
    for (const pattern of forbidden) assert.doesNotMatch(text, pattern, `${file} must not match ${pattern}`)
  }
})
