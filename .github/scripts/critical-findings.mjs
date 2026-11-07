import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const findingLabel = 'critical-finding';

function normalizeScanner(scanner) {
  return scanner.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function normalizeLocation(location = '') {
  let value = String(location).replace(/^file:\/\//, '').replaceAll('\\', '/').replace(/^\.\//, '');
  value = value.replace(/:(\d+):\d+$/, ':$1');
  return value.replace(/\/{2,}/g, '/').toLowerCase();
}

export function fingerprintFor(finding) {
  const scanner = normalizeScanner(finding.scanner);
  if (finding.stableId) return `${scanner}:${finding.stableId}`;
  return `${scanner}:${finding.ruleId}:${normalizeLocation(finding.location)}`;
}

function issueBody(finding, fingerprint, originatingRunUrl) {
  const link = (label, url) => url ? `[${label}](${url})` : 'Unavailable';
  return [
    `<!-- critical-finding fingerprint: ${fingerprint} -->`,
    `<!-- critical-finding origin: ${originatingRunUrl ?? 'none'} -->`,
    `## ${finding.summary || finding.ruleId}`,
    '',
    `- **Severity:** Critical`,
    `- **Scanner:** ${finding.scanner}`,
    `- **Rule:** \`${finding.ruleId}\``,
    `- **Affected location:** \`${finding.location || 'Unavailable'}\``,
    `- **Latest run:** ${link('View latest run', finding.latestRunUrl)}`,
    `- **Originating run:** ${link('View originating run', originatingRunUrl)}`,
    ...(finding.sourceUrl ? [`- **Scanner finding:** ${link('View finding', finding.sourceUrl)}`] : []),
    '',
    '### Evidence',
    '',
    finding.evidence || 'The scanner did not provide evidence details.',
    '',
    '### Remediation guidance',
    '',
    finding.remediation || 'Review the linked scanner finding and apply the recommended fix.',
  ].join('\n');
}

function fingerprintFromIssue(issue) {
  return issue.body?.match(/<!-- critical-finding fingerprint: (.*?) -->/)?.[1];
}

function originFromIssue(issue) {
  const origin = issue.body?.match(/<!-- critical-finding origin: (.*?) -->/)?.[1];
  return origin === 'none' ? null : origin;
}

export async function syncCriticalFindings(issues, { scope, findings, successful = true }) {
  if (!successful) return;

  const relevantFindings = findings.filter((finding) =>
    normalizeScanner(finding.scanner) === normalizeScanner(scope) &&
    String(finding.severity).toLowerCase() === 'critical');
  const existingIssues = await issues.list();
  const byFingerprint = new Map(existingIssues.map((issue) => [fingerprintFromIssue(issue), issue]));
  const seen = new Set();

  for (const finding of relevantFindings) {
    const fingerprint = fingerprintFor(finding);
    seen.add(fingerprint);
    const existing = byFingerprint.get(fingerprint);
    const previousOrigin = originFromIssue(existing ?? {});
    const originatingRunUrl = previousOrigin !== undefined
      ? previousOrigin
      : finding.originatingRunUrl === null ? undefined : finding.originatingRunUrl || finding.latestRunUrl;
    const update = {
      title: `[Critical] ${finding.summary || finding.ruleId}`,
      body: issueBody(finding, fingerprint, originatingRunUrl),
      labels: [findingLabel],
      state: 'open',
    };
    if (existing) await issues.update(existing.number, update);
    else byFingerprint.set(fingerprint, await issues.create(update));
  }

  for (const issue of existingIssues) {
    const fingerprint = fingerprintFromIssue(issue);
    if (fingerprint?.startsWith(`${normalizeScanner(scope)}:`) && !seen.has(fingerprint) && issue.state === 'open') {
      await issues.update(issue.number, { state: 'closed' });
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

function createApi(token, repository) {
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
    if (!response.ok) throw new Error(`GitHub API ${method} ${path} failed (${response.status}): ${await response.text()}`);
    const data = response.status === 204 ? undefined : await response.json();
    const link = response.headers.get('link') ?? '';
    const next = link.split(',').find((part) => part.includes('rel="next"'))?.match(/<([^>]+)>/)?.[1];
    return { data, next };
  }

  return {
    request,
    issues: {
      async list() {
        const path = '/issues?state=all&labels=critical-finding&per_page=100';
        return getAllPages({ request }, path);
      },
      async create(issue) {
        return (await request('/issues', 'POST', issue)).data;
      },
      async update(number, changes) {
        return (await request(`/issues/${number}`, 'PATCH', changes)).data;
      },
    },
    async ensureLabel() {
      try {
        await request('/labels/critical-finding');
      } catch (error) {
        if (!String(error).includes('(404)')) throw error;
        await request('/labels', 'POST', { name: findingLabel, color: 'b60205', description: 'Critical security finding tracked from scanner results' });
      }
    },
  };
}

export function codeScanningFinding(alert, scanner, runUrl) {
  const instance = alert.most_recent_instance ?? {};
  const location = instance.location ?? {};
  const rule = alert.rule ?? {};
  return {
    scanner,
    stableId: alert.number === undefined ? undefined : String(alert.number),
    severity: rule.security_severity_level ?? rule.severity ?? '',
    ruleId: rule.id ?? 'unknown-rule',
    location: [location.path, location.start_line].filter(Boolean).join(':'),
    summary: instance.message?.text ?? rule.description ?? rule.name ?? rule.id,
    evidence: instance.message?.text ?? rule.description,
    remediation: rule.help ?? 'Review the scanner finding and apply its recommended fix.',
    latestRunUrl: runUrl,
    originatingRunUrl: runUrl,
    sourceUrl: alert.html_url,
  };
}

export function dependabotFinding(alert) {
  const security = alert.security_vulnerability ?? {};
  const advisory = alert.security_advisory ?? {};
  const dependency = alert.dependency ?? {};
  const packageName = dependency.package?.name ?? 'Unknown package';
  const file = dependency.manifest_path ?? 'Unknown manifest';
  const patched = security.first_patched_version?.identifier;
  return {
    scanner: 'Dependabot',
    stableId: String(alert.number),
    severity: security.severity ?? advisory.severity ?? '',
    ruleId: advisory.ghsa_id ?? `dependabot-alert-${alert.number}`,
    location: `${file}:${packageName}`,
    summary: `${packageName}: ${advisory.summary ?? advisory.description ?? 'Vulnerable dependency'}`,
    evidence: `${packageName} is affected by ${advisory.ghsa_id ?? 'a security advisory'} in ${file}.`,
    remediation: patched ? `Upgrade to version ${patched} or later.` : 'Upgrade to a version that is no longer affected by this advisory.',
    latestRunUrl: null,
    originatingRunUrl: null,
    sourceUrl: alert.html_url,
  };
}

async function currentFindings(api, scope, runUrl) {
  if (scope === 'dependabot') {
    const alerts = await getAllPages(api, '/dependabot/alerts?state=open&per_page=100');
    return alerts.map(dependabotFinding);
  }
  const alerts = await getAllPages(api, '/code-scanning/alerts?state=open&per_page=100');
  return alerts
    .filter((alert) => normalizeScanner(alert.tool?.name ?? '') === scope)
    .map((alert) => codeScanningFinding(alert, scope === 'codeql' ? 'CodeQL' : 'Trivy', runUrl));
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY are required.');
  const event = JSON.parse(await (await import('node:fs/promises')).readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  let scope;
  let successful = true;
  if (process.env.GITHUB_EVENT_NAME === 'workflow_run') {
    const { name, conclusion, html_url: runUrl } = event.workflow_run;
    if (name === 'CodeQL') scope = 'codeql';
    else if (name === 'Container scan') scope = 'trivy';
    else throw new Error(`Unsupported scan workflow: ${name}`);
    successful = conclusion === 'success';
    if (!successful) {
      process.stdout.write(`${name} did not complete successfully; leaving findings unchanged.\n`);
      return;
    }
    process.env.SCAN_RUN_URL = runUrl;
  } else if (process.env.GITHUB_EVENT_NAME === 'schedule' || process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
    scope = 'dependabot';
  } else {
    throw new Error(`Unsupported event: ${process.env.GITHUB_EVENT_NAME}`);
  }

  const api = createApi(token, repository);
  await api.ensureLabel();
  const runUrl = process.env.SCAN_RUN_URL || `${process.env.GITHUB_SERVER_URL}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  const findings = await currentFindings(api, scope, runUrl);
  await syncCriticalFindings(api.issues, { scope, findings, successful });
  process.stdout.write(`Reconciled ${findings.filter((finding) => finding.severity.toLowerCase() === 'critical').length} critical ${scope} findings.\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
