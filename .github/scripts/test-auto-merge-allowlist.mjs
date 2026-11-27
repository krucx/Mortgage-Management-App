import test from 'node:test';
import assert from 'node:assert/strict';
import { autoMergeDecision } from './lib/auto-merge-allowlist.mjs';

const pr = (overrides = {}) => ({ state: 'open', draft: false, base: { ref: 'integration/refactor-500' }, ...overrides });

test('a non-draft open PR into integration/** is auto-merged with squash', () => {
  assert.deepEqual(autoMergeDecision(pr()), { enable: true, method: 'SQUASH', reason: 'integration-base' });
});

test('a PR into main is left alone', () => {
  const decision = autoMergeDecision(pr({ base: { ref: 'main' } }));
  assert.equal(decision.enable, false);
});

test('a draft PR is left alone, even into integration/**', () => {
  assert.equal(autoMergeDecision(pr({ draft: true })).enable, false);
});

test('an unknown base branch is left alone', () => {
  for (const ref of ['release/3.7.0', 'feature/x', 'integration', 'integration/', 'xintegration/a', '']) {
    assert.equal(autoMergeDecision(pr({ base: { ref } })).enable, false, ref);
  }
});

test('a closed PR is left alone', () => {
  assert.equal(autoMergeDecision(pr({ state: 'closed' })).enable, false);
});

test('a malformed PR is left alone', () => {
  assert.equal(autoMergeDecision(undefined).enable, false);
  assert.equal(autoMergeDecision({}).enable, false);
});

import { applyAutoMerge } from './auto-merge.mjs';

test('applyAutoMerge enables squash auto-merge only when the allowlist says so', async () => {
  const calls = [];
  const graphql = async (query, variables) => { calls.push(variables); };
  const quiet = { log() {} };
  await applyAutoMerge({ ...pr(), node_id: 'PR_1', number: 1 }, graphql, quiet);
  await applyAutoMerge({ ...pr({ base: { ref: 'main' } }), node_id: 'PR_2', number: 2 }, graphql, quiet);
  await applyAutoMerge({ ...pr({ draft: true }), node_id: 'PR_3', number: 3 }, graphql, quiet);
  assert.deepEqual(calls, [{ id: 'PR_1', method: 'SQUASH' }]);
});
