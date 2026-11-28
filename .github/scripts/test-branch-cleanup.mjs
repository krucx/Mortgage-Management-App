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

// The sweep: a scheduled safety net for merges the poll missed (checks failed, fix pushed, merged much later).
import { listRecentlyClosedPulls, sweepMergedBranches } from './lib/branch-cleanup.mjs';

const NOW = Date.parse('2026-11-28T12:00:00Z');
const daysAgo = (days) => new Date(NOW - days * 86_400_000).toISOString();
const listed = (number, ref, { base = 'integration/arch8-backend', mergedDaysAgo = 1, closedDaysAgo = mergedDaysAgo, repo = REPO } = {}) => ({
  number,
  state: 'closed',
  merged_at: mergedDaysAgo === null ? null : daysAgo(mergedDaysAgo),
  closed_at: daysAgo(closedDaysAgo),
  updated_at: daysAgo(closedDaysAgo),
  head: { ref, repo: { full_name: repo } },
  base: { ref: base },
});
const open = (number, ref, base = 'main') => ({ number, state: 'open', head: { ref, repo: { full_name: REPO } }, base: { ref: base } });
const sweep = (closed, opened = [], extra = {}) => {
  const deleted = [];
  const { lines, log } = logs();
  return sweepMergedBranches({
    repository: REPO, now: () => NOW, log,
    listClosedPulls: async () => closed, listOpenPulls: async () => opened,
    deleteRef: async (ref) => deleted.push(ref), ...extra,
  }).then((results) => ({ results, deleted, lines }));
};

test('the sweep deletes the heads of recently merged PRs and keeps the rest', async () => {
  const { deleted } = await sweep([
    listed(615, 'fix/a'),
    listed(616, 'fix/closed-unmerged', { mergedDaysAgo: null }),
    listed(617, 'fix/old', { mergedDaysAgo: 8 }),
    listed(618, 'fix/fork', { repo: 'someone/r' }),
    listed(619, 'integration/arch8-backend', { base: 'integration/other' }),
    listed(620, 'integration/arch8-backend', { base: 'main' }),
  ]);
  assert.deepEqual(deleted, ['fix/a', 'integration/arch8-backend']);
});

test('the sweep keeps a head that another open PR uses as its head or base', async () => {
  const { deleted, lines } = await sweep(
    [listed(1, 'fix/shared'), listed(2, 'fix/stacked'), listed(3, 'fix/free')],
    [open(10, 'fix/shared'), open(11, 'fix/other', 'fix/stacked')],
  );
  assert.deepEqual(deleted, ['fix/free']);
  assert.match(lines.join('\n'), /fix\/shared.*open PR/);
});

test('the sweep tries a branch once even when several merged PRs used it', async () => {
  const { deleted } = await sweep([listed(1, 'fix/again'), listed(2, 'fix/again')]);
  assert.deepEqual(deleted, ['fix/again']);
});

test('the sweep survives a failed or missing branch and still handles the rest', async () => {
  const reached = [];
  const { lines } = await sweep(
    [listed(1, 'fix/boom'), listed(2, 'fix/gone'), listed(3, 'fix/fine')],
    [],
    { deleteRef: async (ref) => {
      reached.push(ref);
      if (ref === 'fix/boom') throw new Error('GitHub API DELETE failed (403): forbidden');
      if (ref === 'fix/gone') throw new Error('failed (422): Reference does not exist');
    } },
  );
  assert.deepEqual(reached, ['fix/boom', 'fix/gone', 'fix/fine']);
  assert.ok(lines.some((line) => line.startsWith('::warning') && line.includes('fix/boom')));
  assert.ok(!lines.some((line) => line.startsWith('::warning') && line.includes('fix/gone')));
});

test('listRecentlyClosedPulls pages newest-updated first and stops at the cutoff', async () => {
  const pages = {
    '/pulls?state=closed&sort=updated&direction=desc&per_page=100': { data: [listed(3, 'a', { closedDaysAgo: 1 }), listed(2, 'b', { closedDaysAgo: 6 })], next: '/p2' },
    '/p2': { data: [listed(1, 'c', { closedDaysAgo: 9 })], next: '/p3' },
  };
  const requested = [];
  const pulls = await listRecentlyClosedPulls(async (path) => { requested.push(path); return pages[path]; }, NOW, 7);
  assert.deepEqual(pulls.map((p) => p.number), [3, 2]);
  assert.deepEqual(requested, Object.keys(pages));
});
