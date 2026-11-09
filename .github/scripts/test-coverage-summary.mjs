import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parseCobertura, parseLcov, readReport, summaryLine } from './coverage-summary.mjs'

const cobertura = (rate) => `<?xml version="1.0"?><coverage line-rate="${rate}"><packages/></coverage>`
const lcov = (hit, found) => `TN:\nSF:a.js\nLH:${hit}\nLF:${found}\nend_of_record\n`

test('parses the line-rate off the Cobertura root element', () => {
  assert.deepEqual(parseCobertura(cobertura('0.853')), { rate: 0.853 })
  assert.throws(() => parseCobertura('<coverage><packages/></coverage>'), /no line-rate/)
})

test('sums LH and LF across an LCOV report', () => {
  assert.deepEqual(parseLcov(lcov(80, 100)), { rate: 0.8, hit: 80, found: 100 })
  assert.throws(() => parseLcov('TN:\nSF:a.js\nend_of_record\n'), /no lines/)
})

test('formats a Cobertura summary line with no base', () => {
  const current = parseCobertura(cobertura('0.853'))
  assert.equal(
    summaryLine({ heading: 'Backend line coverage', current, baseOutcome: 'skipped' }),
    '## Backend line coverage\n\nPR: 85.3%\n',
  )
})

test('formats a Cobertura summary line with a base', () => {
  const current = parseCobertura(cobertura('0.853'))
  const base = parseCobertura(cobertura('0.820'))
  assert.equal(
    summaryLine({ heading: 'Backend line coverage', current, base }),
    '## Backend line coverage\n\nPR: 85.3% · base: 82.0% · change: +3.3 percentage points\n',
  )
})

test('formats a Cobertura summary line when the base tests failed', () => {
  const current = parseCobertura(cobertura('0.853'))
  assert.equal(
    summaryLine({ heading: 'Backend line coverage', current, baseOutcome: 'failure' }),
    '## Backend line coverage\n\nPR: 85.3% · base comparison unavailable (base tests did not pass)\n',
  )
})

test('formats an LCOV summary line with line counts and a lower base', () => {
  const current = parseLcov(lcov(853, 1000))
  const base = parseLcov(lcov(900, 1000))
  assert.equal(
    summaryLine({ heading: 'Frontend line coverage', current, base }),
    '## Frontend line coverage\n\nPR: 85.3% (853/1000 lines) · base: 90.0% · change: -4.7 percentage points\n',
  )
})

test('formats an LCOV summary line with no base and no failure', () => {
  const current = parseLcov(lcov(853, 1000))
  assert.equal(
    summaryLine({ heading: 'Frontend line coverage', current, baseOutcome: undefined }),
    '## Frontend line coverage\n\nPR: 85.3% (853/1000 lines)\n',
  )
})

test('readReport rejects a missing report', () => {
  const root = mkdtempSync(join(tmpdir(), 'coverage-summary-'))
  try {
    assert.throws(() => readReport('cobertura', join(root, 'coverage.xml'), 'Backend'), /Backend coverage report is missing or empty/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('readReport rejects an empty report', () => {
  const root = mkdtempSync(join(tmpdir(), 'coverage-summary-'))
  try {
    const path = join(root, 'lcov.info')
    writeFileSync(path, '')
    assert.throws(() => readReport('lcov', path, 'Frontend'), /Frontend coverage report is missing or empty/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the CLI writes a job summary line, with and without a base, and fails on a missing report', () => {
  const root = mkdtempSync(join(tmpdir(), 'coverage-summary-'))
  try {
    const script = new URL('./coverage-summary.mjs', import.meta.url).pathname
    const report = join(root, 'coverage.xml')
    const baseReport = join(root, 'base-coverage.xml')
    const summaryFile = join(root, 'summary.md')
    writeFileSync(report, cobertura('0.900'))
    writeFileSync(baseReport, cobertura('0.800'))
    writeFileSync(summaryFile, '')

    const withBase = spawnSync(process.execPath, [
      script, '--format', 'cobertura', '--label', 'Backend',
      '--report', report, '--base-report', baseReport, '--base-outcome', 'success', '--summary-file', summaryFile,
    ], { encoding: 'utf8' })
    assert.equal(withBase.status, 0, withBase.stderr)
    assert.equal(
      readFileSync(summaryFile, 'utf8'),
      '## Backend line coverage\n\nPR: 90.0% · base: 80.0% · change: +10.0 percentage points\n',
    )

    writeFileSync(summaryFile, '')
    const withoutBase = spawnSync(process.execPath, [
      script, '--format', 'cobertura', '--label', 'Backend',
      '--report', report, '--base-report', '', '--base-outcome', 'skipped', '--summary-file', summaryFile,
    ], { encoding: 'utf8' })
    assert.equal(withoutBase.status, 0, withoutBase.stderr)
    assert.equal(readFileSync(summaryFile, 'utf8'), '## Backend line coverage\n\nPR: 90.0%\n')

    writeFileSync(summaryFile, '')
    const baseFailed = spawnSync(process.execPath, [
      script, '--format', 'cobertura', '--label', 'Backend',
      '--report', report, '--base-report', '', '--base-outcome', 'failure', '--summary-file', summaryFile,
    ], { encoding: 'utf8' })
    assert.equal(baseFailed.status, 0, baseFailed.stderr)
    assert.equal(
      readFileSync(summaryFile, 'utf8'),
      '## Backend line coverage\n\nPR: 90.0% · base comparison unavailable (base tests did not pass)\n',
    )

    const missingReport = spawnSync(process.execPath, [
      script, '--format', 'cobertura', '--label', 'Backend',
      '--report', join(root, 'missing.xml'), '--summary-file', summaryFile,
    ], { encoding: 'utf8' })
    assert.notEqual(missingReport.status, 0)
    assert.match(missingReport.stderr, /Backend coverage report is missing or empty/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
