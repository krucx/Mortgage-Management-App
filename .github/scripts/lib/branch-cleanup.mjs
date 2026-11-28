// Deleting a merged pull request's head branch. The repository's "Automatically delete head
// branches" setting only fires for merges a person makes; a merge made with GITHUB_TOKEN (the
// central auto-merge, the release candidate workflow) leaves the branch behind, and starts no
// pull_request closed workflow either. So the workflows that merge call this themselves.
//
// The decision is pure (branchDeletionDecision); the API is injected so tests need no network.

const DEFAULT_BRANCH = 'main';

export function branchDeletionDecision(pr, repository) {
  if (!pr?.merged) return { delete: false, reason: 'not-merged' };
  const ref = pr.head?.ref;
  if (!ref) return { delete: false, reason: 'no-head-branch' };
  if (pr.head?.repo?.full_name !== repository) return { delete: false, reason: 'head-not-in-this-repository' };
  if (ref === DEFAULT_BRANCH) return { delete: false, reason: 'default-branch' };
  // An integration branch is a long-lived line of work: only its own merge into main ends it.
  if (ref.startsWith('integration/') && pr.base?.ref !== DEFAULT_BRANCH) return { delete: false, reason: 'integration-branch-not-merged-into-main' };
  return { delete: true, ref, reason: 'merged' };
}

// GitHub answers 422 "Reference does not exist" (404 on some paths) for a branch that is already gone.
const alreadyGone = (error) => /\(404\)|Reference does not exist/.test(String(error?.message));

// Never throws: a failed deletion must not fail a merge that already happened.
export async function deleteMergedBranch(pr, { repository, deleteRef, log = console.log }) {
  const decision = branchDeletionDecision(pr, repository);
  if (!decision.delete) {
    log(`PR #${pr?.number}: head branch kept (${decision.reason}).`);
    return { ...decision, deleted: false };
  }
  try {
    await deleteRef(decision.ref);
  } catch (error) {
    if (alreadyGone(error)) {
      log(`PR #${pr.number}: branch ${decision.ref} is already gone.`);
      return { ...decision, deleted: false, gone: true };
    }
    log(`::warning::PR #${pr.number}: could not delete branch ${decision.ref} (${error.message}).`);
    return { ...decision, deleted: false, failed: true };
  }
  log(`PR #${pr.number}: Deleted branch ${decision.ref}.`);
  return { ...decision, deleted: true };
}

// A PR with auto-merge on is merged by GitHub once its required checks pass. Wait for that
// (bounded), then delete. A PR with no auto-merge pending is the owner's to merge, and GitHub's
// own setting deletes that branch.
export async function deleteAfterAutoMerge(number, {
  repository, getPullRequest, deleteRef, log = console.log,
  timeoutMs = 30 * 60_000, pollIntervalMs = 20_000,
  now = () => Date.now(), sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
}) {
  const started = now();
  let pr = await getPullRequest(number);
  while (!pr.merged && pr.state === 'open' && pr.auto_merge && now() - started < timeoutMs) {
    await sleep(pollIntervalMs);
    pr = await getPullRequest(number);
  }
  return deleteMergedBranch(pr, { repository, deleteRef, log });
}

export const deleteRefApi = (request) => (ref) =>
  request(`/git/refs/heads/${ref.split('/').map(encodeURIComponent).join('/')}`, 'DELETE');
