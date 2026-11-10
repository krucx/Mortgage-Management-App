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

export function summaryLine({ heading, current }) {
  const counts = current.found !== undefined ? ` (${current.hit}/${current.found} lines)` : ''
  return `## ${heading}\n\nPR: ${percentage(current.rate)}${counts}\n`
}

function option(name) {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const format = option('--format')
  const label = option('--label')
  const report = option('--report')
  const minimumRate = Number(option('--minimum-rate'))
  const summaryFile = option('--summary-file')
  if (!format || !label || !report || !Number.isFinite(minimumRate) || minimumRate < 0 || minimumRate > 1 || !summaryFile) {
    throw new Error(
      'Usage: coverage-summary.mjs --format <cobertura|lcov> --label <text> --report <path> ' +
        '--minimum-rate <0..1> --summary-file <path>',
    )
  }
  const heading = `${label} line coverage`
  const current = readReport(format, report, label)
  appendFileSync(summaryFile, summaryLine({ heading, current }))
  console.log(`Wrote ${label.toLowerCase()} coverage summary: ${percentage(current.rate)}`)
  if (current.rate < minimumRate) {
    throw new Error(`${label} line coverage ${percentage(current.rate)} is below the ${percentage(minimumRate)} minimum`)
  }
}
