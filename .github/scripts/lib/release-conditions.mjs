// The machine conditions under which a release pull request may merge and publish with no
// human approval. One pure function, shared by the central auto-merge allowlist (before the
// merge) and by release.mjs validate-candidate (the publish and release workflows, after it).
// A published Docker image cannot be recalled, so anything unexpected refuses.
//
// It holds only when ALL of these do:
//   1. the pull request targets main from release/X.Y.Z, X.Y.Z being the version;
//   2. the diff's VERSION file becomes exactly X.Y.Z;
//   3. the head commit is the candidate the preflight validated: a successful Tests run
//      dispatched on release/X.Y.Z at that very commit;
//   4. every required check of main is reported for the head commit and passed, and no other
//      reported check failed or is still running;
//   5. the diff holds only what the candidate workflow writes (release-candidate-files.mjs):
//      version-only changes to VERSION and the synced references, the new dated CHANGELOG
//      section (additions only), and deleted changelog fragments.
import {
  CHANGELOG_FILE,
  VERSION_FILE,
  VERSION_ONLY_FILES,
  isChangelogFragment,
} from './release-candidate-files.mjs'

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const commitPattern = /^[0-9a-f]{40}$/i
export const PREFLIGHT_WORKFLOW = '.github/workflows/test.yml'
// The publisher's own check is still running while it validates; it is never a precondition.
export const PUBLISH_CHECKS = ['release-publish', 'Publish merged release candidate / release-publish']
const PASSING = ['SUCCESS', 'NEUTRAL', 'SKIPPED']
// Not finished yet (check run status, or commit status state): a caller may wait and ask again.
const RUNNING = ['QUEUED', 'IN_PROGRESS', 'PENDING', 'WAITING', 'REQUESTED', 'EXPECTED']

const refuse = (reason, waiting = false) => ({ ok: false, reason, ...(waiting ? { waiting } : {}) })

function patchLines(patch) {
  const added = []
  const removed = []
  for (const line of String(patch).split('\n')) {
    if (line.startsWith('+')) added.push(line.slice(1))
    else if (line.startsWith('-')) removed.push(line.slice(1))
  }
  return { added, removed }
}

const withoutVersions = (line) => line.replace(/\d+\.\d+\.\d+/g, 'X.Y.Z')
const sameLines = (left, right) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())

function judgeFile(file, version) {
  const name = file?.filename
  if (!name) return 'the diff lists a file with no name'
  if (file.previous_filename || file.status === 'renamed') return `${name} was renamed from ${file.previous_filename ?? 'another file'}`
  if (isChangelogFragment(name)) {
    return file.status === 'removed' ? null : `${name} is ${file.status}; the candidate only deletes changelog fragments`
  }
  const isChangelog = name === CHANGELOG_FILE
  if (!isChangelog && !VERSION_ONLY_FILES.includes(name)) return `${name} is not a file the release candidate workflow writes`
  if (file.status !== 'modified') return `${name} is ${file.status}; the candidate only modifies it`
  if (typeof file.patch !== 'string' || !file.patch) return `${name} has no readable patch to check`
  const { added, removed } = patchLines(file.patch)
  if (isChangelog) {
    const heading = `## [${version}] - `
    const headings = added.filter((line) => line.startsWith('## '))
    if (removed.length || file.deletions) return `${CHANGELOG_FILE} removes lines; the candidate only adds the dated ${version} section`
    if (headings.length !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(headings[0].slice(heading.length).trim()) || !headings[0].startsWith(heading)) {
      return `${CHANGELOG_FILE} must add exactly one dated ${version} section and no other section`
    }
    return null
  }
  if (!added.length || !sameLines(added.map(withoutVersions), removed.map(withoutVersions)) || !added.every((line) => line.includes(version))) {
    return `${name} changes more than the version number`
  }
  if (name === VERSION_FILE && (added.length !== 1 || added[0].trim() !== version)) return `${VERSION_FILE} does not become ${version}`
  return null
}

export function judgeReleaseDiff(files, version) {
  const list = Array.isArray(files) ? files : []
  if (!list.some((file) => file?.filename === VERSION_FILE)) return `the diff does not change ${VERSION_FILE} to ${version}`
  if (!list.some((file) => file?.filename === CHANGELOG_FILE)) return `the diff does not add the ${version} section to ${CHANGELOG_FILE}`
  for (const file of list) {
    const problem = judgeFile(file, version)
    if (problem) return problem
  }
  return null
}

const checkName = (check) => String(check?.name ?? check?.context ?? '')
const checkResult = (check) => String(check?.conclusion || check?.state || check?.status || 'missing').toUpperCase()

function judgeChecks(checks, requiredChecks) {
  const required = Array.isArray(requiredChecks) ? requiredChecks.filter(Boolean) : []
  if (!required.length) return 'main has no required checks to wait for; refusing to merge unchecked'
  const reported = (Array.isArray(checks) ? checks : []).filter((check) => !PUBLISH_CHECKS.includes(checkName(check)))
  const missing = required.filter((name) => !reported.some((check) => checkName(check) === name))
  if (missing.length) return `required check ${missing.join(', ')} was not reported for the head commit`
  const describe = (list) => list.map((check) => `${checkName(check) || 'unnamed check'}: ${checkResult(check)}`).join(', ')
  const notPassing = reported.filter((check) => !PASSING.includes(checkResult(check)))
  const running = notPassing.filter((check) => RUNNING.includes(checkResult(check)))
  const failures = notPassing.filter((check) => !running.includes(check))
  if (failures.length) return `checks did not pass: ${describe(failures)}`
  if (running.length) return refuse(`checks still running: ${describe(running)}`, true)
  return null
}

function judgePreflight(runs, headSha, branch) {
  const passed = (Array.isArray(runs) ? runs : []).some((run) => (
    run?.path === PREFLIGHT_WORKFLOW &&
    run.event === 'workflow_dispatch' &&
    String(run.head_sha ?? '').toLowerCase() === headSha.toLowerCase() &&
    run.head_branch === branch &&
    run.status === 'completed' &&
    run.conclusion === 'success'
  ))
  return passed ? null : `head commit ${headSha} is not the candidate a successful preflight (Tests dispatched on ${branch}) validated`
}

// The status-check names main's rulesets require, from GitHub's "rules for a branch" response.
export function requiredCheckNames(rules) {
  return (Array.isArray(rules) ? rules : [])
    .filter((rule) => rule?.type === 'required_status_checks')
    .flatMap((rule) => rule.parameters?.required_status_checks ?? [])
    .map((check) => check.context)
}

// Where the dispatched Tests runs at a commit (the preflight) are listed, under /repos/{repo}.
export const preflightRunsPath = (headSha) => `/actions/workflows/test.yml/runs?event=workflow_dispatch&head_sha=${headSha}&per_page=100`

// pullRequest: the REST pull request; version: VERSION as the caller read it. Returns
// { ok: true } or { ok: false, reason }, with waiting: true when only unfinished checks stand in
// the way (a caller may wait and ask again).
export function judgeReleaseCandidate({ pullRequest, version, files, checks, requiredChecks, preflightRuns }) {
  if (!versionPattern.test(version ?? '')) return refuse(`invalid VERSION ${version}`)
  if (pullRequest?.base?.ref !== 'main') return refuse('the release pull request must target main')
  const branch = `release/${version}`
  if (pullRequest.head?.ref !== branch) return refuse(`release branch ${pullRequest.head?.ref} does not match VERSION ${version}`)
  const headSha = pullRequest.head?.sha
  if (!commitPattern.test(headSha ?? '')) return refuse('the release pull request has no valid head commit SHA')
  const problem = judgeReleaseDiff(files, version) ??
    judgePreflight(preflightRuns, headSha, branch) ??
    judgeChecks(checks, requiredChecks)
  if (!problem) return { ok: true }
  return typeof problem === 'string' ? refuse(problem) : problem
}
