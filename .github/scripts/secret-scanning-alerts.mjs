import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGitHubClient } from './lib/github-client.mjs';
import { reconcileFindings } from './lib/reconciler.mjs';
import { alertFinding, label, markerFromIssue, secretScanningFindings } from './adapters/secret-scanning.mjs';

export { alertFinding };

export async function reconcileSecretScanningAlerts(github, { log = console.warn } = {}) {
  const alerts = await github.alerts();
  const findings = await secretScanningFindings(alerts, { locations: github.locations });
  await reconcileFindings(github.issues, { findings, markerFromIssue, log });
}

export function createGitHub(token, repository) {
  const client = createGitHubClient(token, repository);
  return {
    issues: client.issuesLabeled(label),
    async alerts() {
      const [open, resolved] = await Promise.all([
        client.getAllPages('/secret-scanning/alerts?state=open&per_page=100'),
        client.getAllPages('/secret-scanning/alerts?state=resolved&per_page=100'),
      ]);
      return [...open, ...resolved];
    },
    async locations(url) {
      return client.getAllPages(url);
    },
    async ensureLabel() {
      return client.ensureLabel({ name: label, color: 'b60205', description: 'Open GitHub Secret scanning alerts' });
    },
  };
}

async function main() {
  const token = process.env.SECRET_SCANNING_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) throw new Error('SECRET_SCANNING_TOKEN and GITHUB_REPOSITORY are required.');
  const github = createGitHub(token, repository);
  await github.ensureLabel();
  await reconcileSecretScanningAlerts(github);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
