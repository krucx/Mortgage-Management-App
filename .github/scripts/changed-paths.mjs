// Decides which heavy CI job groups a pull request can affect, from the paths it changes.
// Used by the `changes` job of test.yml and codeql.yml.
//
//   node .github/scripts/changed-paths.mjs   (reads EVENT_NAME, HEAD_REF, and for a pull
//     request PR_NUMBER and GITHUB_REPOSITORY; calls `gh api` for the changed files)
//     writes backend=, frontend=, windows=, image=, codeql= (true|false) and
//     languages= (JSON array of CodeQL languages) to $GITHUB_OUTPUT
//
// Never filtered: anything but a pull_request event (push to main, schedules, the release
// preflight, a workflow_call from release.yml), a pull request from integration/* or
// release/*, and a change to the workflow files. The cheap always-on jobs ignore this.
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { ALL_LANGUAGES, classify } from './lib/classify.mjs'

const everything = () => ({ backend: true, frontend: true, windows: true, image: true, codeql: true, languages: [...ALL_LANGUAGES] })

export function languagesFor(paths) {
  const found = new Set(paths.flatMap((path) => classify(path).languages))
  return ALL_LANGUAGES.filter((language) => found.has(language))
}

export function jobsFor({ event, headRef = '', paths }) {
  if (event !== 'pull_request' || headRef.startsWith('integration/') || headRef.startsWith('release/')) return everything()
  if (!Array.isArray(paths)) return everything()
  const classified = paths.map(classify)
  if (classified.some((c) => c.runsAll)) return everything()
  const runs = (job) => classified.some((c) => c.jobs.includes(job))
  const languages = languagesFor(paths)
  return { backend: runs('backend'), frontend: runs('frontend'), windows: runs('windows'), image: runs('image'), codeql: languages.length > 0, languages }
}

function changedFiles(repository, number) {
  const out = execFileSync('gh', ['api', '--paginate', `repos/${repository}/pulls/${number}/files`, '--jq', '.[].filename'], { encoding: 'utf8' })
  return out.split('\n').filter(Boolean)
}

function main() {
  const { EVENT_NAME: event, HEAD_REF: headRef = '', PR_NUMBER: number, GITHUB_REPOSITORY: repository } = process.env
  let paths
  if (event === 'pull_request') {
    try {
      paths = changedFiles(repository, number)
    } catch (error) {
      console.log(`Could not list the changed files (${error.message}); running everything.`)
    }
  }
  const result = jobsFor({ event, headRef, paths })
  console.log(JSON.stringify({ event, headRef, files: paths?.length, ...result }))
  if (process.env.GITHUB_OUTPUT) {
    const { languages, ...groups } = result
    const lines = Object.entries(groups).map(([name, value]) => `${name}=${value}`)
    appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\nlanguages=${JSON.stringify(languages)}\n`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
