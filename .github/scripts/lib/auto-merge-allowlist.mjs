// The one place that says which pull requests may auto-merge. The workflow plumbing
// (.github/workflows/auto-merge.yml, .github/scripts/auto-merge.mjs) never changes when a
// case is added: add a rule to RULES and a test to test-auto-merge-allowlist.mjs.
//
// A rule gets the pull request payload and an `api` that lists the PR's commits, files and checks
// (fetched only when a rule asks). It returns { enable, reason } to decide, or null to stay silent; an
// enabling rule may also name the merge `method` (default SQUASH) and pin `expectedHeadOid`, the only
// commit GitHub may merge. Rules only run on open, non-draft PRs. A PR no rule accepts is left alone:
// the owner reviews it and presses merge.

import { isCriticalPath } from './critical-paths.mjs';
import { judgeUpdates } from './dependabot-metadata.mjs';
import { judgeReleaseCandidate } from './release-conditions.mjs';

const DEPENDABOT = 'dependabot[bot]';

// Dependabot into main: patch and minor only, never a major anywhere in a grouped PR, never a
// critical path (so every GitHub Actions bump, which edits .github/workflows/, stays manual).
// Auto-merge itself still waits for every required check.
async function dependabotRule(pr, api) {
  if (pr.user?.login !== DEPENDABOT || !pr.head?.ref?.startsWith('dependabot/') || pr.base?.ref !== 'main') return null;

  const commits = await api.listCommits();
  // A human commit on Dependabot's branch is unreviewed code, whatever the metadata says.
  if (!commits.length || commits.some((commit) => commit.author?.login !== DEPENDABOT)) {
    return { enable: false, reason: 'dependabot-branch-edited' };
  }
  const verdict = judgeUpdates(commits.map((commit) => commit.commit?.message));
  if (!verdict.safe) return { enable: false, reason: verdict.reason };

  const files = await api.listFiles();
  const critical = files.flatMap((f) => [f.filename, f.previous_filename]).filter(Boolean).find(isCriticalPath);
  if (critical) return { enable: false, reason: `dependabot-critical-path (${critical})` };

  return { enable: true, reason: 'dependabot-patch-minor' };
}

// The release PR into main: merged with no human step, but only by the Prepare release candidate
// workflow (it alone knows the commit it pushed and preflighted, api.releaseCandidate.expectedHeadSha,
// and it starts the publish flow afterwards, which a GITHUB_TOKEN merge does not trigger), and only
// when every machine condition in release-conditions.mjs holds. A merge commit keeps the validated
// candidate commit, and its tree, on main.
async function releaseRule(pr, api) {
  if (!pr.head?.ref?.startsWith('release/') || pr.base?.ref !== 'main') return null;
  const expectedHeadSha = api?.releaseCandidate?.expectedHeadSha;
  if (!expectedHeadSha) return { enable: false, reason: 'release-merged-only-by-the-candidate-workflow' };
  const headSha = pr.head.sha;
  if (String(headSha ?? '').toLowerCase() !== String(expectedHeadSha).toLowerCase()) {
    return { enable: false, reason: `release-head-moved (${headSha} is not the pushed candidate ${expectedHeadSha})` };
  }
  const [files, checks, requiredChecks, preflightRuns] = await Promise.all([
    api.listFiles(), api.listChecks(headSha), api.requiredChecks(), api.listPreflightRuns(headSha),
  ]);
  const version = pr.head.ref.slice('release/'.length);
  const verdict = judgeReleaseCandidate({ pullRequest: pr, version, files, checks, requiredChecks, preflightRuns });
  if (!verdict.ok) return { enable: false, reason: `release-not-a-validated-version-upgrade (${verdict.reason})` };
  return { enable: true, method: 'MERGE', reason: 'release-candidate', expectedHeadOid: headSha };
}

const RULES = [
  // Worker PRs into an integration branch; the integration -> main PR is the human review.
  async (pr) => (/^integration\/.+/.test(pr.base?.ref ?? '') ? { enable: true, reason: 'integration-base' } : null),
  dependabotRule,
  releaseRule,
];

export async function autoMergeDecision(pr, api) {
  if (!pr || pr.state !== 'open') return { enable: false, reason: 'not-open' };
  if (pr.draft) return { enable: false, reason: 'draft' };
  for (const rule of RULES) {
    const decision = await rule(pr, api);
    if (decision?.enable) {
      const { method = 'SQUASH', reason, expectedHeadOid } = decision;
      return { enable: true, method, reason, ...(expectedHeadOid ? { expectedHeadOid } : {}) };
    }
    if (decision) return decision;
  }
  return { enable: false, reason: 'not-allowlisted' };
}
