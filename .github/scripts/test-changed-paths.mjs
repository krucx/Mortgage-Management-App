import test from 'node:test';
import assert from 'node:assert/strict';
import { jobsFor, languagesFor } from './changed-paths.mjs';

const pr = (paths, overrides = {}) => jobsFor({ event: 'pull_request', headRef: 'feature/x', paths, ...overrides });
const NONE = { backend: false, frontend: false, windows: false, image: false, codeql: false };
const ALL = { backend: true, frontend: true, windows: true, image: true, codeql: true };

// Each row: what a pull request touches -> the heavy job groups that run.
const table = [
  ['docs only', ['Documentation/adr/0001.md', 'README.md', 'docs/install.html'], NONE],
  ['changelog fragment only', ['changelog/unreleased/567-x.changed.md'], NONE],
  ['nothing changed', [], NONE],
  ['backend source', ['backend/src/mortgage_backend/app.py'], { ...NONE, backend: true, windows: true, image: true, codeql: true }],
  ['backend lockfile', ['backend/uv.lock'], { ...NONE, backend: true, windows: true, image: true, codeql: true }],
  ['frontend source', ['frontend/src/App.tsx'], { ...NONE, frontend: true, windows: true, image: true, codeql: true }],
  ['frontend lockfile', ['frontend/package-lock.json'], { ...NONE, frontend: true, windows: true, image: true, codeql: true }],
  ['a QA scenario', ['qa/features/a.feature'], { ...NONE, frontend: true, codeql: true }],
  ['the Windows setup', ['windows/setup.ps1'], { ...NONE, windows: true }],
  ['the Dockerfile', ['Dockerfile'], { ...NONE, image: true }],
  ['the .dockerignore', ['.dockerignore'], { ...NONE, image: true }],
  ['VERSION', ['VERSION'], { ...NONE, backend: true, frontend: true, windows: true, image: true }],
  ['a workflow file', ['.github/workflows/test.yml'], ALL],
  ['a CI script both jobs run', ['.github/scripts/check-version.mjs'], { ...NONE, backend: true, frontend: true, codeql: true }],
  ['an unrelated CI script', ['.github/scripts/auto-merge.mjs'], { ...NONE, codeql: true }],
  ['docs plus backend', ['README.md', 'backend/src/a.py'], { ...NONE, backend: true, windows: true, image: true, codeql: true }],
];

for (const [name, paths, expected] of table) {
  test(`a pull request touching ${name} runs ${JSON.stringify(expected)}`, () => {
    const { languages, ...groups } = pr(paths);
    assert.deepEqual(groups, expected);
    // A workflow change runs everything, every CodeQL language included.
    assert.deepEqual(languages, expected === ALL ? ['actions', 'javascript-typescript', 'python'] : languagesFor(paths));
    assert.equal(groups.codeql, languages.length > 0);
  });
}

test('CodeQL languages follow the paths scanned', () => {
  assert.deepEqual(languagesFor(['backend/src/a.py']), ['python']);
  assert.deepEqual(languagesFor(['frontend/src/a.ts']), ['javascript-typescript']);
  assert.deepEqual(languagesFor(['.github/scripts/a.mjs']), ['javascript-typescript']);
  assert.deepEqual(languagesFor(['.github/workflows/a.yml']), ['actions']);
  assert.deepEqual(languagesFor(['README.md']), []);
  assert.deepEqual(languagesFor(['backend/a.py', 'frontend/a.ts', '.github/workflows/a.yml']).sort(), ['actions', 'javascript-typescript', 'python']);
});

test('a workflow change scans every CodeQL language and runs everything', () => {
  const result = pr(['.github/workflows/codeql.yml']);
  assert.deepEqual(result, { ...ALL, languages: ['actions', 'javascript-typescript', 'python'] });
});

test('the full set runs for anything but an ordinary pull request', () => {
  const full = { ...ALL, languages: ['actions', 'javascript-typescript', 'python'] };
  for (const event of ['push', 'workflow_dispatch', 'workflow_call', 'schedule']) {
    assert.deepEqual(jobsFor({ event, headRef: '', paths: [] }), full, event);
  }
  for (const headRef of ['integration/refactor-500', 'release/3.7.0']) {
    assert.deepEqual(jobsFor({ event: 'pull_request', headRef, paths: ['README.md'] }), full, headRef);
  }
});

test('a pull request with an unknown file list runs the full set', () => {
  assert.deepEqual(jobsFor({ event: 'pull_request', headRef: 'feature/x', paths: undefined }), { ...ALL, languages: ['actions', 'javascript-typescript', 'python'] });
});

test('a branch merely named like integration is filtered', () => {
  assert.deepEqual(pr(['README.md'], { headRef: 'feature/integration/x' }).backend, false);
});
