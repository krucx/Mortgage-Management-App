import test from 'node:test';
import assert from 'node:assert/strict';
import { jobsFor, languagesFor } from './changed-paths.mjs';

const pr = (paths, overrides = {}) => jobsFor({ event: 'pull_request', headRef: 'feature/x', paths, ...overrides });
const NONE = { backend: false, frontend: false, windows: false, image: false, codeql: false };
const ALL = { backend: true, frontend: true, windows: true, image: true, codeql: true };

// Which job groups each path starts is pinned per path in test-critical-paths.mjs (classify).
// These tests cover how a pull request's paths combine.
test('a pull request with only chore paths runs nothing', () => {
  const { languages, ...groups } = pr(['README.md', 'AGENTS.md', 'changelog/unreleased/567-x.changed.md']);
  assert.deepEqual(groups, NONE);
  assert.deepEqual(languages, []);
  assert.deepEqual(pr([]).codeql, false);
});

test('the job groups of every changed path are combined', () => {
  const { languages, ...groups } = pr(['README.md', 'backend/src/a.py', 'windows/setup.ps1']);
  assert.deepEqual(groups, { ...NONE, backend: true, windows: true, image: true, codeql: true });
  assert.deepEqual(languages, ['python']);
});

test('CodeQL languages are combined across paths', () => {
  assert.deepEqual(languagesFor(['README.md']), []);
  assert.deepEqual(languagesFor(['backend/a.py', 'frontend/a.ts', '.github/workflows/a.yml']), ['actions', 'javascript-typescript', 'python']);
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
