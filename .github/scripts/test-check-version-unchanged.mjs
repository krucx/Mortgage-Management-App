import assert from 'node:assert/strict'
import test from 'node:test'
import { changedVersionFiles, checkVersionUnchanged, isReleaseCandidate } from './check-version-unchanged.mjs'

const files = (version) => ({
  VERSION: `${version}\n`,
  'frontend/package.json': JSON.stringify({ name: 'x', version }),
  'backend/pyproject.toml': `[project]\nversion = "${version}"\n`,
})
const repo = { base: { ...files('3.4.5'), 'README.md': 'a' }, head: { ...files('3.4.5'), 'README.md': 'b' } }
const reader = (refs) => (ref, path) => refs[ref][path] ?? null
const pr = { headBranch: 'fix/thing', headRepo: 'o/r', baseRepo: 'o/r' }

test('a PR that leaves the version files alone passes', () => {
  assert.deepEqual(checkVersionUnchanged({ read: reader(repo), base: 'base', head: 'head', ...pr }), [])
})

test('a PR that bumps VERSION or a synced package version fails naming the files', () => {
  const bumped = { base: repo.base, head: files('3.4.6') }
  assert.deepEqual(changedVersionFiles(reader(bumped), 'base', 'head'), ['VERSION', 'backend/pyproject.toml', 'frontend/package.json'])
  assert.deepEqual(checkVersionUnchanged({ read: reader(bumped), base: 'base', head: 'head', ...pr }).length, 3)
  const partial = { base: repo.base, head: { ...repo.base, 'frontend/package.json': files('3.4.6')['frontend/package.json'] } }
  assert.deepEqual(changedVersionFiles(reader(partial), 'base', 'head'), ['frontend/package.json'])
})

test('formatting-only edits to a package file are not a version change', () => {
  const refs = { base: repo.base, head: { ...repo.base, 'frontend/package.json': JSON.stringify({ version: '3.4.5' }, null, 2) } }
  assert.deepEqual(changedVersionFiles(reader(refs), 'base', 'head'), [])
})

test('the release candidate branch from this repository may bump the version', () => {
  const bumped = { base: repo.base, head: files('3.4.6') }
  const candidate = { headBranch: 'release/3.4.6', headRepo: 'o/r', baseRepo: 'o/r' }
  assert.equal(isReleaseCandidate(candidate), true)
  assert.deepEqual(checkVersionUnchanged({ read: reader(bumped), base: 'base', head: 'head', ...candidate }), [])
})

test('a fork branch named like a release candidate is not exempt', () => {
  assert.equal(isReleaseCandidate({ headBranch: 'release/3.4.6', headRepo: 'fork/r', baseRepo: 'o/r' }), false)
  assert.equal(isReleaseCandidate({ headBranch: 'release/next', headRepo: 'o/r', baseRepo: 'o/r' }), false)
})
