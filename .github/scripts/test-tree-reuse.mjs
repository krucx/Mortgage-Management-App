import assert from 'node:assert/strict'
import test from 'node:test'
import { decideReuse, describeTree, lookUpReuse, statusContext, treeFromDescription } from './tree-reuse.mjs'

const TREE = 'a'.repeat(40)
const OTHER_TREE = 'b'.repeat(40)
const RUN = 'https://github.com/o/r/actions/runs/1'
const OLDER_RUN = 'https://github.com/o/r/actions/runs/0'
const context = statusContext('Tests')

// GitHub lists a commit's statuses newest first.
const passed = (tree, url = RUN) => ({ context, state: 'success', description: describeTree(tree), target_url: url })
const failed = (tree, url = RUN) => ({ context, state: 'failure', description: describeTree(tree, 'failure'), target_url: url })

test('the description round-trips the tree and rejects anything else', () => {
  assert.equal(treeFromDescription(describeTree(TREE)), TREE)
  assert.equal(treeFromDescription(describeTree(TREE, 'failure')), TREE)
  assert.equal(treeFromDescription('Passed on tree xyz'), undefined)
  assert.equal(treeFromDescription(undefined), undefined)
})

test('match: a candidate whose latest record passed on the same tree is reused', () => {
  const decision = decideReuse({ tree: TREE, context, candidates: [{ sha: 'p1', statuses: [passed(TREE)] }] })
  assert.deepEqual(decision, { reused: true, sha: 'p1', runUrl: RUN })
})

test('no match: a record for a different tree is not reused', () => {
  const decision = decideReuse({ tree: TREE, context, candidates: [{ sha: 'p1', statuses: [passed(OTHER_TREE)] }] })
  assert.equal(decision.reused, false)
  assert.match(decision.reason, /p1: validated a different tree/)
})

test('failed earlier run: the latest record failing wins over an older pass', () => {
  const decision = decideReuse({
    tree: TREE,
    context,
    candidates: [{ sha: 'p1', statuses: [failed(TREE), passed(TREE, OLDER_RUN)] }],
  })
  assert.equal(decision.reused, false)
  assert.match(decision.reason, /p1: latest run failure/)
})

test('missing record: no status, another workflow’s status, or a malformed one is not reused', () => {
  const decision = decideReuse({
    tree: TREE,
    context,
    candidates: [
      { sha: 'p1', statuses: [] },
      { sha: 'p2', statuses: [{ ...passed(TREE), context: statusContext('CodeQL') }] },
      { sha: 'p3', statuses: [{ ...passed(TREE), description: 'Tests passed' }] },
    ],
  })
  assert.equal(decision.reused, false)
  assert.match(decision.reason, /p1: no record/)
  assert.match(decision.reason, /p2: no record/)
  assert.match(decision.reason, /p3: record names no tree/)
})

test('no candidates: nothing to reuse', () => {
  assert.equal(decideReuse({ tree: TREE, context, candidates: [] }).reused, false)
})

test('the first matching candidate is reused when others do not match', () => {
  const decision = decideReuse({
    tree: TREE,
    context,
    candidates: [
      { sha: 'p1', statuses: [passed(OTHER_TREE)] },
      { sha: 'p2', statuses: [passed(TREE)] },
    ],
  })
  assert.deepEqual(decision, { reused: true, sha: 'p2', runUrl: RUN })
})

// A client that answers the three GitHub calls the lookup makes.
function fakeClient({ commit, pulls = [], statuses = {} }) {
  const asked = []
  return {
    asked,
    async request(path) {
      asked.push(path)
      if (path === `/commits/${commit.sha}`) return { data: commit }
      throw new Error(`Unexpected request ${path}`)
    },
    async getAllPages(path) {
      asked.push(path)
      if (path.startsWith(`/commits/${commit.sha}/pulls`)) return pulls
      const sha = path.match(/^\/commits\/([^/]+)\/statuses/)?.[1]
      if (sha) return statuses[sha] ?? []
      throw new Error(`Unexpected request ${path}`)
    },
  }
}

test('lookUpReuse checks the merge commit’s parents and its merged pull request’s head', async () => {
  const client = fakeClient({
    commit: { sha: 'm', commit: { tree: { sha: TREE } }, parents: [{ sha: 'main-before' }, { sha: 'pr-head' }] },
    pulls: [
      { merged_at: '2026-11-27T00:00:00Z', head: { sha: 'rebased-head' } },
      { merged_at: null, head: { sha: 'open-pr' } },
    ],
    statuses: { 'rebased-head': [passed(TREE)] },
  })
  const decision = await lookUpReuse(client, { sha: 'm', workflow: 'Tests' })
  assert.deepEqual(decision, { reused: true, sha: 'rebased-head', runUrl: RUN, tree: TREE })
  assert.ok(!client.asked.some((path) => path.includes('open-pr')))
  assert.ok(client.asked.includes('/commits/main-before/statuses?per_page=100'))
})

test('lookUpReuse runs in full when nothing recorded the tree', async () => {
  const client = fakeClient({
    commit: { sha: 'm', commit: { tree: { sha: TREE } }, parents: [{ sha: 'main-before' }] },
    statuses: { 'main-before': [passed(OTHER_TREE)] },
  })
  const decision = await lookUpReuse(client, { sha: 'm', workflow: 'Tests' })
  assert.equal(decision.reused, false)
  assert.equal(decision.tree, TREE)
})
