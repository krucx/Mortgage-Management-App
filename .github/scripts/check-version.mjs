import { readFileSync } from 'node:fs'

const version = readFileSync(new URL('../../VERSION', import.meta.url), 'utf8').trim()
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid VERSION: ${version}`)

function equal(label, actual) {
  if (actual !== version) throw new Error(`${label} is ${actual}; VERSION is ${version}`)
}

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const backend = read('backend/pyproject.toml').match(/^version = "([^"]+)"/m)?.[1]
if (!backend) throw new Error('Could not read backend version from pyproject.toml')
equal('backend/pyproject.toml', backend)

for (const path of ['frontend/package.json', 'frontend/package-lock.json']) {
  const metadata = JSON.parse(read(path))
  equal(path, metadata.version)
  if (path.endsWith('package-lock.json')) equal(`${path} root package`, metadata.packages?.['']?.version)
}

const lock = read('backend/uv.lock').match(/name = "mortgage-backend"\nversion = "([^"]+)"/)
if (!lock) throw new Error('Could not read mortgage-backend version from uv.lock')
equal('backend/uv.lock', lock[1])

const api = read('frontend/openapi.json').match(/"version": "([^"]+)"/)
if (!api) throw new Error('Could not read API version from frontend/openapi.json')
equal('frontend/openapi.json', api[1])

const currentDocLabels = {
  'docs/index.html': [
    /Mortgage Management (\d+\.\d+\.\d+) · documentation/,
    /Version: <b>(\d+\.\d+\.\d+)<\/b>/,
    /Written for version (\d+\.\d+\.\d+)\./,
  ],
  'docs/install.html': [
    /Newest release: <b>(\d+\.\d+\.\d+)<\/b>/,
    /Getting version (\d+\.\d+\.\d+)\.\.\./,
    /Written for version (\d+\.\d+\.\d+)\./,
  ],
  'docs/walkthrough.html': [/Version: <b>(\d+\.\d+\.\d+)<\/b>/],
  'docs/story.html': [
    /Mortgage Management (\d+\.\d+\.\d+) · the story/,
    /alt="Version (\d+\.\d+\.\d+) is available/,
  ],
}
for (const [path, patterns] of Object.entries(currentDocLabels)) {
  const content = read(path)
  for (const pattern of patterns) {
    const actual = content.match(pattern)?.[1]
    if (!actual) throw new Error(`${path} is missing current version label matching ${pattern}`)
    equal(path, actual)
  }
}

if (process.argv[2] === '--tag') {
  const tag = process.argv[3]
  if (!tag) throw new Error('Usage: check-version.mjs --tag <tag>')
  equal('release tag', tag)
} else if (process.argv.length > 2) {
  throw new Error('Usage: check-version.mjs [--tag <tag>]')
}

console.log(`VERSION ${version} agrees with package metadata, generated API schema, and current docs`)
