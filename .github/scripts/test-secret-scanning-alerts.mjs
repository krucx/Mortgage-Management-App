import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alertFinding,
  reconcileSecretScanningAlerts,
} from './secret-scanning-alerts.mjs';

function fakeGitHub({ alerts = [], existing = [] } = {}) {
  const issues = existing.map((issue) => ({ ...issue }));
  const calls = [];
  return {
    calls,
    issues,
    alerts: async () => alerts,
    async listIssues() { return issues; },
    async locations() { return []; },
    async createIssue(input) {
      calls.push(['create', input]);
      const issue = { ...input, number: issues.length + 1, state: 'open' };
      issues.push(issue);
      return issue;
    },
    async updateIssue(number, input) {
      calls.push(['update', number, input]);
      const issue = issues.find((candidate) => candidate.number === number);
      Object.assign(issue, input);
      return issue;
    },
  };
}

const alert = (overrides = {}) => ({
  number: 17,
  state: 'open',
  secret_type: 'generic_api_key',
  secret_type_display_name: 'Generic API Key',
  html_url: 'https://github.com/acme/app/security/secret-scanning/17',
  created_at: '2026-11-01T12:00:00Z',
  updated_at: '2026-11-02T12:00:00Z',
  locations: [{ details: { path: 'backend/settings.py', start_line: 24, end_line: 24 } }],
  secret: 'never-put-this-in-an-issue',
  ...overrides,
});

test('maps alert metadata and location without carrying the exposed secret', () => {
  const finding = alertFinding(alert());
  assert.equal(finding.number, 17);
  assert.equal(finding.type, 'Generic API Key');
  assert.equal(finding.location, 'backend/settings.py:24');
  assert.equal(finding.url, 'https://github.com/acme/app/security/secret-scanning/17');
  assert.equal(JSON.stringify(finding).includes('never-put-this-in-an-issue'), false);
});

test('creates an actionable issue for each open alert', async () => {
  const github = fakeGitHub({ alerts: [alert()] });
  await reconcileSecretScanningAlerts(github);

  assert.equal(github.issues.length, 1);
  assert.match(github.issues[0].title, /Generic API Key/);
  assert.match(github.issues[0].body, /backend\/settings\.py:24/);
  assert.match(github.issues[0].body, /Rotate or revoke the exposed credential/);
  assert.match(github.issues[0].body, /security\/secret-scanning\/17/);
  assert.equal(github.issues[0].body.includes('never-put-this-in-an-issue'), false);
});

test('updates an existing issue and creates no duplicate on reruns', async () => {
  const github = fakeGitHub({ alerts: [alert()] });
  await reconcileSecretScanningAlerts(github);
  await reconcileSecretScanningAlerts(github, {
    ...github,
    alerts: async () => [alert({ updated_at: '2026-11-03T12:00:00Z' })],
  });

  assert.equal(github.issues.length, 1);
  assert.equal(github.calls.filter(([operation]) => operation === 'create').length, 1);
  assert.equal(github.calls.filter(([operation]) => operation === 'update').length, 1);
});

test('closes issues for resolved alerts and reopens them if an alert reopens', async () => {
  const github = fakeGitHub({ alerts: [alert()] });
  await reconcileSecretScanningAlerts(github);
  github.alerts = async () => [alert({ state: 'resolved', resolution: 'revoked' })];
  await reconcileSecretScanningAlerts(github);
  assert.equal(github.issues[0].state, 'closed');

  github.alerts = async () => [alert()];
  await reconcileSecretScanningAlerts(github);
  assert.equal(github.issues.length, 1);
  assert.equal(github.issues[0].state, 'open');
});

test('closes a resolved alert even when GitHub cannot return its location', async () => {
  const github = fakeGitHub({ alerts: [alert()] });
  await reconcileSecretScanningAlerts(github);
  github.alerts = async () => [alert({ state: 'resolved', resolution: 'revoked', locations: undefined })];
  github.locations = async () => { throw new Error('location unavailable'); };

  await reconcileSecretScanningAlerts(github, { log: () => {} });
  assert.equal(github.issues[0].state, 'closed');
});

test('keeps reconciling other alerts when one issue write fails', async () => {
  const github = fakeGitHub({ alerts: [alert(), alert({ number: 18 })] });
  github.createIssue = async (input) => {
    if (input.title.includes('#17')) throw new Error('issue write failed');
    const issue = { ...input, number: github.issues.length + 1, state: 'open' };
    github.issues.push(issue);
    return issue;
  };

  await assert.doesNotReject(reconcileSecretScanningAlerts(github, { log: () => {} }));
  assert.equal(github.issues.length, 1);
  assert.match(github.issues[0].title, /#18/);
});

test('runs daily and manually with the documented fine-grained token', async () => {
  const workflow = await (await import('node:fs/promises')).readFile(
    new URL('../workflows/secret-scanning-alerts.yml', import.meta.url), 'utf8',
  );
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /SECRET_SCANNING_TOKEN:\s*\$\{\{ secrets\.SECRET_SCANNING_TOKEN \}\}/);
  assert.match(workflow, /node \.github\/scripts\/secret-scanning-alerts\.mjs/);
});
