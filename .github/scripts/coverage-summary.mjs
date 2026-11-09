import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

export function parseCobertura(xml) {
  const match = /<coverage\b[^>]*\bline-rate="([^"]+)"/.exec(xml)
  const rate = match && Number(match[1])
  if (!match || !Number.isFinite(rate)) throw new Error('Coverage report has no line-rate')
  return { rate }
}

export function parseLcov(content) {
  const lines = content.match(/^LF:\d+|^LH:\d+/gm) ?? []
  const found = lines.filter((line) => line.startsWith('LF:')).reduce((sum, line) => sum + Number(line.slice(3)), 0)
  const hit = lines.filter((line) => line.startsWith('LH:')).reduce((sum, line) => sum + Number(line.slice(3)), 0)
  if (!found) throw new Error('Coverage report contains no lines')
  return { rate: hit / found, hit, found }
}

function parse(format, content) {
  if (format === 'cobertura') return parseCobertura(content)
  if (format === 'lcov') return parseLcov(content)
  throw new Error(`Unknown coverage format: ${format}`)
}

export function readReport(format, path, label) {
  if (!path || !existsSync(path) || statSync(path).size === 0) throw new Error(`${label} coverage report is missing or empty`)
  return parse(format, readFileSync(path, 'utf8'))
}

function percentage(rate) {
  return `${(rate * 100).toFixed(1)}%`
}

export function summaryLine({ heading, current, base, baseOutcome }) {
  const counts = current.found !== undefined ? ` (${current.hit}/${current.found} lines)` : ''
  let line = `## ${heading}\n\nPR: ${percentage(current.rate)}${counts}`
  if (base) {
    const delta = (current.rate - base.rate) * 100
    line += ` · base: ${percentage(base.rate)} · change: ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} percentage points`
  } else if (baseOutcome === 'failure') {
    line += ' · base comparison unavailable (base tests did not pass)'
  }
  return `${line}\n`
}

function option(name) {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const format = option('--format')
  const label = option('--label')
  const report = option('--report')
  const baseReport = option('--base-report')
  const baseOutcome = option('--base-outcome')
  const summaryFile = option('--summary-file')
  if (!format || !label || !report || !summaryFile) {
    throw new Error(
      'Usage: coverage-summary.mjs --format <cobertura|lcov> --label <text> --report <path> ' +
        '--summary-file <path> [--base-report <path>] [--base-outcome <success|failure>]',
    )
  }
  const heading = `${label} line coverage`
  const current = readReport(format, report, label)
  const base = baseReport ? readReport(format, baseReport, `${label} base`) : undefined
  appendFileSync(summaryFile, summaryLine({ heading, current, base, baseOutcome }))
  console.log(`Wrote ${label.toLowerCase()} coverage summary: ${percentage(current.rate)}`)
}
