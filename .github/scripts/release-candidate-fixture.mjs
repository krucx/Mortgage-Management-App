// Test fixture: a release pull request shaped like the real ones (#563, #559): the files the
// Prepare release candidate workflow writes, the checks the preflight reports for the candidate
// commit, and the preflight run itself. Tests change one part to prove each refusal.
export const previous = '3.4.5'
export const version = '3.4.6'
export const headCommit = 'b'.repeat(40)
export const mergeCommit = 'a'.repeat(40)
export const branch = `release/${version}`

const bump = (filename, lines) => ({
  filename,
  status: 'modified',
  additions: lines.length,
  deletions: lines.length,
  patch: `@@ -1,${lines.length} +1,${lines.length} @@\n${lines.map((line) => `-${line(previous)}`).join('\n')}\n${lines.map((line) => `+${line(version)}`).join('\n')}`,
})

export function releaseFiles() {
  return [
    {
      filename: 'CHANGELOG.md',
      status: 'modified',
      additions: 6,
      deletions: 0,
      patch: `@@ -7,6 +7,12 @@\n ## Unreleased\n \n+## [${version}] - 2026-11-09\n+\n+### Changed\n+\n+- Releases merge themselves.\n+\n ## [${previous}] - 2026-11-01`,
    },
    bump('VERSION', [(v) => v]),
    bump('backend/pyproject.toml', [(v) => `version = "${v}"`]),
    bump('backend/uv.lock', [(v) => `version = "${v}"`]),
    { filename: 'changelog/unreleased/release-auto-merge.changed.md', status: 'removed', additions: 0, deletions: 1, patch: '@@ -1 +0,0 @@\n-- Releases merge themselves.' },
    bump('docs/index.html', [(v) => `  <div class="eyebrow">Mortgage Management ${v} · documentation</div>`, (v) => `    <span>Version: <b>${v}</b></span>`, (v) => `  <footer>Written for version ${v}.</footer>`]),
    bump('docs/install.html', [(v) => `    <span>Newest release: <b>${v}</b></span>`, (v) => `Getting version ${v}...`, (v) => `  <footer>Written for version ${v}.</footer>`]),
    bump('docs/story.html', [(v) => `Mortgage Management ${v} · the story`, (v) => `alt="Version ${v} is available"`]),
    bump('docs/walkthrough.html', [(v) => `    <span>Version: <b>${v}</b></span>`]),
    bump('frontend/openapi.json', [(v) => `    "version": "${v}"`]),
    bump('frontend/package-lock.json', [(v) => `  "version": "${v}",`, (v) => `      "version": "${v}",`]),
    bump('frontend/package.json', [(v) => `  "version": "${v}",`]),
  ]
}

export const requiredChecks = [
  'backend', 'frontend', 'image', 'qa', 'windows', 'version-bump',
  'Analyze (actions)', 'Analyze (javascript-typescript)', 'Analyze (python)',
]

export function releaseChecks() {
  return [
    ...requiredChecks.map((name) => ({ name, status: 'COMPLETED', conclusion: 'SUCCESS' })),
    { name: 'release', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: 'CodeRabbit', status: 'COMPLETED', conclusion: 'SKIPPED' },
  ]
}

export function preflightRuns() {
  return [{
    path: '.github/workflows/test.yml',
    event: 'workflow_dispatch',
    head_sha: headCommit,
    head_branch: branch,
    status: 'completed',
    conclusion: 'success',
    html_url: 'https://example.invalid/run/1',
  }]
}

export function releasePullRequest(overrides = {}) {
  return {
    number: 266,
    node_id: 'PR_266',
    state: 'open',
    draft: false,
    user: { login: 'github-actions[bot]' },
    base: { ref: 'main' },
    head: { ref: branch, sha: headCommit },
    ...overrides,
  }
}
