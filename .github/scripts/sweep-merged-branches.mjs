import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createGitHubClient } from './lib/github-client.mjs';
import { deleteRefApi, refShaApi, sweepMergedBranches } from './lib/branch-cleanup.mjs';

// Run by sweep-merged-branches.yml: deletes the head branches of PRs merged at least 7 days ago
// (--dry-run only lists them). Logic and tests: lib/branch-cleanup.mjs, test-branch-cleanup.mjs.
async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY are required.');
  const { request, getAllPages } = createGitHubClient(token, repository);
  await sweepMergedBranches({
    repository,
    listClosedPulls: () => getAllPages('/pulls?state=closed&per_page=100'),
    listOpenPulls: () => getAllPages('/pulls?state=open&per_page=100'),
    deleteRef: deleteRefApi(request),
    refSha: refShaApi(request),
    dryRun: process.argv.includes('--dry-run'),
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
