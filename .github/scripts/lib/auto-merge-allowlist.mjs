// The one place that says which pull requests may auto-merge. The workflow plumbing
// (.github/workflows/auto-merge.yml, .github/scripts/auto-merge.mjs) never changes when a
// case is added: add a rule to RULES and a test to test-auto-merge-allowlist.mjs.
//
// A rule gets the pull request payload and returns a reason string when the PR may
// auto-merge, or null to stay silent. Rules only run on open, non-draft PRs. A PR no rule
// accepts is left alone: the owner reviews it and presses merge.

const RULES = [
  // Worker PRs into an integration branch; the integration -> main PR is the human review.
  { reason: 'integration-base', matches: (pr) => /^integration\/.+/.test(pr.base?.ref ?? '') },
];

export function autoMergeDecision(pr) {
  if (!pr || pr.state !== 'open') return { enable: false, reason: 'not-open' };
  if (pr.draft) return { enable: false, reason: 'draft' };
  const rule = RULES.find((candidate) => candidate.matches(pr));
  if (!rule) return { enable: false, reason: 'not-allowlisted' };
  return { enable: true, method: 'SQUASH', reason: rule.reason };
}
