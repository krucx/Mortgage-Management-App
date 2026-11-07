import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const label = 'secret-scanning-alert';
const marker = (number) => `<!-- secret-scanning-alert: ${number} -->`;

function alertNumberFromIssue(issue) {
  return issue.body?.match(/<!-- secret-scanning-alert: (\d+) -->/)?.[1];
}

export function alertFinding(alert, locations = alert.locations ?? []) {
  const name = alert.secret_type_display_name || alert.secret_type || 'Secret';
  const location = locations.map(({ details = {} }) => {
    const path = details.path;
    if (!path) return undefined;
    const start = details.start_line;
    const end = details.end_line;
    const line = start ? `:${start}${end && end !== start ? `-${end}` : ''}` : '';
    return `${path}${line}`;
  }).filter(Boolean).join(', ') || 'Unavailable';

  // Keep this an allowlist: GitHub's alert payload also contains `secret`.
  return {
    number: Number(alert.number),
    state: alert.state,
    type: name,
    location,
    url: alert.html_url,
    createdAt: alert.created_at,
    updatedAt: alert.updated_at,
    resolution: alert.resolution,
    resolvedAt: alert.resolved_at,
  };
}

function issueFor(finding) {
  const state = finding.state === 'open' ? 'open' : 'closed';
  return {
    title: `[Secret scanning] ${finding.type} (#${finding.number})`,
    body: [
      marker(finding.number),
      '## GitHub Secret scanning alert',
      '',
      `- **Alert:** [#${finding.number}](${finding.url})`,
      `- **Type:** ${finding.type}`,
      `- **State:** ${state}${finding.resolution ? ` (${finding.resolution})` : ''}`,
      `- **Created:** ${finding.createdAt || 'Unavailable'}`,
      `- **Last updated:** ${finding.updatedAt || 'Unavailable'}`,
      `- **Resolved:** ${finding.resolvedAt || 'Not resolved'}`,
      `- **Location:** ${finding.location}`,
      '',
      '### Remediation guidance',
      '',
      'Rotate or revoke the exposed credential, remove it from the affected location, and update any dependent services. Review repository history and follow the provider’s recovery guidance. Do not copy the secret value into this issue.',
    ].join('\n'),
    labels: [label],
    state,
  };
}

export async function reconcileSecretScanningAlerts(github, { log = console.warn } = {}) {
  const [alerts, issues] = await Promise.all([github.alerts(), github.listIssues()]);
  const existingByAlert = new Map(
    issues.map((issue) => [alertNumberFromIssue(issue), issue]).filter(([number]) => number),
  );

  for (const alert of alerts) {
    const existing = existingByAlert.get(String(alert.number));
    try {
      if (alert.state !== 'open') {
        if (existing) await github.updateIssue(existing.number, issueFor(alertFinding(alert, [])));
        continue;
      }
      const locations = alert.locations ?? await github.locations(alert.locations_url);
      const finding = alertFinding(alert, locations);
      const update = issueFor(finding);
      if (existing) await github.updateIssue(existing.number, update);
      else {
        const created = await github.createIssue(update);
        existingByAlert.set(String(finding.number), created);
      }
    } catch {
      log(`Could not reconcile Secret scanning alert #${alert.number}; continuing with remaining alerts.`);
    }
  }
}

async function getAllPages(api, path) {
  const results = [];
  let next = path;
  while (next) {
    const response = await api.request(next);
    if (!Array.isArray(response.data)) throw new Error(`Expected a list from ${next}`);
    results.push(...response.data);
    next = response.next;
  }
  return results;
}

function createGitHub(token, repository) {
  const base = `https://api.github.com/repos/${repository}`;
  async function request(path, method = 'GET', body) {
    const response = await fetch(path.startsWith('https://') ? path : `${base}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`GitHub API ${method} ${path} failed (${response.status})`);
    const data = response.status === 204 ? undefined : await response.json();
    const link = response.headers.get('link') ?? '';
    const next = link.split(',').find((part) => part.includes('rel="next"'))?.match(/<([^>]+)>/)?.[1];
    return { data, next };
  }

  return {
    async alerts() {
      return getAllPages({ request }, '/secret-scanning/alerts?state=all&per_page=100');
    },
    async locations(url) {
      return getAllPages({ request }, url);
    },
    async listIssues() {
      return getAllPages({ request }, `/issues?state=all&labels=${label}&per_page=100`);
    },
    async createIssue(issue) {
      return (await request('/issues', 'POST', issue)).data;
    },
    async updateIssue(number, changes) {
      return (await request(`/issues/${number}`, 'PATCH', changes)).data;
    },
    async ensureLabel() {
      try {
        await request(`/labels/${label}`);
      } catch (error) {
        if (!String(error).includes('(404)')) throw error;
        await request('/labels', 'POST', {
          name: label,
          color: 'b60205',
          description: 'Open GitHub Secret scanning alerts',
        });
      }
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
