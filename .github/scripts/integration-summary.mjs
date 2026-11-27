import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGitHubClient } from './lib/github-client.mjs';
import { AREAS, matchesPath } from './lib/critical-paths.mjs';

export const MARKER = '<!-- integration-summary -->';
const BOT = 'github-actions[bot]';
const FILE_LIMIT = 50;

export { AREAS };

export function isIntegrationPr(pr, repository) {
  return pr.base?.ref === 'main' && /^integration\/./.test(pr.head?.ref ?? '') && pr.head?.repo?.full_name === repository;
}

export function ticketRefs(title, body) {
  const closing = [...(body ?? '').matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi)].map((m) => Number(m[1]));
  const found = closing.length ? closing : [...(title ?? '').matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
  return [...new Set(found)];
}

export function uncheckedCriteria(issueBody) {
  const section = (issueBody ?? '').split(/^##\s+Acceptance criteria\s*$/im)[1]?.split(/^##\s/m)[0] ?? '';
  return [...section.matchAll(/^\s*[-*]\s+\[ \]\s+(.+)$/gm)].map((m) => m[1].trim());
}

export function classifyFiles(files) {
  const groups = { money: [], auth: [], migrations: [], security: [], other: [] };
  for (const file of files) {
    let critical = false;
    for (const { key, paths } of AREAS) {
      if (paths.some((p) => matchesPath(file, p))) {
        groups[key].push(file);
        critical = true;
      }
    }
    if (!critical) groups.other.push(file);
  }
  return groups;
}

export function checkStatuses(required, runs) {
  return required.map((name) => {
    const latest = runs
      .filter((run) => run.name === name)
      .sort((a, b) => String(b.completed_at ?? b.started_at ?? '9').localeCompare(String(a.completed_at ?? a.started_at ?? '9')))[0];
    let state = 'missing';
    if (latest) {
      if (latest.status !== 'completed') state = 'pending';
      else state = ['success', 'neutral', 'skipped'].includes(latest.conclusion) ? 'passed' : 'failed';
    }
    return { name, state };
  });
}

const STATE_LABEL = { passed: '✅ passed', failed: '❌ failed', pending: '⏳ pending', missing: '❔ not reported' };

function fileList(files) {
  const lines = files.slice(0, FILE_LIMIT).map((f) => `- \`${f}\``);
  if (files.length > FILE_LIMIT) lines.push(`- …and ${files.length - FILE_LIMIT} more`);
  return lines.join('\n');
}

export function buildSummary({ pr, workerPrs, files, checks, tickets }) {
  const groups = classifyFiles(files);
  const touched = AREAS.filter(({ key }) => groups[key].length);
  const out = [MARKER, '## Integration review summary', ''];

  out.push(touched.length
    ? `> [!WARNING]\n> Touches critical areas: ${touched.map((a) => a.title.toLowerCase()).join(', ')}. Review those files closely.`
    : 'No critical area touched.');

  out.push('', `### Worker pull requests (${workerPrs.length})`);
  if (!workerPrs.length) out.push('No worker pull requests were merged into this branch.');
  for (const worker of workerPrs) {
    const refs = ticketRefs(worker.title, worker.body);
    const linked = refs.map((n) => `closes #${n}${tickets.get(n)?.title ? ` (${tickets.get(n).title})` : ''}`).join(', ');
    out.push(`- #${worker.number} ${worker.title} — ${linked || 'no linked ticket'}`);
  }

  out.push('', `### Files changed (${files.length})`);
  for (const { key, title } of AREAS) {
    if (groups[key].length) out.push('', `### ${title} (${groups[key].length})`, fileList(groups[key]));
  }
  out.push('', `### Other (${groups.other.length})`, groups.other.length ? fileList(groups.other) : 'None.');

  out.push('', '### Required checks');
  if (checks.length) {
    out.push('| Check | Status |', '| --- | --- |', ...checks.map((c) => `| ${c.name} | ${STATE_LABEL[c.state]} |`));
  } else {
    out.push('No required checks configured.');
  }

  out.push('', '### Unticked acceptance criteria');
  const open = [...tickets].filter(([, t]) => t.unchecked.length);
  if (!open.length) out.push('No linked ticket has unticked acceptance criteria.');
  for (const [number, ticket] of open) {
    out.push(`- #${number} ${ticket.title}: ${ticket.unchecked.length} unticked`, ...ticket.unchecked.map((c) => `  - [ ] ${c}`));
  }

  out.push('', '_Updated automatically on every push and when checks finish. Tool-neutral: does not depend on any reviewer._');
  return out.join('\n');
}

export async function upsertSummary(store, body) {
  const existing = (await store.list()).find((comment) => comment.body?.startsWith(MARKER));
  if (existing) await store.update(existing.id, body);
  else await store.create(body);
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY are required.');
  const client = createGitHubClient(token, repository);
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const number = event.pull_request?.number ?? event.workflow_run?.pull_requests?.[0]?.number;
  if (!number) {
    process.stdout.write('No pull request on this event; nothing to do.\n');
    return;
  }
  const pr = (await client.request(`/pulls/${number}`)).data;
  if (!isIntegrationPr(pr, repository)) {
    process.stdout.write(`PR #${number} is not integration/* into main; no comment.\n`);
    return;
  }

  const workerPrs = (await client.getAllPages(`/pulls?state=closed&base=${encodeURIComponent(pr.head.ref)}&per_page=100`))
    .filter((p) => p.merged_at);
  const files = (await client.getAllPages(`/pulls/${number}/files?per_page=100`)).map((f) => f.filename);
  const ruleset = JSON.parse(await readFile('.github/rulesets/main.json', 'utf8'));
  const required = ruleset.rules.find((r) => r.type === 'required_status_checks')?.parameters.required_status_checks.map((c) => c.context) ?? [];
  const runs = (await client.request(`/commits/${pr.head.sha}/check-runs?per_page=100`)).data.check_runs;

  const tickets = new Map();
  for (const worker of workerPrs) {
    for (const ref of ticketRefs(worker.title, worker.body)) {
      if (tickets.has(ref)) continue;
      try {
        const issue = (await client.request(`/issues/${ref}`)).data;
        tickets.set(ref, { title: issue.title, unchecked: uncheckedCriteria(issue.body) });
      } catch (error) {
        process.stderr.write(`Could not read ticket #${ref}: ${error.message}\n`);
      }
    }
  }

  const body = buildSummary({ pr, workerPrs, files, checks: checkStatuses(required, runs), tickets });
  await upsertSummary({
    async list() {
      return (await client.getAllPages(`/issues/${number}/comments?per_page=100`)).filter((c) => c.user?.login === BOT);
    },
    create: (text) => client.request(`/issues/${number}/comments`, 'POST', { body: text }),
    update: (id, text) => client.request(`/issues/comments/${id}`, 'PATCH', { body: text }),
  }, body);
  process.stdout.write(`Summary posted on #${number}.\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
