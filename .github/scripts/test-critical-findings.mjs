import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  codeScanningFinding,
  dependabotFinding,
  fingerprintFor,
  syncCriticalFindings,
  trivyFindingsFromSarif,
} from './critical-findings.mjs';

function fakeIssues(existing = []) {
  const issues = existing.map((issue) => ({ ...issue }));
  return {
    issues,
    async list() { return issues; },
    async create(issue) {
      const created = { ...issue, number: issues.length + 1, state: 'open' };
      issues.push(created);
      return created;
    },
    async update(number, changes) {
      const issue = issues.find((candidate) => candidate.number === number);
      Object.assign(issue, changes);
      return issue;
    },
  };
}

const finding = (overrides = {}) => ({
  scanner: 'CodeQL',
  severity: 'critical',
  ruleId: 'py/sql-injection',
  location: 'backend/src/app.py:42',
  summary: 'SQL injection',
  evidence: 'Unsafe query construction',
  remediation: 'Use a parameterized query.',
  latestRunUrl: 'https://github.com/acme/app/actions/runs/12',
  ...overrides,
});

test('uses stable scanner finding IDs when available', () => {
  assert.equal(fingerprintFor(finding({ stableId: 'GHSA-1234' })), 'codeql:GHSA-1234');
});

test('turns a critical code scanning alert into an issue-ready finding', () => {
  const runUrl = 'https://github.com/acme/app/actions/runs/20';
  const finding = codeScanningFinding({
    number: 37,
    html_url: 'https://github.com/acme/app/security/code-scanning/37',
    rule: { id: 'py/sql-injection', security_severity_level: 'critical', help: 'Use a parameterized query.' },
    most_recent_instance: {
      message: { text: 'User input reaches SQL.' },
      location: { path: 'backend/src/app.py', start_line: 42 },
    },
  }, 'CodeQL', runUrl);

  assert.equal(finding.severity, 'critical');
  assert.equal(finding.location, 'backend/src/app.py:42');
  assert.equal(finding.evidence, 'User input reaches SQL.');
  assert.equal(finding.remediation, 'Use a parameterized query.');
  assert.equal(finding.latestRunUrl, runUrl);
  assert.equal(fingerprintFor(finding), 'codeql:37');
});

test('turns a critical Dependabot alert into an issue-ready finding', () => {
  const finding = dependabotFinding({
    number: 81,
    html_url: 'https://github.com/acme/app/security/dependabot/81',
    security_vulnerability: { severity: 'critical', first_patched_version: { identifier: '3.2.1' } },
    security_advisory: { ghsa_id: 'GHSA-abcd', summary: 'Remote code execution' },
    dependency: { package: { name: 'example-lib' }, manifest_path: 'frontend/package-lock.json' },
  });

  assert.equal(finding.scanner, 'Dependabot');
  assert.equal(finding.ruleId, 'GHSA-abcd');
  assert.equal(finding.severity, 'critical');
  assert.equal(finding.location, 'frontend/package-lock.json:example-lib');
  assert.match(finding.remediation, /3\.2\.1/);
  assert.equal(finding.sourceUrl, 'https://github.com/acme/app/security/dependabot/81');
  assert.equal(fingerprintFor(finding), 'dependabot:81');
});

test('reads critical image findings from Trivy SARIF and excludes high findings', () => {
  const runUrl = 'https://github.com/acme/app/actions/runs/24';
  const findings = trivyFindingsFromSarif({
    runs: [{
      tool: { driver: { rules: [
        {
          id: 'CVE-2026-1234',
          shortDescription: { text: 'Example library vulnerability' },
          help: { text: 'Upgrade example-lib to 4.1.' },
          helpUri: 'https://example.com/CVE-2026-1234',
          properties: { tags: ['security', 'CRITICAL'] },
        },
        { id: 'CVE-2026-1235', properties: { tags: ['security', 'HIGH'] } },
      ] } },
      results: [
        {
          ruleId: 'CVE-2026-1234',
          message: { text: 'Package example-lib 4.0 is affected.' },
          partialFingerprints: { trivy: 'stable-id-1234' },
          locations: [{
            physicalLocation: { artifactLocation: { uri: 'debian:bookworm' } },
            message: { text: 'usr/share/example-lib: example-lib@4.0' },
          }],
        },
        { ruleId: 'CVE-2026-1235', message: { text: 'High severity only.' } },
      ],
    }],
  }, runUrl);

  assert.equal(findings.length, 1);
  assert.equal(findings[0].scanner, 'Trivy');
  assert.equal(findings[0].severity, 'critical');
  assert.equal(findings[0].ruleId, 'CVE-2026-1234');
  assert.match(findings[0].location, /example-lib@4\.0/);
  assert.equal(findings[0].evidence, 'Package example-lib 4.0 is affected.');
  assert.equal(findings[0].remediation, 'Upgrade example-lib to 4.1.');
  assert.equal(findings[0].latestRunUrl, runUrl);
  assert.equal(fingerprintFor(findings[0]), 'trivy:CVE-2026-1234:stable-id-1234');
  assert.throws(() => trivyFindingsFromSarif({}, runUrl), /no completed scan runs/);
});

test('normalizes fallback locations and ignores non-critical findings', async () => {
  const first = finding({ location: './backend\\src\\app.py:42:9' });
  const second = finding({ location: 'backend/src/app.py:42:3' });
  assert.equal(fingerprintFor(first), fingerprintFor(second));
  assert.notEqual(
    fingerprintFor(finding({ location: 'src/Foo.py:42' })),
    fingerprintFor(finding({ location: 'src/foo.py:42' })),
  );

  const issues = fakeIssues();
  await syncCriticalFindings(issues, { scope: 'codeql', findings: [finding({ severity: 'high' })] });
  assert.equal(issues.issues.length, 0);
});

test('updates one open issue for a repeated fingerprint', async () => {
  const issues = fakeIssues();
  await syncCriticalFindings(issues, { scope: 'codeql', findings: [finding()] });
  await syncCriticalFindings(issues, { scope: 'codeql', findings: [finding({
    summary: 'Updated SQL injection details', latestRunUrl: 'https://github.com/acme/app/actions/runs/13',
  })] });

  assert.equal(issues.issues.length, 1);
  assert.equal(issues.issues[0].body.includes('Updated SQL injection details'), true);
  assert.equal(issues.issues[0].body.includes('/runs/13'), true);
  for (const expected of ['Severity:** Critical', 'Scanner:** CodeQL', 'py/sql-injection', 'Affected location', 'Evidence', 'Remediation guidance', 'Originating run']) {
    assert.equal(issues.issues[0].body.includes(expected), true, `issue body includes ${expected}`);
  }
});

test('closes absent findings only after a successful complete scan and reopens on recurrence', async () => {
  const issues = fakeIssues();
  await syncCriticalFindings(issues, { scope: 'codeql', findings: [finding()] });
  await syncCriticalFindings(issues, { scope: 'codeql', findings: [], successful: false });
  assert.equal(issues.issues[0].state, 'open');

  await syncCriticalFindings(issues, { scope: 'codeql', findings: [], successful: true });
  assert.equal(issues.issues[0].state, 'closed');

  await syncCriticalFindings(issues, { scope: 'codeql', findings: [finding()], successful: true });
  assert.equal(issues.issues.length, 1);
  assert.equal(issues.issues[0].state, 'open');
});

test('successful reconciliation closes only issues in its scanner scope', async () => {
  const issues = fakeIssues();
  await syncCriticalFindings(issues, { scope: 'codeql', findings: [finding()] });
  await syncCriticalFindings(issues, { scope: 'trivy', findings: [finding({ scanner: 'Trivy', ruleId: 'CVE-1' })] });

  await syncCriticalFindings(issues, { scope: 'codeql', findings: [], successful: true });
  assert.deepEqual(issues.issues.map(({ state }) => state), ['closed', 'open']);
});

test('GitHub Actions reconciles only completed main-branch scanner runs and scheduled Dependabot alerts', async () => {
  const workflow = await readFile(new URL('../workflows/critical-findings.yml', import.meta.url), 'utf8');
  const trivyWorkflow = await readFile(new URL('../workflows/trivy.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflows:\s*\[CodeQL\]/);
  assert.match(workflow, /types:\s*\[completed\]/);
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /issues:\s*write/);
  assert.match(workflow, /security-events:\s*read/);
  assert.match(workflow, /vulnerability-alerts:\s*read/);
  assert.match(workflow, /workflow_run\.head_branch == 'main'/);
  assert.match(workflow, /workflow_run\.event != 'pull_request'/);
  assert.match(workflow, /node \.github\/scripts\/critical-findings\.mjs/);
  assert.match(trivyWorkflow, /issues:\s*write/);
  assert.match(trivyWorkflow, /success\(\)[\s\S]*github\.event_name == 'push'[\s\S]*github\.event_name == 'schedule'/);
  assert.match(trivyWorkflow, /--trivy-sarif trivy-results\.sarif/);
});
