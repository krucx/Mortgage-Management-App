import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  assembleFragments,
  compareVersions,
  listFragments,
  prepareRelease,
  validateVersionRequest,
} from './release-candidate.mjs'

function writeFragment(root, name, body) {
  const dir = join(root, 'changelog', 'unreleased')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), body)
}

function seedChangelog(root) {
  writeFileSync(
    join(root, 'CHANGELOG.md'),
    '# Changelog\n\n## Unreleased\n\n## [3.4.4] - 2026-11-07\n\nOlder notes.\n',
  )
  writeFileSync(join(root, 'VERSION'), '3.4.5\n')
}

test('compares numeric semantic version components', () => {
  assert.equal(compareVersions('3.4.10', '3.4.6') > 0, true)
  assert.equal(compareVersions('3.5.0', '3.4.99') > 0, true)
  assert.equal(compareVersions('3.4.6', '3.4.6'), 0)
})

test('accepts only a version above both published and current main versions', () => {
  assert.doesNotThrow(() => validateVersionRequest('3.4.6', '3.4.4', '3.4.5'))
  assert.throws(() => validateVersionRequest('3.4.5', '3.4.4', '3.4.5'), /higher than latest published/)
  assert.throws(() => validateVersionRequest('3.4.4', '3.4.4', '3.4.3'), /higher than latest published/)
  assert.throws(() => validateVersionRequest('03.4.6', '3.4.4', '3.4.5'), /major.minor.patch/)
  assert.throws(() => validateVersionRequest('3.4', '3.4.4', '3.4.5'), /major.minor.patch/)
})

test('the CLI can recheck a version without changing candidate files', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-candidate-'))
  try {
    writeFileSync(join(root, 'VERSION'), '3.4.5\n')
    const script = new URL('./release-candidate.mjs', import.meta.url).pathname
    const args = ['--version', '3.4.6', '--latest-published', '3.4.4', '--current-version', '3.4.5', '--root', root, '--check-only']
    const accepted = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
    assert.equal(accepted.status, 0, accepted.stderr)
    assert.equal(readFileSync(join(root, 'VERSION'), 'utf8'), '3.4.5\n')

    const rejected = spawnSync(process.execPath, [script, ...args.map((arg, index) => index === 1 ? '3.4.5' : arg)], { encoding: 'utf8' })
    assert.notEqual(rejected.status, 0)
    assert.match(rejected.stderr, /higher than latest published/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('lists authored fragments and ignores README', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-candidate-'))
  try {
    writeFragment(root, 'README.md', 'docs\n')
    writeFragment(root, 'prepare.changed.md', '- Prepare releases through fragments.\n')
    writeFragment(root, 'phone.fixed.md', '- Advances fit a phone screen.\n')
    const fragments = listFragments(join(root, 'changelog', 'unreleased'))
    assert.deepEqual(
      fragments.map(({ name, type }) => ({ name, type })),
      [
        { name: 'phone.fixed.md', type: 'fixed' },
        { name: 'prepare.changed.md', type: 'changed' },
      ],
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('assembles fragments into Keep a Changelog sections by type', () => {
  const notes = assembleFragments([
    { name: 'b.changed.md', type: 'changed', body: '- Second change.\n' },
    { name: 'a.added.md', type: 'added', body: '- New thing.\n' },
    { name: 'c.fixed.md', type: 'fixed', body: '- A fix.\n' },
    { name: 'd.changed.md', type: 'changed', body: '- First change.\n' },
  ])
  assert.equal(
    notes,
    '### Added\n\n- New thing.\n\n### Changed\n\n- Second change.\n\n- First change.\n\n### Fixed\n\n- A fix.',
  )
})

test('requires at least one authored fragment', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-candidate-'))
  try {
    seedChangelog(root)
    mkdirSync(join(root, 'changelog', 'unreleased'), { recursive: true })
    writeFileSync(join(root, 'changelog', 'unreleased', 'README.md'), 'docs\n')
    assert.throws(() => prepareRelease(root, '3.4.6', '2026-11-09'), /no authored fragments/)
    assert.equal(readFileSync(join(root, 'VERSION'), 'utf8'), '3.4.5\n')
    assert.equal(
      readFileSync(join(root, 'CHANGELOG.md'), 'utf8'),
      '# Changelog\n\n## Unreleased\n\n## [3.4.4] - 2026-11-07\n\nOlder notes.\n',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('collates fragments into a dated version section, deletes them, and syncs VERSION', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-candidate-'))
  try {
    seedChangelog(root)
    writeFragment(root, 'README.md', 'Fragment rules.\n')
    writeFragment(root, 'prepare.changed.md', '- Prepare releases through GitHub Actions.\n')
    writeFragment(root, 'phone.fixed.md', '- Advances fit a phone screen.\n')
    prepareRelease(root, '3.4.6', '2026-11-09')
    assert.equal(readFileSync(join(root, 'VERSION'), 'utf8'), '3.4.6\n')
    assert.equal(
      readFileSync(join(root, 'CHANGELOG.md'), 'utf8'),
      '# Changelog\n\n## Unreleased\n\n## [3.4.6] - 2026-11-09\n\n### Changed\n\n- Prepare releases through GitHub Actions.\n\n### Fixed\n\n- Advances fit a phone screen.\n\n## [3.4.4] - 2026-11-07\n\nOlder notes.\n',
    )
    const remaining = readdirSync(join(root, 'changelog', 'unreleased')).sort()
    assert.deepEqual(remaining, ['README.md'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
