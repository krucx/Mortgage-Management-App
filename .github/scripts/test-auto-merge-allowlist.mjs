import test from 'node:test';
import assert from 'node:assert/strict';
import { autoMergeDecision } from './lib/auto-merge-allowlist.mjs';
import { parseUpdatedDependencies, parseVersionChanges, classifyVersionChange } from './lib/dependabot-metadata.mjs';

const pr = (overrides = {}) => ({ state: 'open', draft: false, base: { ref: 'integration/refactor-500' }, ...overrides });

test('a non-draft open PR into integration/** is auto-merged with squash', async () => {
  assert.deepEqual(await autoMergeDecision(pr()), { enable: true, method: 'SQUASH', reason: 'integration-base' });
});

test('a PR into main is left alone', async () => {
  const decision = await autoMergeDecision(pr({ base: { ref: 'main' } }));
  assert.equal(decision.enable, false);
});

test('a draft PR is left alone, even into integration/**', async () => {
  assert.equal((await autoMergeDecision(pr({ draft: true }))).enable, false);
});

test('an unknown base branch is left alone', async () => {
  for (const ref of ['release/3.7.0', 'feature/x', 'integration', 'integration/', 'xintegration/a', '']) {
    assert.equal((await autoMergeDecision(pr({ base: { ref } }))).enable, false, ref);
  }
});

test('a closed PR is left alone', async () => {
  assert.equal((await autoMergeDecision(pr({ state: 'closed' }))).enable, false);
});

test('a malformed PR is left alone', async () => {
  assert.equal((await autoMergeDecision(undefined)).enable, false);
  assert.equal((await autoMergeDecision({})).enable, false);
});

import { applyAutoMerge } from './auto-merge.mjs';

// --- Dependabot into main -------------------------------------------------------------------------
// Commit messages in the shape Dependabot really writes (see PRs #480, #314, #472).

const entry = (name, from, to, updateType) =>
  ({ name, from, to, updateType });

function dependabotCommit(entries, { metadata = true } = {}) {
  const lines = entries.map((e) => `Updates \`${e.name}\` from ${e.from} to ${e.to}\n- [Release notes](https://example.test)\n`).join('\n');
  const yaml = entries.map((e) => [
    `- dependency-name: ${e.name}`,
    `  dependency-version: ${e.to}`,
    '  dependency-type: direct:production',
    ...(e.updateType ? [`  update-type: ${e.updateType}`] : []),
    '  dependency-group: npm',
  ].join('\n')).join('\n');
  const block = metadata ? `---\nupdated-dependencies:\n${yaml}\n...\n\nSigned-off-by: dependabot[bot] <support@github.com>` : '';
  return { author: { login: 'dependabot[bot]' }, commit: { message: `Bump the npm group\n\n${lines}\n${block}` } };
}

const PATCH = 'version-update:semver-patch';
const MINOR = 'version-update:semver-minor';
const MAJOR = 'version-update:semver-major';

const dependabotPr = (overrides = {}) => ({
  state: 'open', draft: false, base: { ref: 'main' }, user: { login: 'dependabot[bot]' }, head: { ref: 'dependabot/npm_and_yarn/frontend/npm-abc' },
  ...overrides,
});
const api = ({ commits, files = ['frontend/package.json', 'frontend/package-lock.json'] }) => ({
  listCommits: async () => commits,
  listFiles: async () => files.map((filename) => (typeof filename === 'string' ? { filename } : filename)),
});

test('a single patch bump is auto-merged', async () => {
  const commits = [dependabotCommit([entry('vite', '8.3.7', '8.3.8', PATCH)])];
  assert.deepEqual(await autoMergeDecision(dependabotPr(), api({ commits })), { enable: true, method: 'SQUASH', reason: 'dependabot-patch-minor' });
});

test('a single minor bump is auto-merged', async () => {
  const commits = [dependabotCommit([entry('oxlint', '1.93.0', '1.94.0', MINOR)])];
  assert.equal((await autoMergeDecision(dependabotPr(), api({ commits }))).enable, true);
});

test('a single major bump is refused', async () => {
  const commits = [dependabotCommit([entry('actions/cache', '4.2.4', '6.1.0', MAJOR)])];
  const decision = await autoMergeDecision(dependabotPr(), api({ commits }));
  assert.equal(decision.enable, false);
  assert.match(decision.reason, /dependabot-major.*actions\/cache/);
});

test('a grouped PR with one major among minors is refused', async () => {
  const commits = [dependabotCommit([
    entry('vite', '8.3.7', '8.3.8', PATCH),
    entry('jsdom', '31.0.0', '32.0.0', MAJOR),
    entry('oxlint', '1.93.0', '1.94.0', MINOR),
  ])];
  const decision = await autoMergeDecision(dependabotPr(), api({ commits }));
  assert.equal(decision.enable, false);
  assert.match(decision.reason, /dependabot-major.*jsdom/);
});

test('a grouped PR of only patch and minor bumps is auto-merged', async () => {
  const commits = [dependabotCommit([
    entry('@tanstack/react-query', '5.107.1', '5.108.0', MINOR),
    entry('jsdom', '31.0.0', '31.0.1', PATCH),
    entry('vite', '8.3.7', '8.3.8', PATCH),
  ])];
  assert.equal((await autoMergeDecision(dependabotPr(), api({ commits }))).enable, true);
});

test('a major shown only by the version lines is still refused', async () => {
  const commits = [dependabotCommit([entry('left-pad', '1.3.0', '2.0.0', MINOR)])];
  assert.match((await autoMergeDecision(dependabotPr(), api({ commits }))).reason, /dependabot-major/);
});

test('a Dependabot PR touching a critical path is refused', async () => {
  const commits = [dependabotCommit([entry('actions/checkout', '7.0.0', '7.0.1', PATCH)])];
  for (const file of ['.github/workflows/test.yml', 'Dockerfile', 'backend/src/mortgage_backend/lending/interest.py', 'frontend/src/money.ts']) {
    const decision = await autoMergeDecision(dependabotPr(), api({ commits, files: ['frontend/package.json', file] }));
    assert.equal(decision.enable, false, file);
    assert.match(decision.reason, /dependabot-critical-path/, file);
  }
});

test('a renamed file leaving a critical path is refused', async () => {
  const commits = [dependabotCommit([entry('vite', '8.3.7', '8.3.8', PATCH)])];
  const files = [{ filename: 'docs/x.yml', previous_filename: '.github/workflows/x.yml' }];
  assert.equal((await autoMergeDecision(dependabotPr(), api({ commits, files }))).enable, false);
});

test('a Dependabot PR fails closed on missing, unknown or edited metadata', async () => {
  const cases = {
    'no metadata block': [dependabotCommit([entry('vite', '8.3.7', '8.3.8', PATCH)], { metadata: false })],
    'an entry with no update-type and no readable versions': [dependabotCommit([entry('playwright', 'abc123', 'def456', null)])],
    'an unknown update type': [dependabotCommit([entry('vite', '8.3.7', '8.3.8', 'version-update:semver-weird')])],
    'no commits': [],
    'a human commit on the branch': [dependabotCommit([entry('vite', '8.3.7', '8.3.8', PATCH)]), { author: { login: 'krucx' }, commit: { message: 'tweak' } }],
  };
  for (const [name, commits] of Object.entries(cases)) {
    assert.equal((await autoMergeDecision(dependabotPr(), api({ commits }))).enable, false, name);
  }
});

test('an entry without update-type (indirect dependency) uses its version change', async () => {
  const safe = [dependabotCommit([entry('opentelemetry-api', '1.45.1', '1.45.2', null)])];
  assert.equal((await autoMergeDecision(dependabotPr(), api({ commits: safe }))).enable, true);
  const major = [dependabotCommit([entry('opentelemetry-api', '1.45.1', '2.0.0', null)])];
  assert.match((await autoMergeDecision(dependabotPr(), api({ commits: major }))).reason, /dependabot-major/);
});

test('a single-package PR worded "Bumps [name](url) from A to B." is read', async () => {
  const message = 'Bump x\n\nBumps [opentelemetry-api](https://example.test/x) from 1.45.1 to 2.0.0.\n\n---\nupdated-dependencies:\n- dependency-name: opentelemetry-api\n  dependency-version: 2.0.0\n  dependency-type: indirect\n...\n';
  assert.deepEqual(parseVersionChanges(message), [{ name: 'opentelemetry-api', from: '1.45.1', to: '2.0.0' }]);
  const commits = [{ author: { login: 'dependabot[bot]' }, commit: { message } }];
  assert.match((await autoMergeDecision(dependabotPr(), api({ commits }))).reason, /dependabot-major/);
});

test('classifyVersionChange', () => {
  assert.equal(classifyVersionChange({ from: '1.2.3', to: '1.2.4' }), 'patch');
  assert.equal(classifyVersionChange({ from: '1.2.3', to: '1.3.0' }), 'minor');
  assert.equal(classifyVersionChange({ from: '1.2.3', to: '2.0.0' }), 'major');
  assert.equal(classifyVersionChange({ from: '1.2.3', to: '1.2.2' }), null);
  assert.equal(classifyVersionChange({ from: 'abc', to: 'def' }), null);
});

test('only Dependabot into main gets this rule', async () => {
  const commits = [dependabotCommit([entry('vite', '8.3.7', '8.3.8', PATCH)])];
  for (const overrides of [
    { user: { login: 'krucx' } },
    { user: { login: 'dependabot[bot]' }, head: { ref: 'feature/x' } },
    { base: { ref: 'release/3.7.0' } },
    { draft: true },
  ]) {
    assert.equal((await autoMergeDecision(dependabotPr(overrides), api({ commits }))).enable, false, JSON.stringify(overrides));
  }
});

test('a failed lookup surfaces instead of enabling auto-merge', async () => {
  const broken = { listCommits: async () => { throw new Error('boom'); }, listFiles: async () => [] };
  await assert.rejects(autoMergeDecision(dependabotPr(), broken), /boom/);
});

test('the metadata parsers read the real Dependabot shapes', () => {
  const message = dependabotCommit([entry('jsdom', '31.0.0', '31.0.1', PATCH)]).commit.message;
  assert.deepEqual(parseUpdatedDependencies(message), [{ name: 'jsdom', updateType: PATCH }]);
  assert.deepEqual(parseVersionChanges(message), [{ name: 'jsdom', from: '31.0.0', to: '31.0.1' }]);
  assert.deepEqual(parseUpdatedDependencies('no block'), []);
});

test('applyAutoMerge enables squash auto-merge only when the allowlist says so', async () => {
  const calls = [];
  const graphql = async (query, variables) => { calls.push(variables); };
  const quiet = { log() {} };
  await applyAutoMerge({ ...pr(), node_id: 'PR_1', number: 1 }, graphql, quiet);
  await applyAutoMerge({ ...pr({ base: { ref: 'main' } }), node_id: 'PR_2', number: 2 }, graphql, quiet);
  await applyAutoMerge({ ...pr({ draft: true }), node_id: 'PR_3', number: 3 }, graphql, quiet);
  assert.deepEqual(calls, [{ id: 'PR_1', method: 'SQUASH' }]);
});

test('applyAutoMerge warns instead of failing when GitHub refuses auto-merge for the PR status', async () => {
  const logs = [];
  const graphql = async () => { throw new Error('GitHub GraphQL failed (200): [{"type":"UNPROCESSABLE","message":"Pull request is in unstable status"}]'); };
  const decision = await applyAutoMerge({ ...pr(), node_id: 'PR_1', number: 1 }, graphql, { log: (line) => logs.push(line) });
  assert.equal(decision.enable, true);
  assert.equal(decision.enabled, false);
  assert.match(logs.join('\n'), /::warning::.*#1.*unstable status/);
});

test('applyAutoMerge still fails on any other GitHub error', async () => {
  const graphql = async () => { throw new Error('GitHub GraphQL failed (401): Bad credentials'); };
  await assert.rejects(applyAutoMerge({ ...pr(), node_id: 'PR_1', number: 1 }, graphql, { log() {} }), /401/);
});
