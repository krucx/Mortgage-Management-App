// Deleting a merged pull request's head branch. The repository's "Automatically delete head
// branches" setting only fires for merges a person makes; a merge made with GITHUB_TOKEN (the
// central auto-merge, the release candidate workflow) leaves the branch behind, and starts no
// pull_request closed workflow either. So a weekly sweep (sweepMergedBranches, below) deletes them.
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

export const deleteRefApi = (request) => (ref) =>
  request(refPath('refs', ref), 'DELETE');

export const refExistsApi = (request) => async (ref) => {
  try {
    await request(refPath('ref', ref));
    return true;
  } catch (error) {
    if (alreadyGone(error)) return false;
    throw error;
  }
};

// GET is /git/ref/heads/<branch>, DELETE is /git/refs/heads/<branch>.
const refPath = (kind, ref) => `/git/${kind}/heads/${ref.split('/').map(encodeURIComponent).join('/')}`;

// The weekly sweep. The repository setting "Automatically delete head branches" ignores merges made
// with GITHUB_TOKEN (auto-merge, the release candidate workflow), which leave their head branch
// behind. This runs every PR merged at least `minAgeDays` days ago through the same decision and
// deletion as above, once per branch, so nothing merged this week is touched. A branch an open PR
// still uses as its head or base stays, whatever merged from it. With `dryRun` it only reports the
// branches that still exist and would be deleted.
export async function sweepMergedBranches({
  repository, listClosedPulls, listOpenPulls, deleteRef, refExists, dryRun = false,
  log = console.log, now = () => Date.now(), minAgeDays = 7,
}) {
  const cutoff = now() - minAgeDays * 86_400_000;
  const inUse = new Set((await listOpenPulls()).flatMap((pr) => [pr.head?.ref, pr.base?.ref]));
  const seen = new Set();
  const results = [];
  for (const pr of await listClosedPulls()) {
    // The list payload has merged_at, not the boolean `merged` of a single PR.
    if (!pr.merged_at || Date.parse(pr.merged_at) > cutoff) continue;
    const ref = pr.head?.ref;
    // Once per branch, but only a PR the rules accept counts: an earlier PR that must keep the branch
    // (an integration branch merged elsewhere) must not hide a later one that ends it.
    if (seen.has(ref) || !branchDeletionDecision({ ...pr, merged: true }, repository).delete) continue;
    seen.add(ref);
    if (inUse.has(ref)) {
      log(`PR #${pr.number}: head branch ${ref} kept (an open PR uses it).`);
      continue;
    }
    if (dryRun) {
      if (await refExists(ref)) {
        log(`PR #${pr.number}: would delete branch ${ref}.`);
        results.push({ delete: true, ref, reason: 'merged', deleted: false, dryRun: true });
      }
      continue;
    }
    results.push(await deleteMergedBranch({ ...pr, merged: true }, { repository, deleteRef, log }));
  }
  const acted = results.filter((r) => r.deleted || r.dryRun).length;
  log(`Sweep ${dryRun ? '(dry run) would delete' : 'deleted'} ${acted} branch${acted === 1 ? '' : 'es'}.`);
  log(`Sweep ${dryRun ? 'dry run' : 'done'}: ${results.filter((r) => r.dryRun || r.deleted).length} branch(es) ${dryRun ? 'would be deleted' : 'deleted'}.`);
  return results;
}
