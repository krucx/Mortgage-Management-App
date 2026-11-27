import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createGitHubClient } from './lib/github-client.mjs';
import { autoMergeDecision } from './lib/auto-merge-allowlist.mjs';

const ENABLE = `mutation($id: ID!, $method: PullRequestMergeMethod!) {
  enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: $method }) { clientMutationId }
}`;

export async function applyAutoMerge(pr, graphql, { log = console.log, api } = {}) {
  const decision = await autoMergeDecision(pr, api);
  if (!decision.enable) {
    log(`PR #${pr?.number}: auto-merge not enabled (${decision.reason}).`);
    return decision;
  }
  try {
    await graphql(ENABLE, { id: pr.node_id, method: decision.method });
  } catch (error) {
    // GitHub refuses (UNPROCESSABLE) when the base branch has no required checks to wait for, or
    // the PR is not in a mergeable status. Warn so it shows on the run, but do not fail the PR.
    if (!String(error.message).includes('UNPROCESSABLE')) throw error;
    log(`::warning::PR #${pr.number}: GitHub refused auto-merge (${error.message}). Does the base branch require status checks?`);
    return { ...decision, enabled: false };
  }
  log(`PR #${pr.number}: auto-merge (${decision.method}) enabled (${decision.reason}).`);
  return { ...decision, enabled: true };
}

function createGraphql(token, repository) {
  const { request } = createGitHubClient(token, repository);
  return async (query, variables) => {
    const { data } = await request('https://api.github.com/graphql', 'POST', { query, variables });
    if (data.errors) throw new Error(`GitHub GraphQL failed: ${JSON.stringify(data.errors)}`);
    return data.data;
  };
}

function createPrApi(token, repository, number) {
  const { getAllPages } = createGitHubClient(token, repository);
  return {
    listCommits: () => getAllPages(`/pulls/${number}/commits?per_page=100`),
    listFiles: () => getAllPages(`/pulls/${number}/files?per_page=100`),
  };
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !eventPath || !repository) throw new Error('GITHUB_TOKEN, GITHUB_EVENT_PATH and GITHUB_REPOSITORY are required.');
  const { pull_request: pr } = JSON.parse(readFileSync(eventPath, 'utf8'));
  await applyAutoMerge(pr, createGraphql(token, repository), { api: createPrApi(token, repository, pr.number) });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
