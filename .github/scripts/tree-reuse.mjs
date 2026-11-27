// "Has this tree already passed?" — reuse of validated CI results by git tree hash.
//
// A passing (or failing) Tests, CodeQL or Container scan run records the tree it
// validated as a commit status on the commit it ran for: context `validated-tree/<workflow>`,
// description `Passed on tree <hash>` (or `Failed on ...`), target the run. A pull request run records on the
// PR head commit, with the tree of the merge it actually tested.
//
// The push to `main` after a merge looks the record up on the merge commit's parents and on
// the head of the pull request it merged (a rebase merge has no parent with that tree). When
// the latest record of one of them passed on exactly the merged tree, the push reuses that
// result instead of running again. This holds because `main` requires a branch to be up to
// date before it merges: the PR's tested merge then has the same tree as the merge commit.
// If that rule is turned off, or `main` moved, the trees differ and everything runs in full.
//
//   node tree-reuse.mjs lookup --workflow Tests --sha <sha>
//     writes reused=true|false and run-url=<url> to $GITHUB_OUTPUT
//   node tree-reuse.mjs record --workflow Tests --sha <sha> --state success|failure --run-url <url>
//     records the tree of the checked-out HEAD (or --tree <hash>)
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { createGitHubClient } from './lib/github-client.mjs'

export const statusContext = (workflow) => `validated-tree/${workflow}`
export const describeTree = (tree, state = 'success') => `${state === 'success' ? 'Passed' : 'Failed'} on tree ${tree}`

export function treeFromDescription(description) {
  return /^(?:Passed|Failed) on tree ([0-9a-f]{40}|[0-9a-f]{64})$/.exec(description ?? '')?.[1]
}

// candidates: [{ sha, statuses }], statuses newest first as GitHub lists them.
export function decideReuse({ tree, context, candidates }) {
  const reasons = []
  for (const { sha, statuses } of candidates) {
    const latest = statuses.find((status) => status.context === context)
    if (!latest) {
      reasons.push(`${sha}: no record`)
    } else if (latest.state !== 'success') {
      reasons.push(`${sha}: latest run ${latest.state}`)
    } else if (!treeFromDescription(latest.description)) {
      reasons.push(`${sha}: record names no tree`)
    } else if (treeFromDescription(latest.description) !== tree) {
      reasons.push(`${sha}: validated a different tree`)
    } else {
      return { reused: true, sha, runUrl: latest.target_url }
    }
  }
  return { reused: false, reason: reasons.join('; ') || 'no commit to reuse from' }
}

export async function lookUpReuse(client, { sha, workflow }) {
  const { data: commit } = await client.request(`/commits/${sha}`)
  const tree = commit.commit.tree.sha
  const pulls = await client.getAllPages(`/commits/${sha}/pulls?per_page=100`)
  const shas = [
    ...commit.parents.map((parent) => parent.sha),
    ...pulls.filter((pull) => pull.merged_at).map((pull) => pull.head.sha),
  ]
  const candidates = []
  for (const candidate of new Set(shas)) {
    candidates.push({ sha: candidate, statuses: await client.getAllPages(`/commits/${candidate}/statuses?per_page=100`) })
  }
  return { ...decideReuse({ tree, context: statusContext(workflow), candidates }), tree }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  const { values } = parseArgs({
    args: rest,
    options: {
      workflow: { type: 'string' },
      sha: { type: 'string' },
      state: { type: 'string' },
      'run-url': { type: 'string' },
      tree: { type: 'string' },
    },
  })
  if (!values.workflow || !values.sha) throw new Error('--workflow and --sha are required')
  const client = createGitHubClient(process.env.GITHUB_TOKEN, process.env.GITHUB_REPOSITORY)

  if (command === 'lookup') {
    const decision = await lookUpReuse(client, values)
    const message = decision.reused
      ? `Reused result from run ${decision.runUrl}: ${values.workflow} already passed on tree ${decision.tree} (commit ${decision.sha}).`
      : `Running ${values.workflow} in full: tree ${decision.tree} has no passing record (${decision.reason}).`
    console.log(decision.reused ? `::notice title=${values.workflow} reused::${message}` : message)
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `reused=${decision.reused}\nrun-url=${decision.runUrl ?? ''}\n`)
    }
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`)
  } else if (command === 'record') {
    if (!['success', 'failure'].includes(values.state)) throw new Error('--state must be success or failure')
    const tree = values.tree ?? execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim()
    await client.request(`/statuses/${values.sha}`, 'POST', {
      state: values.state,
      target_url: values['run-url'],
      description: describeTree(tree, values.state),
      context: statusContext(values.workflow),
    })
    console.log(`Recorded ${values.workflow} ${values.state} on tree ${tree} for ${values.sha}.`)
  } else {
    throw new Error('Usage: tree-reuse.mjs lookup|record --workflow <name> --sha <sha> ...')
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
