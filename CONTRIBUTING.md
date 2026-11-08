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
4. Wait for CI and the automated CodeRabbit review. Read the summary and every finding.
   Fix actionable findings in a follow-up commit. If a finding is incorrect or does not
   apply, reply on the pull request with the reason so the human reviewer can assess
   that disposition.
5. A human reviewer checks the diff, CI, automated findings and their dispositions,
   then records an approving review. The author should not approve their own change.
   Resolve conversations and wait for required checks before the human merges.
6. Merge with the repository's configured merge method. Do not push commits directly
   to `main`.

### Emergency changes

An emergency still uses a pull request targeting `main`. Mark it clearly as an
emergency, state the impact and why the normal turnaround is too slow, run the fastest
relevant checks, and request an available human reviewer. The reviewer records an
approval before merging. Follow up immediately with the remaining checks, documentation,
and release notes. Do not bypass the pull request or human approval requirement.

### Automated reviewer unavailable

If CodeRabbit is unavailable, record that on the pull request and ask a human reviewer
to inspect the full diff and explicitly cover the automated review in their review.
The reviewer may approve the documented exception. If the CodeRabbit status check is
required and cannot complete, a repository administrator may temporarily disable only
that check for the affected merge, then restore it; keep CI and human approval required.
Resume automated review on later pull requests; this exception does not waive CI or
human approval.

## Repository configuration

CodeRabbit is selected because its Open Source plan is free for public repositories.
The checked-in [`.coderabbit.yaml`](.coderabbit.yaml) configures review guidance; a
repository owner must install the CodeRabbit GitHub App for this repository and enable
reviews on pull requests. This app integration cannot be enabled by a repository file.
If the repository becomes private or the free plan changes, disable this integration
and choose a no-cost reviewer before relying on it.

After installation, enable the CodeRabbit review/status check as a required check if
the app exposes one to GitHub. Add its exact check name to the `main` ruleset only after
it appears on a pull request; until that check is added, the base ruleset does not enforce
automated review. Automated findings never count as approval.

The importable [main ruleset](.github/rulesets/main.json) targets `main`, requires a
pull request, one human approval, and the backend and frontend CI jobs; it blocks force
pushes and deletion. A repository administrator should import and activate it under
Settings → Rules → Rulesets. Add CodeRabbit's observed check to that ruleset after
integration. GitHub Free supports branch protection and rulesets for public repositories;
private repository availability depends on the repository plan. If rulesets are not
available, configure equivalent branch protection for `main` manually.

See the [release checklist](Documentation/RELEASE_CHECKLIST.md) when preparing a
release.
