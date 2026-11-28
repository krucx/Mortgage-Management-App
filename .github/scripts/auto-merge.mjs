import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createGitHubClient } from './lib/github-client.mjs';
import { autoMergeDecision } from './lib/auto-merge-allowlist.mjs';
import { deleteAfterAutoMerge, deleteMergedBranch, deleteRefApi } from './lib/branch-cleanup.mjs';
import { preflightRunsPath, requiredCheckNames } from './lib/release-conditions.mjs';

const ENABLE = `mutation($id: ID!, $method: PullRequestMergeMethod!) {
  enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: $method }) { clientMutationId }
}`;
// Pinned: GitHub merges only while the head is still this commit.
const ENABLE_PINNED = `mutation($id: ID!, $method: PullRequestMergeMethod!, $head: GitObjectID!) {
  enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: $method, expectedHeadOid: $head }) { clientMutationId }
}`;
const MERGE_PINNED = `mutation($id: ID!, $method: PullRequestMergeMethod!, $head: GitObjectID!) {
  mergePullRequest(input: { pullRequestId: $id, mergeMethod: $method, expectedHeadOid: $head }) { clientMutationId }
}`;
const DISABLE = `mutation($id: ID!) {
  disablePullRequestAutoMerge(input: { pullRequestId: $id }) { clientMutationId }
}`;

export async function applyAutoMerge(pr, graphql, { log = console.log, api } = {}) {
  const decision = await autoMergeDecision(pr, api);
  if (!decision.enable) {
    log(`PR #${pr?.number}: auto-merge not enabled (${decision.reason}).`);
    return decision;
  }
  const head = decision.expectedHeadOid;
  try {
    if (head) await graphql(ENABLE_PINNED, { id: pr.node_id, method: decision.method, head });
    else await graphql(ENABLE, { id: pr.node_id, method: decision.method });
  } catch (error) {
    // GitHub refuses (UNPROCESSABLE) when the base branch has no required checks to wait for, or
    // the PR is not in a mergeable status. Warn so it shows on the run, but do not fail the PR.
    if (!String(error.message).includes('UNPROCESSABLE')) throw error;
    // "Clean status": every requirement is already met, so there is nothing to wait for. Only a
    // pinned PR is merged at once, and only at that commit; any other PR keeps the warning.
    if (head && /clean status/i.test(error.message)) {
      await graphql(MERGE_PINNED, { id: pr.node_id, method: decision.method, head });
      log(`PR #${pr.number}: already mergeable, merged (${decision.method}) at ${head} (${decision.reason}).`);
      return { ...decision, enabled: false, merged: true };
    }
    log(`::warning::PR #${pr.number}: GitHub refused auto-merge (${error.message}). Does the base branch require status checks?`);
    return { ...decision, enabled: false };
  }
  log(`PR #${pr.number}: auto-merge (${decision.method}) enabled (${decision.reason}).`);
  return { ...decision, enabled: true };
}

// Called by the Prepare release candidate workflow right after it opens the release PR: the
// allowlist's release case decides, GitHub merges, and this waits for the merge so the workflow
// can start the publish flow (a GITHUB_TOKEN merge triggers no pull_request workflow). Checks still
// running are waited for; if GitHub has not merged within the timeout, auto-merge is turned off
// again so nothing merges unwatched.
export async function mergeReleaseCandidate({
  pullRequest, expectedHeadSha, api, graphql, getPullRequest,
  timeoutMs = 10 * 60_000, pollIntervalMs = 15_000,
  now = () => Date.now(), sleep = (ms) => new Promise((done) => setTimeout(done, ms)), log = console.log,
}) {
  const releaseApi = { ...api, releaseCandidate: { expectedHeadSha } };
  const started = now();
  // A check that is only still running (one GitHub created with the PR, say) is waited for; any
  // other refusal stops at once.
  let pr = pullRequest;
  for (;;) {
    const verdict = await autoMergeDecision(pr, releaseApi);
    if (verdict.enable || !verdict.waiting || now() - started >= timeoutMs) break;
    log(`Release PR #${pr.number}: waiting (${verdict.reason}).`);
    await sleep(pollIntervalMs);
    pr = await getPullRequest();
  }
  const decision = await applyAutoMerge(pr, graphql, { log, api: releaseApi });
  if (!decision.enable) throw new Error(`Release PR #${pullRequest.number} not merged: ${decision.reason}`);
  if (!decision.enabled && !decision.merged) throw new Error(`Release PR #${pullRequest.number} not merged: GitHub refused auto-merge`);
  for (;;) {
    const current = await getPullRequest();
    if (current.merged) {
      return { pullRequest: current.number, mergeCommit: current.merge_commit_sha, headCommit: current.head?.sha };
    }
    if (current.state !== 'open' || now() - started >= timeoutMs) {
      if (current.state === 'open') {
        // GitHub may merge between the last look and this call; then it fails, and the look below wins.
        await graphql(DISABLE, { id: pullRequest.node_id }).catch((error) => log(`::warning::Could not turn auto-merge off: ${error.message}`));
        const last = await getPullRequest();
        if (last.merged) return { pullRequest: last.number, mergeCommit: last.merge_commit_sha, headCommit: last.head?.sha };
      }
      // "behind": main moved during the preflight, and main requires an up-to-date branch.
      throw new Error(`Release PR #${pullRequest.number} did not merge within ${Math.round(timeoutMs / 60_000)} minutes (state ${current.state}, mergeable state ${current.mergeable_state ?? 'unknown'}); auto-merge turned off.`);
    }
    await sleep(pollIntervalMs);
  }
}

function createGraphql(token, repository) {
  const { request } = createGitHubClient(token, repository);
  return async (query, variables) => {
    const { data } = await request('https://api.github.com/graphql', 'POST', { query, variables });
    if (data.errors) throw new Error(`GitHub GraphQL failed: ${JSON.stringify(data.errors)}`);
    return data.data;
  };
}

export function createPrApi(token, repository, number) {
  const { getAllPages, request } = createGitHubClient(token, repository);
  return {
    listCommits: () => getAllPages(`/pulls/${number}/commits?per_page=100`),
    listFiles: () => getAllPages(`/pulls/${number}/files?per_page=100`),
    // Check runs (latest per name) and commit statuses reported for the commit.
    async listChecks(sha) {
      const runs = [];
      for (let next = `/commits/${sha}/check-runs?per_page=100`; next;) {
        const page = await request(next);
        runs.push(...page.data.check_runs);
        next = page.next;
      }
      const { data: combined } = await request(`/commits/${sha}/status?per_page=100`);
      return [...runs, ...combined.statuses];
    },
    // The status-check names main's rulesets require, as GitHub enforces them now.
    requiredChecks: async () => requiredCheckNames(await getAllPages('/rules/branches/main?per_page=100')),
    // Dispatched Tests runs at this commit: the release candidate preflight.
    async listPreflightRuns(sha) {
      const { data } = await request(preflightRunsPath(sha));
      return data.workflow_runs;
    },
  };
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY are required.');
  // auto-merge.mjs release --pr-number N --expected-head SHA: the candidate workflow's call.
  if (process.argv[2] === 'release') {
    const number = Number(option('--pr-number'));
    const expectedHeadSha = option('--expected-head');
    if (!Number.isInteger(number) || !/^[0-9a-f]{40}$/i.test(expectedHeadSha ?? '')) {
      throw new Error('Usage: auto-merge.mjs release --pr-number <number> --expected-head <sha>');
    }
    const { request } = createGitHubClient(token, repository);
    const getPullRequest = async () => (await request(`/pulls/${number}`)).data;
    const result = await mergeReleaseCandidate({
      pullRequest: await getPullRequest(),
      expectedHeadSha,
      api: createPrApi(token, repository, number),
      graphql: createGraphql(token, repository),
      getPullRequest,
      log: (line) => console.error(line),
    });
    // The merge is done and published from here; a branch that cannot be deleted only warns.
    await deleteMergedBranch(await getPullRequest(), { repository, deleteRef: deleteRefApi(request), log: (line) => console.error(line) });
    console.log(JSON.stringify(result));
    return;
  }
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH is required.');
  const { pull_request: pr } = JSON.parse(readFileSync(eventPath, 'utf8'));
  const result = await applyAutoMerge(pr, createGraphql(token, repository), { api: createPrApi(token, repository, pr.number) });
  if (!result.enabled && !result.merged) return;
  // GitHub merges once the required checks pass, with no pull_request closed event for a GITHUB_TOKEN
  // merge, and the repository's delete-head-branch setting ignores it: wait for the merge, then delete.
  const { request } = createGitHubClient(token, repository);
  await deleteAfterAutoMerge(pr.number, {
    repository,
    getPullRequest: async (number) => (await request(`/pulls/${number}`)).data,
    deleteRef: deleteRefApi(request),
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
