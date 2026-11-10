import { execFileSync } from 'node:child_process'

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' })
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' })
}

// The only part of the Release module that talks to GitHub. Tests use
// fake-github-adapter.mjs instead, which implements the same interface in memory.
export function createGithubAdapter(repo) {
  return {
    getPublishedReleaseTags() {
      return JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repo}/releases?per_page=100`]))
        .flat()
        .filter((release) => !release.draft && !release.prerelease)
        .map((release) => release.tag_name)
    },
    getPullRequest(number) {
      return JSON.parse(gh(['api', `repos/${repo}/pulls/${number}`]))
    },
    getReviews(number) {
      return JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repo}/pulls/${number}/reviews?per_page=100`])).flat()
    },
    getChecks(number) {
      return JSON.parse(gh(['pr', 'view', String(number), '--repo', repo, '--json', 'statusCheckRollup'])).statusCheckRollup
    },
    getTagCommit(tag) {
      const output = git(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`])
      let direct, peeled
      for (const line of output.split('\n')) {
        const [sha, ref] = line.split('\t')
        if (!ref) continue
        if (ref === `refs/tags/${tag}^{}`) peeled = sha
        else if (ref === `refs/tags/${tag}`) direct = sha
      }
      return peeled ?? direct ?? undefined
    },
    createTag(tag, commit, message) {
      git(['config', 'user.name', 'github-actions[bot]'])
      git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'])
      git(['tag', '-a', tag, '-m', message, commit])
      git(['push', 'origin', `refs/tags/${tag}`])
    },
    dispatchWorkflow(workflowFile, ref, inputs = {}) {
      const args = ['workflow', 'run', workflowFile, '--repo', repo, '--ref', ref]
      for (const [key, value] of Object.entries(inputs)) args.push('-f', `${key}=${value}`)
      gh(args)
    },
    listWorkflowRuns(workflowFile) {
      return JSON.parse(gh([
        'run', 'list', '--repo', repo, '--workflow', workflowFile, '--event', 'workflow_dispatch',
        '--limit', '20', '--json', 'databaseId,status,conclusion,headSha,headBranch,createdAt,url',
      ]))
    },
    showFailedRunLog(databaseId) {
      execFileSync('gh', ['run', 'view', String(databaseId), '--repo', repo, '--log-failed'], { stdio: ['inherit', process.stderr, 'inherit'] })
    },
  }
}
