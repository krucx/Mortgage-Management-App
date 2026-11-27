import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AREAS, classify } from './lib/classify.mjs';

// The one table of path outcomes. lib/classify.mjs is the only place that answers path
// questions; the changed-paths job, the changelog check, the Dependabot auto-merge rule and the
// integration summary all call it, so their tests no longer repeat path cases.
const B = 'backend/src/mortgage_backend/';
const ALL_JOBS = ['backend', 'frontend', 'windows', 'image'];
const row = (path, { product = true, critical = [], jobs = [], languages = [], runsAll = false } = {}) => [path, { product, critical, jobs, languages, runsAll }];

const table = [
  // Not product: internal chore paths (no changelog fragment needed).
  row('AGENTS.md', { product: false }),
  row('CLAUDE.md', { product: false }),
  row('CONTRIBUTING.md', { product: false }),
  row('LICENSE', { product: false }),
  row('.editorconfig', { product: false }),
  row('.gitignore', { product: false }),
  row('.coderabbit.yaml', { product: false }),
  row('Documentation', { product: false }),
  row('Documentation/adr/0001.md', { product: false, jobs: ['backend'] }),
  row('.claude/skills/x/SKILL.md', { product: false }),
  row('.agents/skills/x', { product: false }),
  row('changelog/unreleased/567-x.changed.md', { product: false }),
  row('.github/scripts/check-version.mjs', { product: false, jobs: ['backend', 'frontend'], languages: ['javascript-typescript'] }),
  row('.github/scripts/coverage-summary.mjs', { product: false, jobs: ['backend', 'frontend'], languages: ['javascript-typescript'] }),
  row('.github/scripts/check-screen-coverage.mjs', { product: false, jobs: ['frontend'], languages: ['javascript-typescript'] }),
  row('.github/scripts/test-check-screen-coverage.mjs', { product: false, jobs: ['frontend'], languages: ['javascript-typescript'] }),
  row('.github/scripts/auto-merge.mjs', { product: false, languages: ['javascript-typescript'] }),
  row('.github/dependabot.yml', { product: false }),
  row('.github/workflows/test.yml', { product: false, critical: ['security'], jobs: ALL_JOBS, languages: ['actions'], runsAll: true }),
  row('.github/rulesets/main.json', { product: false, critical: ['security'] }),
  // Product paths.
  row('README.md'),
  row('CHANGELOG.md'),
  row('docs/install.html', { jobs: ['backend'] }),
  row('GLOSSARY.md', { jobs: ['backend'] }),
  row('VERSION', { jobs: ALL_JOBS }),
  row('Dockerfile', { critical: ['security'], jobs: ['image'] }),
  row('.dockerignore', { jobs: ['image'] }),
  row('windows/setup.ps1', { critical: ['security'], jobs: ['windows'] }),
  row('qa/features/a.feature', { jobs: ['frontend'], languages: ['javascript-typescript'] }),
  row('frontend/openapi.json', { jobs: ALL_JOBS.filter((j) => j !== 'none'), languages: ['javascript-typescript'] }),
  row('frontend/src/App.tsx', { jobs: ['frontend', 'windows', 'image'], languages: ['javascript-typescript'] }),
  row('frontend/package-lock.json', { jobs: ['frontend', 'windows', 'image'], languages: ['javascript-typescript'] }),
  row('backend/src/app.py', { jobs: ['backend', 'windows', 'image'], languages: ['python'] }),
  row('backend/uv.lock', { jobs: ['backend', 'windows', 'image'], languages: ['python'] }),
  // Critical areas.
  row(`${B}lending/ledger.py`, { critical: ['money'], jobs: ['backend', 'windows', 'image'], languages: ['python'] }),
  row(`${B}payments/x.py`, { critical: ['money'], jobs: ['backend', 'windows', 'image'], languages: ['python'] }),
  row(`${B}platform/money.py`, { critical: ['money'], jobs: ['backend', 'windows', 'image'], languages: ['python'] }),
  row('frontend/src/money.ts', { critical: ['money'], jobs: ['frontend', 'windows', 'image'], languages: ['javascript-typescript'] }),
  row('frontend/src/allocate.ts', { critical: ['money'], jobs: ['frontend', 'windows', 'image'], languages: ['javascript-typescript'] }),
  row('frontend/src/calculator.ts', { critical: ['money'], jobs: ['frontend', 'windows', 'image'], languages: ['javascript-typescript'] }),
  row(`${B}platform/local_only.py`, { critical: ['auth', 'security'], jobs: ['backend', 'windows', 'image'], languages: ['python'] }),
  row(`${B}migrations/0001.py`, { critical: ['migrations'], jobs: ['backend', 'windows', 'image'], languages: ['python'] }),
  row(`${B}platform/db.py`, { critical: ['migrations'], jobs: ['backend', 'windows', 'image'], languages: ['python'] }),
  row(`${B}safekeeping/backups.py`, { critical: ['migrations'], jobs: ['backend', 'windows', 'image'], languages: ['python'] }),
  row(`${B}platform/upload_limit.py`, { critical: ['security'], jobs: ['backend', 'windows', 'image'], languages: ['python'] }),
  row(`${B}platform/photos.py`, { critical: ['security'], jobs: ['backend', 'windows', 'image'], languages: ['python'] }),
  // A file path must match exactly, a folder path by prefix.
  row(`${B}platform/money.pyc`, { jobs: ['backend', 'windows', 'image'], languages: ['python'] }),
  row(`${B}lendingx/a.py`, { jobs: ['backend', 'windows', 'image'], languages: ['python'] }),
];
// frontend/openapi.json is read by the backend tests as well as being frontend source.
table.find(([path]) => path === 'frontend/openapi.json')[1].jobs = ALL_JOBS;

for (const [path, expected] of table) {
  test(`classify(${path})`, () => {
    assert.deepEqual(classify(path), expected);
  });
}

// CONTRIBUTING.md lists the critical areas for humans; lib/classify.mjs is what CI uses.
const doc = readFileSync(new URL('../../CONTRIBUTING.md', import.meta.url), 'utf8').replaceAll('\n', ' ');

test('every critical path the classifier uses is listed in CONTRIBUTING.md', () => {
  for (const { title, paths } of AREAS) {
    for (const path of paths) {
      // The doc may name a backend module relative to its "under backend/src/mortgage_backend/" note.
      const names = [path, path.startsWith(B) ? path.slice(B.length) : path];
      assert.ok(names.some((n) => doc.includes(`\`${n}\``)), `${title}: ${path} is not in CONTRIBUTING.md`);
    }
  }
});

test('CONTRIBUTING.md points at the module that holds the list', () => {
  assert.match(doc, /\.github\/scripts\/lib\/classify\.mjs/);
  assert.doesNotMatch(doc, /mirrored in `\.github\/scripts\/integration-summary\.mjs`/);
});
