# Dependabot auto-merge: how update types are read

Rule: `dependabotRule` in `.github/scripts/lib/auto-merge-allowlist.mjs`; parsing in
`.github/scripts/lib/dependabot-metadata.mjs`; tests in `.github/scripts/test-auto-merge-allowlist.mjs`.

## Where the metadata comes from

Verified against real PRs in this repository (#480, #314, #379 grouped or single; #439, #313, #472).

- A Dependabot PR has one commit whose message ends with an `updated-dependencies:` YAML block. This is
  the block the `dependabot/fetch-metadata` action parses; we read it directly so no new action or
  token is needed.
- A **grouped** PR lists **one entry per package**, each with its own `update-type`
  (`version-update:semver-patch|minor|major`). #314 (github-actions group) has two `semver-major`
  entries; #480 (npm group) has two minor and two patch. There is no PR-level type, so the rule checks
  every entry and refuses the PR if any one is major.
- **Gap:** Dependabot omits `update-type` for indirect/ancestor dependencies (#439, #313, #472). For
  those the rule derives the type from the human-readable version lines in the same message
  (`Updates \`x\` from A to B`, or `Bumps [x](url) from A to B.`). The same lines are also checked for
  every entry, so a major shown only there still refuses the PR.
- The rule fails closed: no metadata block, an entry whose type is neither given nor derivable, a
  version that is not plain `x.y.z`, or a commit on the branch not authored by `dependabot[bot]`
  (e.g. #480 and #315 carry an owner commit) leaves the PR for the owner.

## Critical paths

The PR's file list (including a renamed file's previous name) is checked against
`.github/scripts/lib/critical-paths.mjs` (shared with the integration summary and mirrored from
CONTRIBUTING). Every GitHub Actions bump edits `.github/workflows/`, so those PRs are always manual;
npm and uv bumps of non-critical manifests can auto-merge.

## Token

The workflow keeps using `GITHUB_TOKEN` (`contents: write`, `pull-requests: write`). Dependabot-triggered
runs get a restricted token by default; the `permissions:` block is what GitHub's own Dependabot
auto-merge example relies on. If a first real run is refused, the run logs a warning; no PAT or secret
is the fix.
