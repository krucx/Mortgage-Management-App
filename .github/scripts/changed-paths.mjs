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

const startsWithAny = (path, prefixes) => prefixes.some((prefix) => path.startsWith(prefix))
const anyPath = (paths, prefixes) => paths.some((path) => startsWithAny(path, prefixes))

const WORKFLOWS = ['.github/workflows/']
const BACKEND = ['backend/']
const FRONTEND = ['frontend/']
// The scripts the heavy jobs themselves run.
const BACKEND_SCRIPTS = ['.github/scripts/check-version.mjs', '.github/scripts/coverage-summary.mjs']
const FRONTEND_SCRIPTS = [
  '.github/scripts/check-version.mjs',
  '.github/scripts/coverage-summary.mjs',
  '.github/scripts/check-screen-coverage.mjs',
  '.github/scripts/test-check-screen-coverage.mjs',
]
// check-screen-coverage reads the QA scenarios and the screens still to cover.
const QA = ['qa/']
const IMAGE = ['Dockerfile', '.dockerignore']

const ALL_LANGUAGES = ['actions', 'javascript-typescript', 'python']

export function languagesFor(paths) {
  return ALL_LANGUAGES.filter((language) => {
    if (language === 'python') return anyPath(paths, BACKEND)
    if (language === 'actions') return anyPath(paths, WORKFLOWS)
    return anyPath(paths, [...FRONTEND, ...QA, '.github/scripts/'])
  })
}

const everything = () => ({ backend: true, frontend: true, windows: true, image: true, codeql: true, languages: [...ALL_LANGUAGES] })

export function jobsFor({ event, headRef = '', paths }) {
  if (event !== 'pull_request' || headRef.startsWith('integration/') || headRef.startsWith('release/')) return everything()
  if (!Array.isArray(paths) || anyPath(paths, WORKFLOWS)) return everything()
  const version = paths.includes('VERSION')
  const backend = anyPath(paths, BACKEND)
  const frontend = anyPath(paths, FRONTEND)
  const languages = languagesFor(paths)
  return {
    backend: backend || version || anyPath(paths, BACKEND_SCRIPTS),
    frontend: frontend || version || anyPath(paths, [...QA, ...FRONTEND_SCRIPTS]),
    windows: backend || frontend || version || anyPath(paths, ['windows/']),
    image: backend || frontend || version || anyPath(paths, IMAGE),
    codeql: languages.length > 0,
    languages,
  }
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
