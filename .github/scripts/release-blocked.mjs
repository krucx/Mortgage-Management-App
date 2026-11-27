// One `release-blocked` issue per version: the release path's alarm, since no human watches it.
//
// Any failure in preparation, preflight, merge, tag or publish opens the issue for that version
// (or, if one is already open, updates it and adds a comment), naming the stage, the run link and
// the safe rerun command. GitHub's failed-run email reaches the owner too. Nothing here retries,
// rolls back, or removes a tag or image: the owner reads the run and reruns by hand. A later
// successful publish of the version closes the issue.
//
//   node release-blocked.mjs report --version X.Y.Z --stage <stage> --run-url <url>
//     [--detail-url <url>] [--pull-request <n>]
//   node release-blocked.mjs resolve --version X.Y.Z --run-url <url>
// Needs GITHUB_TOKEN (issues: write) and GITHUB_REPOSITORY.
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { createGitHubClient } from './lib/github-client.mjs'

export const LABEL = 'release-blocked'
export const STAGES = ['preparation', 'preflight', 'merge', 'tag', 'publish']

const marker = (version) => `<!-- ${LABEL}:${version} -->`

// Both reruns are safe: preparation reuses an existing candidate branch and pull request, and the
// publisher reuses a tag only at the same merge commit and replaces the same versioned image.
export function rerunCommand({ repo, version, stage, pullRequest }) {
  if (!STAGES.includes(stage)) throw new Error(`Unknown release stage ${stage}; expected one of ${STAGES.join(', ')}`)
  if (stage === 'tag' || stage === 'publish') {
    if (!pullRequest) throw new Error(`The ${stage} stage needs the release pull request number for its rerun command`)
    return `gh workflow run publish-release.yml --repo ${repo} --ref main -f pull_request=${pullRequest}`
  }
  return `gh workflow run release-candidate.yml --repo ${repo} --ref main -f version=${version}`
}

const findOpen = (issues, version) =>
  issues.find((issue) => issue.state === 'open' && !issue.pull_request && String(issue.body ?? '').includes(marker(version)))

function describe({ stage, runUrl, detailUrl, rerun }) {
  return [
    `- Stage: **${stage}**`,
    `- Run: ${runUrl}`,
    ...(detailUrl ? [`- Run it waited on: ${detailUrl}`] : []),
    `- Rerun, once the cause is understood or fixed: \`${rerun}\``,
  ].join('\n')
}

// store: list(), create(issue), update(number, changes), comment(number, body).
export async function reportBlocked(store, { repo, version, stage, runUrl, detailUrl, pullRequest }) {
  const rerun = rerunCommand({ repo, version, stage, pullRequest })
  const details = describe({ stage, runUrl, detailUrl, rerun })
  const body = [
    marker(version),
    `Release ${version} stopped. Nothing retries, rolls back, or removes a tag or image by itself.`,
    '',
    details,
    '',
    'Each later failure of this version updates this issue; a successful publish of it closes it.',
  ].join('\n')
  const existing = findOpen(await store.list(), version)
  if (!existing) {
    const created = await store.create({ title: `Release ${version} blocked`, body, labels: [LABEL] })
    return { action: 'created', number: created.number }
  }
  await store.update(existing.number, { body })
  await store.comment(existing.number, `Failed again:\n\n${details}`)
  return { action: 'updated', number: existing.number }
}

export async function resolveBlocked(store, { version, runUrl }) {
  const existing = findOpen(await store.list(), version)
  if (!existing) return { action: 'none' }
  await store.comment(existing.number, `Release ${version} published and verified: ${runUrl}`)
  await store.update(existing.number, { state: 'closed', state_reason: 'completed' })
  return { action: 'closed', number: existing.number }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  const { values } = parseArgs({
    args: rest,
    options: {
      version: { type: 'string' },
      stage: { type: 'string' },
      'run-url': { type: 'string' },
      'detail-url': { type: 'string' },
      'pull-request': { type: 'string' },
    },
  })
  const repo = process.env.GITHUB_REPOSITORY
  if (!process.env.GITHUB_TOKEN || !repo) throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY are required.')
  if (!values.version || !values['run-url']) throw new Error('--version and --run-url are required')
  const client = createGitHubClient(process.env.GITHUB_TOKEN, repo)
  const store = client.issuesLabeled(LABEL)
  let result
  if (command === 'report') {
    await client.ensureLabel({ name: LABEL, color: 'b60205', description: 'A release stopped; see the issue for the stage and rerun' })
    result = await reportBlocked(store, {
      repo,
      version: values.version,
      stage: values.stage,
      runUrl: values['run-url'],
      detailUrl: values['detail-url'] || undefined,
      pullRequest: values['pull-request'] || undefined,
    })
  } else if (command === 'resolve') {
    result = await resolveBlocked(store, { version: values.version, runUrl: values['run-url'] })
  } else {
    throw new Error('Usage: release-blocked.mjs report|resolve --version X.Y.Z --run-url <url> ...')
  }
  console.log(JSON.stringify(result))
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
