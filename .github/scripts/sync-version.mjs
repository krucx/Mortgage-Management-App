import { readFileSync, writeFileSync } from 'node:fs'

const root = new URL('../../', import.meta.url)
const version = readFileSync(new URL('VERSION', root), 'utf8').trim()
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid VERSION: ${version}`)

function update(path, replace) {
  const url = new URL(path, root)
  const before = readFileSync(url, 'utf8')
  const after = replace(before)
  if (after !== before) writeFileSync(url, after)
}

update('backend/pyproject.toml', (text) => text.replace(/^(version = ")[^"]+("\s*)$/m, `$1${version}$2`))
update('backend/uv.lock', (text) => text.replace(/(name = "mortgage-backend"\nversion = ")[^"]+("\n)/, `$1${version}$2`))

for (const path of ['frontend/package.json', 'frontend/package-lock.json']) {
  update(path, (text) => {
    const metadata = JSON.parse(text)
    metadata.version = version
    if (metadata.packages?.['']) metadata.packages[''].version = version
    return `${JSON.stringify(metadata, null, 2)}\n`
  })
}

update('frontend/openapi.json', (text) => text.replace(/("version": ")[^"]+("\s*[,}])/, `$1${version}$2`))

const docs = {
  'docs/index.html': [
    /(Mortgage Management )\d+\.\d+\.\d+( · documentation)/,
    /(Version: <b>)\d+\.\d+\.\d+(<\/b>)/,
    /(Written for version )\d+\.\d+\.\d+(\.)/,
  ],
  'docs/install.html': [
    /(Newest release: <b>)\d+\.\d+\.\d+(<\/b>)/,
    /(Getting version )\d+\.\d+\.\d+(\.\.\.)/,
    /(Written for version )\d+\.\d+\.\d+(\.)/,
  ],
  'docs/walkthrough.html': [/(Version: <b>)\d+\.\d+\.\d+(<\/b>)/],
  'docs/story.html': [
    /(Mortgage Management )\d+\.\d+\.\d+( · the story)/,
    /(alt="Version )\d+\.\d+\.\d+( is available)/,
  ],
}
for (const [path, patterns] of Object.entries(docs)) {
  update(path, (text) => patterns.reduce((content, pattern) => {
    if (!pattern.test(content)) throw new Error(`${path} is missing current version label ${pattern}`)
    return content.replace(pattern, `$1${version}$2`)
  }, text))
}

console.log(`Synchronized package metadata and current documentation to VERSION ${version}`)
