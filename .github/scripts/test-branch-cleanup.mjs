import assert from 'node:assert/strict';
import test from 'node:test';
import { branchDeletionDecision, deleteMergedBranch, sweepMergedBranches } from './lib/branch-cleanup.mjs';

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

// The sweep: the weekly sweep of branches that GITHUB_TOKEN merges left behind.

const NOW = Date.parse('2026-11-28T12:00:00Z');
const daysAgo = (days) => new Date(NOW - days * 86_400_000).toISOString();
const listed = (number, ref, { base = 'integration/arch8-backend', mergedDaysAgo = 10, repo = REPO } = {}) => ({
  number,
  state: 'closed',
  merged_at: mergedDaysAgo === null ? null : daysAgo(mergedDaysAgo),
  head: { ref, sha: `sha-${ref}`, repo: { full_name: repo } },
  base: { ref: base },
});
const open = (number, ref, base = 'main') => ({ number, state: 'open', head: { ref, repo: { full_name: REPO } }, base: { ref: base } });
const sweep = (closed, opened = [], extra = {}) => {
  const deleted = [];
  const { lines, log } = logs();
  return sweepMergedBranches({
    repository: REPO, now: () => NOW, log,
    listClosedPulls: async () => closed, listOpenPulls: async () => opened,
    refSha: async (ref) => (ref.includes('gone') ? null : `sha-${ref}`),
    deleteRef: async (ref) => deleted.push(ref), ...extra,
  }).then((results) => ({ results, deleted, lines }));
};

test('the sweep deletes the heads of PRs merged at least 7 days ago and keeps the rest', async () => {
  const { deleted } = await sweep([
    listed(615, 'fix/a'),
    listed(616, 'fix/closed-unmerged', { mergedDaysAgo: null }),
    listed(617, 'fix/this-week', { mergedDaysAgo: 6 }),
    listed(621, 'fix/very-old', { mergedDaysAgo: 120 }),
    listed(622, 'fix/just-over-a-week', { mergedDaysAgo: 7.01 }),
    listed(618, 'fix/fork', { repo: 'someone/r' }),
    listed(619, 'integration/arch8-backend', { base: 'integration/other' }),
    listed(620, 'integration/arch8-backend', { base: 'main' }),
  ]);
  assert.deepEqual(deleted, ['fix/a', 'fix/very-old', 'fix/just-over-a-week', 'integration/arch8-backend']);
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
    { refSha: async (ref) => `sha-${ref}`, deleteRef: async (ref) => {
      reached.push(ref);
      if (ref === 'fix/boom') throw new Error('GitHub API DELETE failed (403): forbidden');
      if (ref === 'fix/gone') throw new Error('failed (422): Reference does not exist');
    } },
  );
  assert.deepEqual(reached, ['fix/boom', 'fix/gone', 'fix/fine']);
  assert.ok(lines.some((line) => line.startsWith('::warning') && line.includes('fix/boom')));
  assert.ok(!lines.some((line) => line.startsWith('::warning') && line.includes('fix/gone')));
});

test('a dry run lists the existing branches it would delete and deletes nothing', async () => {
  const { deleted, lines, results } = await sweep(
    [listed(1, 'fix/a'), listed(2, 'fix/gone'), listed(3, 'fix/b', { mergedDaysAgo: 2 })],
    [],
    { dryRun: true },
  );
  assert.deepEqual(deleted, []);
  assert.deepEqual(results.map((r) => r.ref), ['fix/a']);
  assert.match(lines.join('\n'), /would delete branch fix\/a/);
  assert.ok(!lines.join('\n').includes('fix/gone'));
});

test('the sweep keeps a reused branch whose tip is not the head of a merged PR, in a dry run too', async () => {
  for (const dryRun of [false, true]) {
    const { deleted, lines, results } = await sweep(
      [listed(1, 'fix/reused'), listed(2, 'fix/same')],
      [],
      { dryRun, refSha: async (ref) => (ref === 'fix/reused' ? 'sha-new-work' : `sha-${ref}`) },
    );
    assert.deepEqual(results.map((r) => r.ref), ['fix/same']);
    assert.deepEqual(deleted, dryRun ? [] : ['fix/same']);
    assert.match(lines.join('\n'), /fix\/reused kept \(reused/);
  }
});

test('a branch reused by a later PR is deleted when its tip is the head of one old merged PR', async () => {
  const older = listed(1, 'fix/again');
  const newer = { ...listed(2, 'fix/again'), head: { ref: 'fix/again', sha: 'sha-second', repo: { full_name: REPO } } };
  const { deleted } = await sweep([newer, older], [], { refSha: async () => 'sha-fix/again' });
  assert.deepEqual(deleted, ['fix/again']);
});
