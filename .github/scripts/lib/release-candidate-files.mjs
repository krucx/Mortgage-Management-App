// The one list of files the Prepare release candidate workflow writes, and how it writes the
// version into each. release-candidate.mjs and sync-version.mjs write from it, and the release
// conditions (release-conditions.mjs) allow exactly these files in a release pull request's
// diff, so a new written file is added here once and is then both written and allowed.

export const VERSION_FILE = 'VERSION'
export const CHANGELOG_FILE = 'CHANGELOG.md'
// Fragments are deleted once collated into the dated CHANGELOG section; the README stays.
export const FRAGMENTS_DIR = 'changelog/unreleased'
export const FRAGMENTS_README = 'README.md'
// Also rewritten by `uv lock` in the candidate workflow, after the version line is synced.
export const BACKEND_LOCKFILE = 'backend/uv.lock'
export const API_SCHEMA = 'frontend/openapi.json'

function labels(path, patterns) {
  return (text, version) => patterns.reduce((content, pattern) => {
    if (!pattern.test(content)) throw new Error(`${path} is missing current version label ${pattern}`)
    return content.replace(pattern, `$1${version}$2`)
  }, text)
}

function packageMetadata(text, version) {
  const metadata = JSON.parse(text)
  metadata.version = version
  if (metadata.packages?.['']) metadata.packages[''].version = version
  return `${JSON.stringify(metadata, null, 2)}\n`
}

// Files that carry the version, synced by sync-version.mjs: { path, sync(text, version) }.
export const VERSION_REFERENCES = [
  { path: 'backend/pyproject.toml', sync: (text, version) => text.replace(/^(version = ")[^"]+("\s*)$/m, `$1${version}$2`) },
  { path: BACKEND_LOCKFILE, sync: (text, version) => text.replace(/(name = "mortgage-backend"\nversion = ")[^"]+("\n)/, `$1${version}$2`) },
  { path: 'frontend/package.json', sync: packageMetadata },
  { path: 'frontend/package-lock.json', sync: packageMetadata },
  { path: API_SCHEMA, sync: (text, version) => text.replace(/("version": ")[^"]+("\s*[,}])/, `$1${version}$2`) },
  {
    path: 'docs/index.html',
    sync: labels('docs/index.html', [
      /(Mortgage Management )\d+\.\d+\.\d+( · documentation)/,
      /(Version: <b>)\d+\.\d+\.\d+(<\/b>)/,
      /(Written for version )\d+\.\d+\.\d+(\.)/,
    ]),
  },
  {
    path: 'docs/install.html',
    sync: labels('docs/install.html', [
      /(Newest release: <b>)\d+\.\d+\.\d+(<\/b>)/,
      /(Getting version )\d+\.\d+\.\d+(\.\.\.)/,
      /(Written for version )\d+\.\d+\.\d+(\.)/,
    ]),
  },
  { path: 'docs/walkthrough.html', sync: labels('docs/walkthrough.html', [/(Version: <b>)\d+\.\d+\.\d+(<\/b>)/]) },
  {
    path: 'docs/story.html',
    sync: labels('docs/story.html', [
      /(Mortgage Management )\d+\.\d+\.\d+( · the story)/,
      /(alt="Version )\d+\.\d+\.\d+( is available)/,
    ]),
  },
]

// A changelog fragment the candidate deletes: changelog/unreleased/<name>.md, not the README.
export function isChangelogFragment(path) {
  const prefix = `${FRAGMENTS_DIR}/`
  if (!path?.startsWith(prefix)) return false
  const name = path.slice(prefix.length)
  return !name.includes('/') && name.endsWith('.md') && name !== FRAGMENTS_README
}

// Files whose only change is the version number: VERSION and every synced reference.
export const VERSION_ONLY_FILES = [VERSION_FILE, ...VERSION_REFERENCES.map(({ path }) => path)]
