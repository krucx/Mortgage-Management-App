import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { autoMergeDecision } from './lib/auto-merge-allowlist.mjs';

const ENABLE = `mutation($id: ID!, $method: PullRequestMergeMethod!) {
  enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: $method }) { clientMutationId }
}`;

export async function applyAutoMerge(pr, graphql, { log = console.log } = {}) {
  const decision = autoMergeDecision(pr);
  if (!decision.enable) {
    log(`PR #${pr?.number}: auto-merge not enabled (${decision.reason}).`);
    return decision;
  }
  await graphql(ENABLE, { id: pr.node_id, method: decision.method });
  log(`PR #${pr.number}: auto-merge (${decision.method}) enabled (${decision.reason}).`);
  return decision;
}

function createGraphql(token) {
  return async (query, variables) => {
    const response = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    const body = await response.json();
    if (!response.ok || body.errors) throw new Error(`GitHub GraphQL failed (${response.status}): ${JSON.stringify(body.errors ?? body)}`);
    return body.data;
  };
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!token || !eventPath) throw new Error('GITHUB_TOKEN and GITHUB_EVENT_PATH are required.');
  const { pull_request: pr } = JSON.parse(readFileSync(eventPath, 'utf8'));
  await applyAutoMerge(pr, createGraphql(token));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
