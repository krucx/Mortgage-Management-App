import assert from 'node:assert/strict';
import test from 'node:test';
import { branchDeletionDecision, deleteMergedBranch, deleteAfterAutoMerge } from './lib/branch-cleanup.mjs';

const REPO = 'o/r';
const pr = (overrides = {}) => ({
  merged: true,
  state: 'closed',
  head: { ref: 'fix/thing', repo: { full_name: REPO } },
  base: { ref: 'integration/arch8-backend' },
  ...overrides,
});

test('a merged PR from a branch of this repo is deleted', () => {
  assert.deepEqual(branchDeletionDecision(pr(), REPO), { delete: true, ref: 'fix/thing', reason: 'merged' });
  assert.equal(branchDeletionDecision(pr({ base: { ref: 'main' }, head: { ref: 'release/3.6.2', repo: { full_name: REPO } } }), REPO).delete, true);
});

test('a PR that is not merged keeps its branch', () => {
  assert.equal(branchDeletionDecision(pr({ merged: false, state: 'open' }), REPO).delete, false);
  assert.equal(branchDeletionDecision(pr({ merged: false }), REPO).delete, false);
  assert.equal(branchDeletionDecision(undefined, REPO).delete, false);
});

test('a fork or a deleted fork keeps everything', () => {
  assert.equal(branchDeletionDecision(pr({ head: { ref: 'fix/x', repo: { full_name: 'someone/r' } } }), REPO).delete, false);
  assert.equal(branchDeletionDecision(pr({ head: { ref: 'fix/x', repo: null } }), REPO).delete, false);
});

test('main is never deleted', () => {
  assert.equal(branchDeletionDecision(pr({ head: { ref: 'main', repo: { full_name: REPO } }, base: { ref: 'integration/a' } }), REPO).delete, false);
});

test('an integration branch is deleted only when it merged into main', () => {
  const head = { ref: 'integration/arch8-backend', repo: { full_name: REPO } };
  assert.equal(branchDeletionDecision(pr({ head, base: { ref: 'main' } }), REPO).delete, true);
  assert.equal(branchDeletionDecision(pr({ head, base: { ref: 'integration/other' } }), REPO).delete, false);
  assert.equal(branchDeletionDecision(pr({ head, base: { ref: 'release/1.0.0' } }), REPO).delete, false);
});

const logs = () => {
  const lines = [];
  return { lines, log: (line) => lines.push(line) };
};

test('deleteMergedBranch deletes the head ref', async () => {
  const deleted = [];
  const { lines, log } = logs();
  const result = await deleteMergedBranch(pr(), { repository: REPO, deleteRef: async (ref) => deleted.push(ref), log });
  assert.deepEqual(deleted, ['fix/thing']);
  assert.equal(result.deleted, true);
  assert.match(lines.join('\n'), /Deleted branch fix\/thing/);
});

test('deleteMergedBranch does not call the API when the decision is no', async () => {
  const deleted = [];
  const result = await deleteMergedBranch(pr({ merged: false }), { repository: REPO, deleteRef: async (ref) => deleted.push(ref), log: () => {} });
  assert.deepEqual(deleted, []);
  assert.equal(result.deleted, false);
});

test('a branch that is already gone is a success, not a warning', async () => {
  for (const message of [
    'GitHub API DELETE /git/refs/heads/x failed (422): {"message":"Reference does not exist"}',
    'GitHub API DELETE /git/refs/heads/x failed (404): {"message":"Not Found"}',
  ]) {
    const { lines, log } = logs();
    const result = await deleteMergedBranch(pr(), { repository: REPO, deleteRef: async () => { throw new Error(message); }, log });
    assert.equal(result.deleted, false);
    assert.equal(result.gone, true);
    assert.ok(!lines.some((line) => line.startsWith('::warning')));
  }
});

test('any other failure warns and does not throw', async () => {
  const { lines, log } = logs();
  const result = await deleteMergedBranch(pr(), { repository: REPO, deleteRef: async () => { throw new Error('GitHub API DELETE failed (403): forbidden'); }, log });
  assert.equal(result.deleted, false);
  assert.equal(result.failed, true);
  assert.ok(lines.some((line) => line.startsWith('::warning') && line.includes('fix/thing')));
});

// deleteAfterAutoMerge: the Tests run finished; GitHub merges the PR a moment later when auto-merge is on.
const sequence = (...states) => {
  let call = 0;
  return async () => states[Math.min(call++, states.length - 1)];
};
const waitOptions = (extra = {}) => ({
  repository: REPO, deleteRef: async () => {}, log: () => {}, sleep: async () => {}, timeoutMs: 1000, pollIntervalMs: 100, ...extra,
});

test('deleteAfterAutoMerge waits for a pending auto-merge, then deletes', async () => {
  const deleted = [];
  const pending = pr({ merged: false, state: 'open', auto_merge: { merge_method: 'squash' } });
  let now = 0;
  const result = await deleteAfterAutoMerge(1, {
    ...waitOptions({ deleteRef: async (ref) => deleted.push(ref), sleep: async (ms) => { now += ms; } }),
    now: () => now,
    getPullRequest: sequence(pending, pending, pr()),
  });
  assert.deepEqual(deleted, ['fix/thing']);
  assert.equal(result.deleted, true);
});

test('deleteAfterAutoMerge leaves an open PR without auto-merge alone', async () => {
  const deleted = [];
  const result = await deleteAfterAutoMerge(1, {
    ...waitOptions({ deleteRef: async (ref) => deleted.push(ref) }),
    now: () => 0,
    getPullRequest: sequence(pr({ merged: false, state: 'open', auto_merge: null })),
  });
  assert.deepEqual(deleted, []);
  assert.equal(result.deleted, false);
});

test('deleteAfterAutoMerge gives up after the timeout and keeps the branch', async () => {
  const deleted = [];
  let now = 0;
  const result = await deleteAfterAutoMerge(1, {
    ...waitOptions({ deleteRef: async (ref) => deleted.push(ref), sleep: async (ms) => { now += ms; } }),
    now: () => now,
    getPullRequest: sequence(pr({ merged: false, state: 'open', auto_merge: { merge_method: 'squash' } })),
  });
  assert.deepEqual(deleted, []);
  assert.equal(result.deleted, false);
});
