import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGitHubClient } from './lib/github-client.mjs';
import { reconcileFindings } from './lib/reconciler.mjs';
import {
  fingerprintFor, label as findingLabel, markerFromIssue, normalizeScanner, toFinding,
} from './adapters/critical-finding-support.mjs';
import { codeScanningFinding } from './adapters/codeql.mjs';
import { dependabotFinding } from './adapters/dependabot.mjs';
import { trivyFindingsFromSarif } from './adapters/trivy.mjs';

export { codeScanningFinding, dependabotFinding, fingerprintFor, trivyFindingsFromSarif };

export async function syncCriticalFindings(issueStore, { scope, findings, successful = true }) {
  if (!successful) return;

  const scopePrefix = normalizeScanner(scope);
  const relevantFindings = findings.filter((finding) =>
    normalizeScanner(finding.scanner) === scopePrefix &&
    String(finding.severity).toLowerCase() === 'critical');

  const existingIssues = await issueStore.list();
  const byMarker = new Map(existingIssues.map((issue) => [markerFromIssue(issue), issue]));
  const builtFindings = relevantFindings.map((finding) =>
    toFinding(finding, { existingIssue: byMarker.get(fingerprintFor(finding)) }));

  await reconcileFindings(issueStore, {
    findings: builtFindings,
    markerFromIssue,
    closeUnseen: true,
    matchesScope: (marker) => marker.startsWith(`${scopePrefix}:`),
  });
}

async function currentFindings(client, scope, runUrl) {
  if (scope === 'dependabot') {
    const alerts = await client.getAllPages('/dependabot/alerts?state=open&per_page=100');
    return alerts.map(dependabotFinding);
  }
  const alerts = await client.getAllPages('/code-scanning/alerts?state=open&per_page=100');
  return alerts
    .filter((alert) => normalizeScanner(alert.tool?.name ?? '') === scope)
    .map((alert) => codeScanningFinding(alert, scope === 'codeql' ? 'CodeQL' : 'Trivy', runUrl));
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY are required.');
  const client = createGitHubClient(token, repository);
  await client.ensureLabel({
    name: findingLabel, color: 'b60205', description: 'Critical security finding tracked from scanner results',
  });
  const issueStore = client.issuesLabeled(findingLabel);
  const runUrl = `${process.env.GITHUB_SERVER_URL}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;

  if (process.argv[2] === '--trivy-sarif') {
    if (!['push', 'schedule'].includes(process.env.GITHUB_EVENT_NAME)) {
      throw new Error(`Trivy issues are not reconciled for ${process.env.GITHUB_EVENT_NAME} events.`);
    }
    const sarif = JSON.parse(await (await import('node:fs/promises')).readFile(process.argv[3], 'utf8'));
    const findings = trivyFindingsFromSarif(sarif, runUrl);
    await syncCriticalFindings(issueStore, { scope: 'trivy', findings, successful: true });
    process.stdout.write(`Reconciled ${findings.length} critical Trivy findings from SARIF.\n`);
    return;
  }

  const event = JSON.parse(await (await import('node:fs/promises')).readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  let scope;
  let successful = true;
  if (process.env.GITHUB_EVENT_NAME === 'workflow_run') {
    const { name, conclusion, html_url: runUrl } = event.workflow_run;
    if (name === 'CodeQL') scope = 'codeql';
    else throw new Error(`Unsupported scan workflow: ${name}`);
    successful = conclusion === 'success';
    if (!successful) {
      process.stdout.write(`${name} did not complete successfully; leaving findings unchanged.\n`);
      return;
    }
  } else if (process.env.GITHUB_EVENT_NAME === 'schedule' || process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
    scope = 'dependabot';
  } else {
    throw new Error(`Unsupported event: ${process.env.GITHUB_EVENT_NAME}`);
  }

  const findings = await currentFindings(client, scope, runUrl);
  await syncCriticalFindings(issueStore, { scope, findings, successful });
  process.stdout.write(`Reconciled ${findings.filter((finding) => finding.severity.toLowerCase() === 'critical').length} critical ${scope} findings.\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
