# Contributing

Every change targeting `main` goes through a pull request. A human with merge
permission owns the merge decision; automated review is advisory and cannot approve
or merge a pull request.

## Change and review flow

1. Start from an up-to-date `main` and create a focused branch, for example
   `fix/restore-backup-message` or `docs/release-checklist`.
2. Make the change and run the checks that apply. Add or update the scenario in
   `qa/features` that covers what the change does. Run the local QA stack
   (`scripts/qa-stack.sh test`) only with the owner's approval; without it, skip it and say
   so in the pull request. CI runs that suite only for releases. On every pull
   request the `frontend` job checks that each route in `frontend/src/App.tsx` has a scenario
   tagged `@screen:<route>`, or is listed in `qa/screens-to-cover/<issue>.txt` by the ticket
   that will cover it; it fails naming any route that is neither, or the ticket's file to
   delete or edit when a listed route is covered now. Add steps as
   [qa/README.md](qa/README.md) says. The pull request CI runs the repository checks described in
   [README.md](README.md#tests-and-type-checks).
3. Open a pull request targeting `main`. Explain the user-visible change, verification,
   and any risk or migration impact. Link the issue and use a draft while work is
   unfinished.
4. Wait for the required checks. CodeRabbit reviews only some pull requests (see
   [Selective CodeRabbit review](#selective-coderabbit-review)); when it reviews yours, read the summary
   and every finding.
   Fix actionable findings in a follow-up commit. If a finding is incorrect or does not
   apply, reply on the pull request with the reason so the human reviewer can assess
   that disposition.
5. A human reviewer checks the diff, CI, automated findings and their dispositions,
   then records an approving review. The author should not approve their own change.
   The reviewer records the approval themselves: an agent never submits an approving
   review or merges, even when told "yes, merge", and preparing, drafting or
   summarising a review is not approval. The agent opens the pull request and stops.
   Resolve conversations and wait for required checks before the human merges.
6. Merge with the repository's configured merge method. Do not push commits directly
   to `main`.

### Auto-merge

The **Auto-merge** workflow (`.github/workflows/auto-merge.yml`) enables squash auto-merge on exactly the
pull requests the owner has decided never need a human look. The rules are one module,
`.github/scripts/lib/auto-merge-allowlist.mjs`, with tests in `.github/scripts/test-auto-merge-allowlist.mjs`;
add a case by editing those two files, not the workflow.

- An open, non-draft pull request whose base is `integration/**` gets auto-merge (squash). It still waits
  for that branch's required checks.
- A pull request into `main`, a draft, a closed pull request and any other base are left alone. The owner
  reviews each `main` pull request and presses merge; this is a trust rule, so agents must not merge or
  enable auto-merge on them either.

It runs on open, reopen, ready for review and a base-branch change, and uses `GITHUB_TOKEN` with
`contents: write` and `pull-requests: write` (no PAT, bot account or secret). The repository's
"Allow auto-merge" setting must stay on. Pull requests from forks are skipped (read-only token). The job
checks out the base branch, so cut `integration/**` branches from a `main` that already contains the
workflow and script.
GitHub only accepts auto-merge on a branch that requires status checks, so an `integration/**` branch
without that ruleset gets a run warning instead of auto-merge.

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

## Selective CodeRabbit review

CodeRabbit reviews a pull request only when it carries a label from `.coderabbit.yaml`
(`reviews.auto_review.labels`: a positive entry means at least one must be present). It cannot
filter on the head branch, so the label is how a pull request opts in. Do not request a review
(`@coderabbitai review`) outside the cases below, and do not label a pull request to get a
second opinion.

| Pull request | Label | CodeRabbit |
| --- | --- | --- |
| `integration/*` into `main` (a batch of tickets) | `coderabbit-review` | Required: a review must exist before the human merges. |
| A ticket PR whose base is an `integration/*` branch | none | Not reviewed. |
| Any other pull request into `main` | none | Not reviewed. |
| Any other pull request that touches a critical area (below) | `critical` | Reviewed. |

The author adds the label when opening the pull request, because CodeRabbit cannot trigger on paths. A
pull request with no label has no CodeRabbit review; put `@coderabbitai ignore` in its description
so nobody requests one by accident. The owner may also add `critical` to any pull request.

Critical areas. If the diff touches any of these paths, add `critical`:

- **Money math** (interest, balances, payments, allocations, discounts, closing):
  `backend/src/mortgage_backend/lending/`, `backend/src/mortgage_backend/payments/`,
  `backend/src/mortgage_backend/platform/money.py`, `frontend/src/money.ts`,
  `frontend/src/allocate.ts`, `frontend/src/calculator.ts`.
- **Auth / sign-in**: the app has no sign-in. Its access guard is
  `backend/src/mortgage_backend/platform/local_only.py`; changing it, or adding any sign-in, is critical.
- **Data migrations and the database**: `backend/src/mortgage_backend/migrations/`,
  `backend/src/mortgage_backend/platform/db.py`, `backend/src/mortgage_backend/safekeeping/backups.py` (restore).
- **Security**: `platform/local_only.py`, `platform/upload_limit.py`, `platform/photos.py`
  (under `backend/src/mortgage_backend/`), `.github/workflows/`, `.github/rulesets/`, `Dockerfile`,
  `windows/` installer scripts, and any change that handles untrusted input or secrets.

### Integration review summary

The **Integration review summary** workflow (`.github/workflows/integration-summary.yml`) posts one
comment on each `integration/*` -> `main` pull request and edits it in place on later pushes and when
the `Tests` run finishes. It lists the merged worker pull requests with their tickets, the changed files
grouped by the critical areas above (plus "other"), the status of the ruleset's required checks, and any
linked ticket with unticked acceptance criteria. It is tool-neutral and is not posted on any other pull
request. The critical paths are mirrored in `.github/scripts/integration-summary.mjs`; update both together.

`main`'s ruleset requires the `CodeRabbit` check, which CodeRabbit does not report on a pull request it
skips. Those pull requests need a maintainer bypass, recorded on the pull request. The `integration/*` ->
`main` pull request always gets the review, so it merges normally.

## CI

### Reusing validated results by tree

CI does not re-run checks on a tree it has already validated. When a `Tests`, `CodeQL` or
`Container scan` run on a pull request or on `main` finishes, its `record` job writes the git
tree it tested as a commit status on the commit it ran for (the PR head, or the `main` commit):
context `validated-tree/<workflow>`, description `Passed on tree <hash>` (or `Failed on ...`),
linking to the run. These statuses are informational, not required checks. A commit status
was chosen over check-run output because `GITHUB_TOKEN` writes it with `statuses: write`
alone, GitHub lists a commit's statuses newest first (the latest result wins), and a status
can link to any run, including the one a reused run points back to. Pull requests
from forks record nothing, as their token cannot write statuses.

On the `push` to `main` after a merge, each workflow's `reuse` job looks that record up on the
merge commit's parents and on the head of the pull request it merged. When the latest record
there passed on exactly the merged tree, every other job is skipped and the run reports
"Reused result from run <link>". Otherwise (no record, a failed latest run, a different tree
because `main` moved, or a failed lookup) everything runs in full, as before. The logic is
`.github/scripts/tree-reuse.mjs`, unit-tested by `test-tree-reuse.mjs`.

Reuse relies on `main` keeping "require branches to be up to date before merging": then the
merge a pull request tested has the same tree as the merge commit. Do not turn that rule off.
A pull request merged without being up to date (for example with a bypass) simply runs in full.

The weekly CodeQL and daily Container scan schedules always run in full, so new
vulnerabilities are caught; a reused `main` push leaves code-scanning results for `main` to
those schedules. The `image` job and the Container scan build the image from one shared
layer cache (`type=gha`, scope `app-image`), so the same tree is not built from scratch twice.

## Repository configuration

### Keeping CodeRabbit reviews timely

Each push can trigger another review, and large generated files can add substantial
diff context without useful findings. `.coderabbit.yaml` excludes generated artifacts and
lockfiles and keeps incremental reviews enabled. It also uses CodeRabbit's balanced
`chill` profile, which is expected to reduce low-signal, style-level feedback and the time
people spend assessing it. The tradeoff is fewer nitpicky comments. No before-and-after
review timing is available; changed source and configuration files remain in scope, and
the required `CodeRabbit` check is unchanged.

The reviewed set is selective (see above), so the notes about each push and the required check apply
only to pull requests CodeRabbit reviews.

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
human approval, and these status checks: `backend`, `frontend`, `image`, `qa`, `windows`,
`version-bump`, `Analyze (actions)`, `Analyze (javascript-typescript)`, `Analyze (python)`, and
`CodeRabbit`. `version-bump` fails a pull request that changes `VERSION` or the package versions synced from
it, unless it is the `release/X.Y.Z` pull request from the Prepare release candidate workflow;
add a fragment under `changelog/unreleased/` instead of editing `CHANGELOG.md`. The same job
refuses non-release edits to `CHANGELOG.md`. A PR that changes product or user-facing files
without a fragment still passes, with a warning (internal-only paths are allowlisted). `qa` runs only on that
`release/X.Y.Z` pull request and when Tests is dispatched by hand; elsewhere it is skipped,
which GitHub counts as passing. These are the exact check names GitHub reports. The ruleset
blocks force pushes and deletion. A repository administrator should import and activate it under
Settings → Rules → Rulesets. GitHub Free supports branch protection and rulesets for public repositories;
private repository availability depends on the repository plan. If rulesets are not
available, configure equivalent branch protection for `main` manually.

Release notes for a feature PR: add a file under `changelog/unreleased/` named
`<unique>.<added|changed|fixed|removed|deprecated|security>.md` with Keep a Changelog
bullets. Do not edit `## Unreleased` in `CHANGELOG.md`. See
[Documentation/agents/changelog.md](Documentation/agents/changelog.md) and the
[release checklist](Documentation/RELEASE_CHECKLIST.md).
