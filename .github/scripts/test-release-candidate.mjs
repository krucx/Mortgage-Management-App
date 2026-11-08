import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { compareVersions, prepareRelease, releaseNotes, validateVersionRequest } from './release-candidate.mjs'

const changelog = '# Changelog\n\n## Unreleased\n\n### Changed\n\n- Prepare releases through GitHub Actions.\n\n## [3.4.4] - 2026-11-07\n\nOlder notes.\n'

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

test('requires authored notes under Unreleased', () => {
  assert.throws(() => releaseNotes('# Changelog\n\n## Unreleased\n\n## [3.4.4] - 2026-11-07\n'), /no human-authored release notes/)
  assert.throws(() => releaseNotes('# Changelog\n\n## Unreleased\n\n### Changed\n\n## [3.4.4] - 2026-11-07\n'), /no human-authored release notes/)
})

test('promotes Unreleased notes into a dated version section and preserves history', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-candidate-'))
  try {
    writeFileSync(join(root, 'CHANGELOG.md'), changelog)
    writeFileSync(join(root, 'VERSION'), '3.4.5\n')
    prepareRelease(root, '3.4.6', '2026-11-09')
    assert.equal(readFileSync(join(root, 'VERSION'), 'utf8'), '3.4.6\n')
    assert.equal(
      readFileSync(join(root, 'CHANGELOG.md'), 'utf8'),
      '# Changelog\n\n## Unreleased\n\n## [3.4.6] - 2026-11-09\n\n### Changed\n\n- Prepare releases through GitHub Actions.\n\n## [3.4.4] - 2026-11-07\n\nOlder notes.\n',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('leaves files untouched when release notes are missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-candidate-'))
  try {
    writeFileSync(join(root, 'CHANGELOG.md'), '# Changelog\n\n## Unreleased\n\n')
    writeFileSync(join(root, 'VERSION'), '3.4.5\n')
    assert.throws(() => prepareRelease(root, '3.4.6', '2026-11-09'), /no human-authored release notes/)
    assert.equal(readFileSync(join(root, 'VERSION'), 'utf8'), '3.4.5\n')
    assert.equal(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), '# Changelog\n\n## Unreleased\n\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
