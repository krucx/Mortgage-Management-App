// A fake GitHub adapter for tests. It implements the same interface as
// github-adapter.mjs (the real adapter) in memory, with no network or git calls,
// and records what the Release module asked it to do.
export function createFakeGithubAdapter({ pullRequests = {}, reviews = {}, checks = {}, tags = {}, runs = [], releaseTags = [] } = {}) {
  const tagCommits = new Map(Object.entries(tags))
  const createdTags = []
  const dispatched = []
  const failedRunLogs = []
  return {
    createdTags,
    dispatched,
    failedRunLogs,
    getPublishedReleaseTags() {
      return releaseTags
    },
    getPullRequest(number) {
      const pullRequest = pullRequests[number]
      if (!pullRequest) throw new Error(`No fake pull request #${number}`)
      return pullRequest
    },
    getReviews(number) {
      return reviews[number] ?? []
    },
    getChecks(number) {
      return checks[number] ?? []
    },
    getTagCommit(tag) {
      return tagCommits.get(tag)
    },
    createTag(tag, commit, message) {
      tagCommits.set(tag, commit)
      createdTags.push({ tag, commit, message })
    },
    dispatchWorkflow(workflowFile, ref, inputs) {
      dispatched.push({ workflowFile, ref, inputs })
    },
    listWorkflowRuns() {
      return runs
    },
    showFailedRunLog(databaseId) {
      failedRunLogs.push(databaseId)
    },
  }
}
