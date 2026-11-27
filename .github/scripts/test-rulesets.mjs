import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { diffRulesets, planApply } from './lib/rulesets.mjs';

const read = (name) => JSON.parse(readFileSync(new URL(`../rulesets/${name}.json`, import.meta.url), 'utf8'));
const rule = (ruleset, type) => ruleset.rules.find((r) => r.type === type);
const checks = (ruleset) => rule(ruleset, 'required_status_checks').parameters.required_status_checks.map((c) => c.context);
const workflow = (name) => readFileSync(new URL(`../workflows/${name}`, import.meta.url), 'utf8');

// --- The committed rulesets are the agreed shape (#569) ---------------------------------------

test('main: no approval, up to date required, no CodeRabbit, heavy checks required', () => {
  const main = read('main');
  assert.deepEqual(main.conditions.ref_name.include, ['refs/heads/main']);
  assert.equal(rule(main, 'pull_request').parameters.required_approving_review_count, 0);
  assert.equal(rule(main, 'required_status_checks').parameters.strict_required_status_checks_policy, true);
  const names = checks(main);
  assert.ok(!names.some((n) => /coderabbit/i.test(n)));
  for (const heavy of ['image', 'windows', 'Analyze (actions)', 'Analyze (javascript-typescript)', 'Analyze (python)', 'backend', 'frontend', 'version-bump']) {
    assert.ok(names.includes(heavy), heavy);
  }
  assert.ok(rule(main, 'deletion') && rule(main, 'non_fast_forward'));
});

test('integration/**: fast checks only, not up-to-date, no approval, all merge methods, force-push blocked', () => {
  const integration = read('integration');
  assert.deepEqual(integration.conditions.ref_name.include, ['refs/heads/integration/**']);
  assert.deepEqual(checks(integration).sort(), ['backend', 'frontend', 'version-bump']);
  assert.equal(rule(integration, 'required_status_checks').parameters.strict_required_status_checks_policy, false);
  const pr = rule(integration, 'pull_request').parameters;
  assert.equal(pr.required_approving_review_count, 0);
  assert.deepEqual([...pr.allowed_merge_methods].sort(), ['merge', 'rebase', 'squash']);
  assert.ok(rule(integration, 'non_fast_forward'));
});

test('every required check name is a job that Tests or CodeQL reports', () => {
  const reported = [...workflow('test.yml').matchAll(/^ {2}([a-z][a-z-]*):\s*$/gm)].map((m) => m[1]);
  const codeql = workflow('codeql.yml');
  for (const name of [...checks(read('main')), ...checks(read('integration'))]) {
    const language = name.match(/^Analyze \((.+)\)$/)?.[1];
    if (language) assert.ok(codeql.includes(language) && /name: Analyze/.test(codeql), name);
    else assert.ok(reported.includes(name), name);
  }
});

test('Tests runs on pull requests into integration/**, or its required checks never report', () => {
  assert.match(workflow('test.yml'), /pull_request:\s*\n\s*branches: \[main, 'integration\/\*\*'\]/);
});

test('one job discovers every script test without running any twice', () => {
  const wf = workflow('test.yml');
  const scriptTests = readdirSync(new URL('.', import.meta.url)).filter((name) => /^test-.*\.mjs$/.test(name));
  assert.ok(scriptTests.length > 0);
  assert.match(wf, /node --test \.github\/scripts\/test-\*\.mjs/);
  const versionBump = wf.match(/^  version-bump:\n([\s\S]*?)^  backend:/m)?.[1];
  assert.ok(versionBump);
  assert.match(versionBump, /^    if: \$\{\{ !cancelled\(\) \}\}$/m, 'script tests also run when a tree is reused');
  for (const name of scriptTests) {
    assert.equal(wf.split(name).length - 1, 0, `${name} should be discovered by the glob, not hand-listed`);
  }
  assert.equal([...wf.matchAll(/node --test \.github\/scripts\/test-\*\.mjs/g)].length, 1);
});

// --- diffRulesets -----------------------------------------------------------------------------

const live = () => ({
  id: 1, node_id: 'x', source: 'r', source_type: 'Repository', created_at: 'a', updated_at: 'b', _links: {},
  current_user_can_bypass: 'never',
  name: 'Protect main', target: 'branch', enforcement: 'active',
  conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } },
  bypass_actors: [{ actor_id: 2, actor_type: 'RepositoryRole', bypass_mode: 'pull_request' }],
  rules: [
    { type: 'non_fast_forward' },
    { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true, do_not_enforce_on_create: false, required_status_checks: [{ context: 'b', integration_id: 15368 }, { context: 'a' }] } },
  ],
});
const committed = () => ({
  name: 'Protect main', target: 'branch', enforcement: 'active',
  conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } },
  bypass_actors: [{ actor_id: 2, actor_type: 'RepositoryRole', bypass_mode: 'pull_request' }],
  rules: [
    { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: 'a' }, { context: 'b' }] } },
    { type: 'non_fast_forward' },
  ],
});

test('no drift when live only differs in server fields, defaults and ordering', () => {
  assert.deepEqual(diffRulesets(committed(), live()), []);
});

test('drift lists a missing check, a changed value and a missing rule', () => {
  const l = live();
  l.rules[1].parameters.required_status_checks.pop();
  l.rules[1].parameters.strict_required_status_checks_policy = false;
  l.rules.shift();
  const text = diffRulesets(committed(), l).join('\n');
  assert.match(text, /required_status_checks.*strict_required_status_checks_policy.*committed true.*live false/s);
  assert.match(text, /a/);
  assert.match(text, /non_fast_forward.*live: missing/s);
});

test('a live rule the committed file lacks is drift', () => {
  const l = live();
  l.rules.push({ type: 'deletion' });
  assert.match(diffRulesets(committed(), l).join('\n'), /deletion.*committed: missing/s);
});

// --- planApply --------------------------------------------------------------------------------

test('planApply creates a missing ruleset and updates an existing one by name', () => {
  assert.deepEqual(planApply(committed(), []), { action: 'create' });
  assert.deepEqual(planApply(committed(), [{ id: 7, name: 'Protect main' }]), { action: 'update', id: 7 });
});

// --- the apply script -------------------------------------------------------------------------

import { run } from './apply-rulesets.mjs';

function fakeGh(existing) {
  const calls = [];
  const gh = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET' && path.endsWith('/rulesets')) return existing.map(({ id, name }) => ({ id, name }));
    if (method === 'GET') return existing.find((r) => path.endsWith(`/${r.id}`));
    return {};
  };
  return { gh, calls };
}
const out = () => { const lines = []; return { log: (l) => lines.push(l), text: () => lines.join('\n') }; };
const liveMain = () => ({ id: 5, ...JSON.parse(readFileSync(new URL('../rulesets/main.json', import.meta.url), 'utf8')) });

test('dry-run (the default) prints the drift and never writes', async () => {
  const { gh, calls } = fakeGh([{ ...liveMain(), rules: [{ type: 'deletion' }] }]);
  const o = out();
  const code = await run({ args: [], gh, log: o.log, repo: 'o/r' });
  assert.equal(code, 1, 'drift exits non-zero');
  assert.match(o.text(), /Protect main/);
  assert.match(o.text(), /Protect integration branches.*would be created/s);
  assert.ok(calls.every((c) => c.method === 'GET'));
});

test('dry-run exits 0 when nothing drifts', async () => {
  const integration = JSON.parse(readFileSync(new URL('../rulesets/integration.json', import.meta.url), 'utf8'));
  const { gh } = fakeGh([liveMain(), { id: 6, ...integration }]);
  const o = out();
  assert.equal(await run({ args: ['--dry-run'], gh, log: o.log, repo: 'o/r' }), 0);
  assert.match(o.text(), /no drift/i);
});

test('--apply updates the existing ruleset and creates the missing one', async () => {
  const { gh, calls } = fakeGh([{ ...liveMain(), rules: [] }]);
  await run({ args: ['--apply'], gh, log: () => {}, repo: 'o/r' });
  const writes = calls.filter((c) => c.method !== 'GET');
  assert.deepEqual(writes.map((w) => [w.method, w.path]), [['POST', '/repos/o/r/rulesets'], ['PUT', '/repos/o/r/rulesets/5']]);
  assert.equal(writes[0].body.name, 'Protect integration branches');
});

test('unknown flags are refused and write nothing', async () => {
  const { gh, calls } = fakeGh([]);
  await assert.rejects(run({ args: ['--yes'], gh, log: () => {}, repo: 'o/r' }), /Unknown argument/);
  assert.equal(calls.length, 0);
});

// --- Workflows around the rulesets ------------------------------------------------------------

test('ruleset drift workflow is a plain scheduled + manual run of the apply script in dry-run', () => {
  const wf = workflow('ruleset-drift.yml');
  assert.match(wf, /^\s+schedule:\n\s+- cron:/m);
  assert.match(wf, /^\s+workflow_dispatch:/m);
  assert.match(wf, /apply-rulesets\.mjs --dry-run/);
  assert.doesNotMatch(wf, /--apply\b[^\n]*"\$REPO"|apply-rulesets\.mjs --apply "/);
  assert.match(wf, /RULESETS_READ_TOKEN/);
  assert.match(wf, /^permissions:\n\s+contents: read$/m);
  assert.doesNotMatch(wf, /pull_request/);
});

test('CodeRabbit label workflow is pull_request_target-safe and labels integration PRs into main', () => {
  const wf = workflow('coderabbit-label.yml');
  assert.match(wf, /pull_request_target:\n\s+branches: \[main\]/);
  assert.match(wf, /startsWith\(github\.event\.pull_request\.head\.ref, 'integration\/'\)/);
  assert.match(wf, /head\.repo\.full_name == github\.repository/);
  assert.match(wf, /action != 'edited' \|\| github\.event\.changes\.base != null/, 'a title edit never re-adds a removed label');
  assert.match(wf, /^permissions: \{\}$/m);
  assert.match(wf, /permissions:\n\s+pull-requests: write\n/);
  assert.doesNotMatch(wf, /actions\/checkout|github\.event\.pull_request\.head\.(sha|ref)\s*\}\}/, 'never checks out or runs PR code');
  assert.doesNotMatch(wf, /\$\{\{ *github\.(head_ref|event\.pull_request\.(title|body|head\.ref)) *\}\}/, 'no untrusted text in a script');
  assert.match(wf, /coderabbit-review/);
  // The label it adds is one .coderabbit.yaml opts in on.
  assert.match(readFileSync(new URL('../../.coderabbit.yaml', import.meta.url), 'utf8'), /- 'coderabbit-review'/);
});
