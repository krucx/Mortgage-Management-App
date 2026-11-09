# Contributing

Every change targeting `main` goes through a pull request. A human with merge
permission owns the merge decision; automated review is advisory and cannot approve
or merge a pull request.

## Change and review flow

1. Start from an up-to-date `main` and create a focused branch, for example
   `fix/restore-backup-message` or `docs/release-checklist`.
2. Make the change and run the checks that apply. The pull request CI runs the
   repository checks described in [README.md](README.md#tests-and-type-checks).
3. Open a pull request targeting `main`. Explain the user-visible change, verification,
   and any risk or migration impact. Link the issue and use a draft while work is
   unfinished.
4. Wait for the required checks and the automated CodeRabbit review. Read the summary
   and every finding.
   Fix actionable findings in a follow-up commit. If a finding is incorrect or does not
   apply, reply on the pull request with the reason so the human reviewer can assess
   that disposition.
5. A human reviewer checks the diff, CI, automated findings and their dispositions,
   then records an approving review. The author should not approve their own change.
   Resolve conversations and wait for required checks before the human merges.
6. Merge with the repository's configured merge method. Do not push commits directly
   to `main`.

### Maintainer override

A repository maintainer may use GitHub's **bypass rules** option on a pull request to
merge without satisfying the ruleset's checks or approval requirements. Use this only
when intentionally overriding those gates, and record the reason in the pull request.
The active ruleset grants this to the `maintain` repository role. The bypass is available
only for PR merges; direct pushes to `main` remain blocked. The repository's existing
branch protection also lets repository admins bypass its checks; this ruleset bypass
extends the PR-only override to maintainers.

### Emergency changes

An emergency still uses a pull request targeting `main`. Mark it clearly as an
emergency, state the impact and why the normal turnaround is too slow, run the fastest
relevant checks, and request an available human reviewer. The reviewer records an
approval before merging. A maintainer may use the override above when urgent
circumstances require merging without all checks or approval; record the reason in the
pull request. Follow up immediately with the remaining checks, documentation, and
release notes. Keep the change in a pull request.

### Automated reviewer unavailable

If CodeRabbit is unavailable, record that on the pull request and ask a human reviewer
to inspect the full diff and explicitly cover the automated review in their review.
If the CodeRabbit status check is required and cannot complete, a maintainer may use the
documented bypass for that PR, recording the reason. Resume automated review on later
pull requests.

## Repository configuration

CodeRabbit is selected because its Open Source plan is free for public repositories.
The checked-in [`.coderabbit.yaml`](.coderabbit.yaml) configures review guidance; a
repository owner must install the CodeRabbit GitHub App for this repository and enable
reviews on pull requests. This app integration cannot be enabled by a repository file.
If the repository becomes private or the free plan changes, disable this integration
and choose a no-cost reviewer before relying on it.

The ruleset template requires the `CodeRabbit` status check along with CI. Install the
app and confirm its exact check name on a reviewed pull request before importing the
template; if GitHub shows a different name, replace `CodeRabbit` in the template with
that exact name. Until the app is installed and the ruleset activated, automated review
is not enforced. Automated findings never count as approval.

The importable [main ruleset](.github/rulesets/main.json) targets `main`, allows the
`maintain` role to bypass its rules on pull requests, and requires a pull request, one
human approval, and these status checks: `backend`, `frontend`, `image`, `windows`,
`Analyze (actions)`, `Analyze (javascript-typescript)`, `Analyze (python)`, and
`CodeRabbit`. These are the exact check names GitHub reports. The ruleset blocks force
pushes and deletion. A repository administrator should import and activate it under
Settings → Rules → Rulesets. GitHub Free supports branch protection and rulesets for public repositories;
private repository availability depends on the repository plan. If rulesets are not
available, configure equivalent branch protection for `main` manually.

See the [release checklist](Documentation/RELEASE_CHECKLIST.md) when preparing a
release.
