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

import { applyAutoMerge, mergeReleaseCandidate } from './auto-merge.mjs';
import * as fixture from './release-candidate-fixture.mjs';

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

// --- Release pull request into main ----------------------------------------------------------------
// Merged only from the Prepare release candidate workflow, which passes the commit it pushed and
// preflighted (releaseCandidate.expectedHeadSha). The conditions themselves are tested in
// test-release.mjs; these tests prove the allowlist case uses them and refuses each kind of failure.


const releaseApi = ({ expectedHeadSha = fixture.headCommit, files = fixture.releaseFiles(), checks = fixture.releaseChecks(), required = fixture.requiredChecks, runs = fixture.preflightRuns() } = {}) => ({
  releaseCandidate: expectedHeadSha ? { expectedHeadSha } : undefined,
  listFiles: async () => files,
  listChecks: async (sha) => (sha === fixture.headCommit ? checks : []),
  requiredChecks: async () => required,
  listPreflightRuns: async (sha) => runs.filter((run) => run.head_sha === sha),
});

test('release: the exact happy path is merged with a merge commit, pinned to the candidate commit', async () => {
  assert.deepEqual(await autoMergeDecision(fixture.releasePullRequest(), releaseApi()), {
    enable: true, method: 'MERGE', reason: 'release-candidate', expectedHeadOid: fixture.headCommit,
  });
});

test('release: the central workflow (no candidate context) leaves a release PR alone', async () => {
  const decision = await autoMergeDecision(fixture.releasePullRequest(), releaseApi({ expectedHeadSha: null }));
  assert.equal(decision.enable, false);
  assert.match(decision.reason, /release-.*candidate-workflow/);
});

test('release: refuses each failed condition', async () => {
  const [run] = fixture.preflightRuns();
  const cases = {
    'wrong head branch': [fixture.releasePullRequest({ head: { ref: 'release/3.4.7', sha: fixture.headCommit } }), releaseApi()],
    'VERSION not the branch version': [fixture.releasePullRequest(), releaseApi({ files: fixture.releaseFiles().map((f) => (f.filename === 'VERSION' ? { ...f, patch: '-3.4.5\n+3.4.7' } : f)) })],
    'head moved after the candidate push': [fixture.releasePullRequest({ head: { ref: fixture.branch, sha: 'c'.repeat(40) } }), releaseApi()],
    'head not preflight-validated': [fixture.releasePullRequest(), releaseApi({ runs: [{ ...run, conclusion: 'failure' }] })],
    'red required check': [fixture.releasePullRequest(), releaseApi({ checks: fixture.releaseChecks().map((c) => (c.name === 'windows' ? { ...c, conclusion: 'FAILURE' } : c)) })],
    'missing required check': [fixture.releasePullRequest(), releaseApi({ checks: fixture.releaseChecks().filter((c) => c.name !== 'Analyze (python)') })],
    'extra file': [fixture.releasePullRequest(), releaseApi({ files: [...fixture.releaseFiles(), { filename: 'Dockerfile', status: 'modified', additions: 1, deletions: 0, patch: '+RUN x' }] })],
    'not into main': [fixture.releasePullRequest({ base: { ref: 'integration/x' } }), releaseApi()],
  };
  for (const [name, [pullRequest, prApi]] of Object.entries(cases)) {
    const decision = await autoMergeDecision(pullRequest, prApi);
    if (name === 'not into main') {
      assert.equal(decision.reason, 'integration-base', name); // the integration rule, not this one
      continue;
    }
    assert.equal(decision.enable, false, name);
    assert.match(decision.reason, /^release-/, name);
  }
});

test('release: a draft or closed release PR is left alone', async () => {
  assert.equal((await autoMergeDecision(fixture.releasePullRequest({ draft: true }), releaseApi())).enable, false);
  assert.equal((await autoMergeDecision(fixture.releasePullRequest({ state: 'closed' }), releaseApi())).enable, false);
});

const ENABLE_RE = /enablePullRequestAutoMerge/;
const MERGE_RE = /mergePullRequest\(/;
const DISABLE_RE = /disablePullRequestAutoMerge/;

function recordingGraphql({ enableError } = {}) {
  const calls = [];
  const graphql = async (query, variables) => {
    const kind = ENABLE_RE.test(query) ? 'enable' : MERGE_RE.test(query) ? 'merge' : DISABLE_RE.test(query) ? 'disable' : 'other';
    calls.push({ kind, ...variables });
    if (kind === 'enable' && enableError) throw new Error(enableError);
  };
  return { calls, graphql };
}

test('applyAutoMerge pins the head commit when the decision names one', async () => {
  const { calls, graphql } = recordingGraphql();
  const result = await applyAutoMerge(fixture.releasePullRequest(), graphql, { log() {}, api: releaseApi() });
  assert.equal(result.enabled, true);
  assert.deepEqual(calls, [{ kind: 'enable', id: 'PR_266', method: 'MERGE', head: fixture.headCommit }]);
});

test('applyAutoMerge merges a pinned PR at once when GitHub says it is already clean', async () => {
  const { calls, graphql } = recordingGraphql({ enableError: 'GitHub GraphQL failed: [{"type":"UNPROCESSABLE","message":"Pull request Pull request is in clean status"}]' });
  const result = await applyAutoMerge(fixture.releasePullRequest(), graphql, { log() {}, api: releaseApi() });
  assert.equal(result.merged, true);
  assert.deepEqual(calls.map((call) => call.kind), ['enable', 'merge']);
  assert.equal(calls[1].head, fixture.headCommit);
  assert.equal(calls[1].method, 'MERGE');
});

test('applyAutoMerge never merges an unpinned (integration) PR directly, even when clean', async () => {
  const { calls, graphql } = recordingGraphql({ enableError: 'GitHub GraphQL failed: [{"type":"UNPROCESSABLE","message":"Pull request is in clean status"}]' });
  const result = await applyAutoMerge({ ...pr(), node_id: 'PR_1', number: 1 }, graphql, { log() {} });
  assert.equal(result.enabled, false);
  assert.deepEqual(calls.map((call) => call.kind), ['enable']);
});

const clock = () => {
  let time = 0;
  return { now: () => time, sleep: async (ms) => { time += ms; } };
};

test('mergeReleaseCandidate returns the merge commit once GitHub has merged the PR', async () => {
  const { calls, graphql } = recordingGraphql();
  const states = [fixture.releasePullRequest(), fixture.releasePullRequest({ state: 'closed', merged: true, merge_commit_sha: fixture.mergeCommit })];
  const result = await mergeReleaseCandidate({
    pullRequest: fixture.releasePullRequest(), expectedHeadSha: fixture.headCommit, api: releaseApi({ expectedHeadSha: null }), graphql,
    getPullRequest: async () => states.shift(), log() {}, ...clock(),
  });
  assert.deepEqual(result, { pullRequest: 266, mergeCommit: fixture.mergeCommit, headCommit: fixture.headCommit });
  assert.deepEqual(calls.map((call) => call.kind), ['enable']);
});

test('mergeReleaseCandidate refuses, touching nothing, when a condition fails', async () => {
  const { calls, graphql } = recordingGraphql();
  await assert.rejects(mergeReleaseCandidate({
    pullRequest: fixture.releasePullRequest(), expectedHeadSha: 'c'.repeat(40), api: releaseApi(), graphql,
    getPullRequest: async () => assert.fail('must not poll'), log() {}, ...clock(),
  }), /not merged.*release-/);
  assert.deepEqual(calls, []);
});

test('mergeReleaseCandidate turns auto-merge off again and fails if GitHub does not merge in time', async () => {
  const { calls, graphql } = recordingGraphql();
  await assert.rejects(mergeReleaseCandidate({
    pullRequest: fixture.releasePullRequest(), expectedHeadSha: fixture.headCommit, api: releaseApi(), graphql,
    getPullRequest: async () => fixture.releasePullRequest(), timeoutMs: 60_000, log() {}, ...clock(),
  }), /did not merge within/);
  assert.deepEqual(calls.map((call) => call.kind), ['enable', 'disable']);
});

test('mergeReleaseCandidate fails when GitHub refuses auto-merge', async () => {
  const { graphql } = recordingGraphql({ enableError: 'GitHub GraphQL failed: [{"type":"UNPROCESSABLE","message":"Pull request is in blocked status"}]' });
  await assert.rejects(mergeReleaseCandidate({
    pullRequest: fixture.releasePullRequest(), expectedHeadSha: fixture.headCommit, api: releaseApi(), graphql,
    getPullRequest: async () => fixture.releasePullRequest(), log() {}, ...clock(),
  }), /refused/);
});

test('mergeReleaseCandidate waits while a check is only still running, then merges', async () => {
  const { calls, graphql } = recordingGraphql();
  const running = fixture.releaseChecks().map((c) => (c.name === 'CodeRabbit' ? { ...c, status: 'IN_PROGRESS', conclusion: null } : c));
  const checks = [running, fixture.releaseChecks()];
  const prApi = { ...releaseApi(), listChecks: async () => (checks.length > 1 ? checks.shift() : checks[0]) };
  const states = [fixture.releasePullRequest(), fixture.releasePullRequest({ state: 'closed', merged: true, merge_commit_sha: fixture.mergeCommit })];
  const result = await mergeReleaseCandidate({
    pullRequest: fixture.releasePullRequest(), expectedHeadSha: fixture.headCommit, api: prApi, graphql,
    getPullRequest: async () => (states.length > 1 ? states.shift() : states[0]), log() {}, ...clock(),
  });
  assert.equal(result.mergeCommit, fixture.mergeCommit);
  assert.deepEqual(calls.map((call) => call.kind), ['enable']);
});

test('mergeReleaseCandidate gives up, merging nothing, when a check is still running at the timeout', async () => {
  const { calls, graphql } = recordingGraphql();
  const running = fixture.releaseChecks().map((c) => (c.name === 'qa' ? { ...c, status: 'QUEUED', conclusion: null } : c));
  await assert.rejects(mergeReleaseCandidate({
    pullRequest: fixture.releasePullRequest(), expectedHeadSha: fixture.headCommit, api: releaseApi({ checks: running }), graphql,
    getPullRequest: async () => fixture.releasePullRequest(), timeoutMs: 60_000, log() {}, ...clock(),
  }), /not merged.*checks still running: qa: QUEUED/);
  assert.deepEqual(calls, []);
});

test('mergeReleaseCandidate reports the merge when GitHub merges just as the timeout turns auto-merge off', async () => {
  const { calls, graphql } = recordingGraphql();
  const merged = fixture.releasePullRequest({ state: 'closed', merged: true, merge_commit_sha: fixture.mergeCommit });
  const states = [fixture.releasePullRequest(), merged];
  const result = await mergeReleaseCandidate({
    pullRequest: fixture.releasePullRequest(), expectedHeadSha: fixture.headCommit, api: releaseApi(), graphql,
    getPullRequest: async () => (states.length > 1 ? states.shift() : states[0]), timeoutMs: 0, log() {}, ...clock(),
  });
  assert.equal(result.mergeCommit, fixture.mergeCommit);
  assert.deepEqual(calls.map((call) => call.kind), ['enable', 'disable']);
});

test('mergeReleaseCandidate names the mergeable state when the branch fell behind main', async () => {
  const { graphql } = recordingGraphql();
  await assert.rejects(mergeReleaseCandidate({
    pullRequest: fixture.releasePullRequest(), expectedHeadSha: fixture.headCommit, api: releaseApi(), graphql,
    getPullRequest: async () => fixture.releasePullRequest({ mergeable_state: 'behind' }), timeoutMs: 0, log() {}, ...clock(),
  }), /mergeable state behind/);
});
