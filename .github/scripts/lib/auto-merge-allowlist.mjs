// The one place that says which pull requests may auto-merge. The workflow plumbing
// (.github/workflows/auto-merge.yml, .github/scripts/auto-merge.mjs) never changes when a
// case is added: add a rule to RULES and a test to test-auto-merge-allowlist.mjs.
//
// A rule gets the pull request payload and an `api` that lists the PR's commits and files (fetched
// only when a rule asks). It returns { enable, reason } to decide, or null to stay silent. Rules only
// run on open, non-draft PRs. A PR no rule accepts is left alone: the owner reviews it and presses merge.

import { isCriticalPath } from './critical-paths.mjs';
import { judgeUpdates } from './dependabot-metadata.mjs';

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

const RULES = [
  // Worker PRs into an integration branch; the integration -> main PR is the human review.
  async (pr) => (/^integration\/.+/.test(pr.base?.ref ?? '') ? { enable: true, reason: 'integration-base' } : null),
  dependabotRule,
];

export async function autoMergeDecision(pr, api) {
  if (!pr || pr.state !== 'open') return { enable: false, reason: 'not-open' };
  if (pr.draft) return { enable: false, reason: 'draft' };
  for (const rule of RULES) {
    const decision = await rule(pr, api);
    if (decision?.enable) return { enable: true, method: 'SQUASH', reason: decision.reason };
    if (decision) return decision;
  }
  return { enable: false, reason: 'not-allowlisted' };
}
