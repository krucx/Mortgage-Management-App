import assert from 'node:assert/strict'
import test from 'node:test'
import { checkChangelog, isAllowlistedPath } from './check-changelog.mjs'
import { isReleaseCandidate } from './check-version-unchanged.mjs'

const pr = { headBranch: 'fix/thing', headRepo: 'o/r', baseRepo: 'o/r' }
const withStore = {
  base: {
    'CHANGELOG.md': '# Changelog\n\n## Unreleased\n\n',
    'changelog/unreleased/README.md': 'rules\n',
    'backend/src/app.py': 'old\n',
  },
  head: {
    'CHANGELOG.md': '# Changelog\n\n## Unreleased\n\n',
    'changelog/unreleased/README.md': 'rules\n',
    'backend/src/app.py': 'new\n',
    'changelog/unreleased/feature.added.md': '- A feature.\n',
  },
}
const reader = (refs) => (ref, path) => refs[ref][path] ?? null

test('allowlists internal chore paths only', () => {
  assert.equal(isAllowlistedPath('Documentation/RELEASE_CHECKLIST.md'), true)
  assert.equal(isAllowlistedPath('.github/scripts/check-changelog.mjs'), true)
  assert.equal(isAllowlistedPath('changelog/unreleased/README.md'), true)
  assert.equal(isAllowlistedPath('AGENTS.md'), true)
  assert.equal(isAllowlistedPath('backend/src/app.py'), false)
  assert.equal(isAllowlistedPath('frontend/src/App.tsx'), false)
  assert.equal(isAllowlistedPath('docs/index.html'), false)
  assert.equal(isAllowlistedPath('CHANGELOG.md'), false)
})

test('a product change with a new fragment passes', () => {
  assert.deepEqual(
    checkChangelog({
      read: reader(withStore),
      pathsChanged: ['backend/src/app.py', 'changelog/unreleased/feature.added.md'],
      base: 'base',
      head: 'head',
      ...pr,
    }),
    { errors: [], warnings: [] },
  )
})

test('a product change without a fragment fails', () => {
  const { errors, warnings } = checkChangelog({
    read: reader(withStore),
    pathsChanged: ['backend/src/app.py'],
    base: 'base',
    head: 'head',
    ...pr,
  })
  assert.deepEqual(warnings, [])
  assert.equal(errors.length, 1)
  assert.match(errors[0], /changelog\/unreleased\//)
})

test('a Dependabot update needs no fragment', () => {
  assert.deepEqual(
    checkChangelog({
      read: reader(withStore),
      pathsChanged: ['frontend/package.json'],
      base: 'base',
      head: 'head',
      headBranch: 'dependabot/npm_and_yarn/frontend/x-1.2.3',
      headRepo: 'o/r',
      baseRepo: 'o/r',
    }),
    { errors: [], warnings: [] },
  )
})

test('an allowlisted-only change passes without a warning', () => {
  assert.deepEqual(
    checkChangelog({
      read: reader(withStore),
      pathsChanged: ['Documentation/agents/changelog.md', '.github/workflows/test.yml'],
      base: 'base',
      head: 'head',
      ...pr,
    }),
    { errors: [], warnings: [] },
  )
})

test('editing CHANGELOG.md on a non-release PR fails', () => {
  const refs = {
    base: withStore.base,
    head: { ...withStore.head, 'CHANGELOG.md': '# Changelog\n\n## Unreleased\n\n### Added\n\n- Nope.\n' },
  }
  const { errors } = checkChangelog({
    read: reader(refs),
    pathsChanged: ['CHANGELOG.md', 'changelog/unreleased/feature.added.md'],
    base: 'base',
    head: 'head',
    ...pr,
  })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /CHANGELOG\.md/)
  assert.match(errors[0], /changelog\/unreleased\//)
})

test('the release candidate may rewrite CHANGELOG.md without adding fragments', () => {
  const refs = {
    base: withStore.base,
    head: { ...withStore.base, 'CHANGELOG.md': '# Changelog\n\n## Unreleased\n\n## [3.5.1] - 2026-11-20\n\n### Added\n\n- X.\n' },
  }
  const candidate = { headBranch: 'release/3.5.1', headRepo: 'o/r', baseRepo: 'o/r' }
  assert.equal(isReleaseCandidate(candidate), true)
  assert.deepEqual(
    checkChangelog({
      read: reader(refs),
      pathsChanged: ['CHANGELOG.md', 'VERSION'],
      base: 'base',
      head: 'head',
      ...candidate,
    }),
    { errors: [], warnings: [] },
  )
})

test('skips enforcement until the fragment store exists on the base branch', () => {
  const refs = {
    base: { 'CHANGELOG.md': 'old\n' },
    head: { 'CHANGELOG.md': 'new\n', 'backend/src/app.py': 'x\n' },
  }
  assert.deepEqual(
    checkChangelog({
      read: reader(refs),
      pathsChanged: ['CHANGELOG.md', 'backend/src/app.py'],
      base: 'base',
      head: 'head',
      ...pr,
    }),
    { errors: [], warnings: [] },
  )
})
