# Contributing

Every change goes through a pull request. A human with merge permission owns the
merge decision for `main`; automated review is advisory and cannot approve or merge a
pull request. The **automated reviewer** is currently CodeRabbit; where and when it runs
is configured in one place, [Selective CodeRabbit review](#selective-coderabbit-review)
with `.coderabbit.yaml`, so swapping the tool changes only those.

Pull requests arrive release-ready: the [pull request template](.github/pull_request_template.md)
lists what to settle (release note, user documentation, onboarding lessons, agent
instructions, critical-area label) while the change is made, not at release time.

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
3. Open a pull request. Its base is the ticket's `integration/*` branch when the ticket
   belongs to one (the central [Auto-merge](#auto-merge) workflow then merges it once checks
   pass; do not enable auto-merge yourself), otherwise `main`. Explain the user-visible change, verification,
   and any risk or migration impact. Link the issue and use a draft while work is
   unfinished.
4. Wait for the required checks. The automated reviewer reviews only some pull requests (see
   [Selective CodeRabbit review](#selective-coderabbit-review)); when it reviews yours, read the summary
   and every finding.
   Fix actionable findings in a follow-up commit. If a finding is incorrect or does not
   apply, reply on the pull request with the reason so the reviewer can assess
   that disposition.
5. For a pull request into `main` ([ADR 0022](Documentation/adr/0022-main-is-gated-by-the-owners-merge-click.md)), the owner checks the diff, CI, automated findings and their
   dispositions and presses merge. No approving review is required: agents act under the owner's
   GitHub account, so an approval could never be given. An
   agent **never approves** a pull request and **never merges, or enables auto-merge on, a
   pull request into `main`**, even when told "yes, merge"; this is policy, not a technical
   block. Preparing, drafting or summarising a review is not approval. The agent opens the
   pull request, answers findings, and stops. The only `main` pull requests that merge
   without the owner pressing merge are the release pull request and safe Dependabot
   pull requests. A ticket pull request into an `integration/*` branch is merged by the
   Auto-merge workflow, not by the agent.
6. Merge with the repository's configured merge method. Do not push commits directly
   to `main`.

### Auto-merge

The **Auto-merge** workflow (`.github/workflows/auto-merge.yml`) enables squash auto-merge on exactly the
pull requests the owner has decided never need a human look. The rules are one module,
`.github/scripts/lib/auto-merge-allowlist.mjs`, with tests in `.github/scripts/test-auto-merge-allowlist.mjs`;
add a case by editing those two files, not the workflow.

- An open, non-draft pull request whose base is `integration/**` gets auto-merge (squash). It still waits
  for that branch's required checks.
- A Dependabot pull request into `main` gets auto-merge (squash) only when **every** update in it is
  a patch or minor bump, its diff touches no critical area (below), and every commit on its branch is
  Dependabot's. Any major bump, including one inside a grouped pull request, any critical path (so
  every GitHub Actions bump, which edits `.github/workflows/`), a missing or unreadable update type and
  a human commit on its branch all leave it for the owner to merge. It still waits for the required
  checks. How the update types are read: [Documentation/dependabot-auto-merge.md](Documentation/dependabot-auto-merge.md).
- The `release/X.Y.Z` pull request into `main` ([ADR 0023](Documentation/adr/0023-releases-are-fully-automated-after-the-trigger.md)) is merged (merge commit) by the **Prepare release
  candidate** workflow itself, right after it opens it, through the same allowlist's release case. It
  merges only when **all** the machine conditions in `.github/scripts/lib/release-conditions.mjs` hold:
  the branch is `release/X.Y.Z` with `VERSION` becoming X.Y.Z; the head is exactly the commit the
  workflow pushed and its preflight Tests run (dispatched on that commit) passed; every required
  check of `main` is reported for that commit and green (the preflight dispatches CodeQL too, for the
  `Analyze` checks); and the diff holds only what the workflow writes
  (`.github/scripts/lib/release-candidate-files.mjs`: version-only edits to `VERSION` and the synced
  version references, the new dated `CHANGELOG.md` section, deleted fragments). Anything else leaves
  it for the owner, and nothing is published. The workflow then starts **Publish merged release
  candidate**, which, like `release.yml`, re-checks the same conditions instead of an approval.
  The Auto-merge workflow does not process release pull requests. A pull request it opens with
  `GITHUB_TOKEN` gets `pull_request` run records in `action_required` until a maintainer approves
  them; the preflight dispatches Tests and CodeQL directly on the candidate commit and reports the
  required checks there. A merge made with `GITHUB_TOKEN` starts no `push` workflow, so the
  candidate workflow dispatches publishing itself.
- Any other pull request into `main`, a draft, a closed pull request and any other base are left alone. The owner
  reviews each `main` pull request and presses merge; this is a trust rule, so agents must not merge or
  enable auto-merge on them either.

It runs on open, reopen, ready for review, a base-branch change and (Dependabot only) a push, and uses `GITHUB_TOKEN` with
`contents: write` and `pull-requests: write` (no PAT, bot account or secret). The repository's
"Allow auto-merge" setting must stay on. Pull requests from forks are skipped (read-only token). The job
checks out the base branch, so cut `integration/**` branches from a `main` that already contains the
workflow and script.
GitHub only accepts auto-merge on a branch that requires status checks, so an `integration/**` branch
without that ruleset gets a run warning instead of auto-merge.

### Maintainer override

A repository maintainer may use GitHub's **bypass rules** option on a pull request to
merge without satisfying the ruleset's checks. Use this only when intentionally
overriding those gates, and record the reason in the pull request. It is not part of
the normal flow: a green pull request merges without it, and no pull request needs it
for a skipped automated reviewer.
The `main` and `integration/**` rulesets grant this to the `maintain` repository role. The bypass is available
only for PR merges; direct pushes to `main` remain blocked. The repository's existing
branch protection also lets repository admins bypass its checks; this ruleset bypass
extends the PR-only override to maintainers.

### Emergency changes

An emergency still uses a pull request into `main`. Mark it clearly as an
emergency, state the impact and why the normal turnaround is too slow, run the fastest
relevant checks, and ask the owner to look at it first. A maintainer may use the override
above when urgent circumstances require merging without all checks; record the reason in
the pull request. Follow up immediately with the remaining checks, documentation, and
release notes. Keep the change in a pull request.

### Automated reviewer unavailable

If the automated reviewer is unavailable, record that on the pull request and ask a human reviewer
to inspect the full diff and explicitly cover the automated review in their review.
No ruleset requires the automated reviewer, so its outage blocks no merge. Resume automated
review on later pull requests.

## Selective CodeRabbit review

CodeRabbit reviews a pull request only when it carries a label from `.coderabbit.yaml`
(`reviews.auto_review.labels`: a positive entry means at least one must be present). It cannot
filter on the head branch, so the label is how a pull request opts in. Do not request a review
(`@coderabbitai review`) outside the cases below, and do not label a pull request to get a
second opinion.

| Pull request | Label | CodeRabbit |
| --- | --- | --- |
| `integration/*` into `main` (a batch of tickets) | `coderabbit-review` | Expected: the owner waits for a review before merging (convention, not a required check). |
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

No ruleset requires a `CodeRabbit` check (it never reports on a pull request it skips), so a
pull request it skips merges normally. The review is advisory: for the `integration/*` -> `main`
pull request the owner waits for it by convention, not because GitHub enforces it.

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

A release runs the full `Tests` suite (QA, Windows and the image included) **once**: in the
preflight that **Prepare release candidate** dispatches on the candidate commit, which records
its tree there like any other run. The `release/X.Y.Z` pull request's own `Tests` run (when it
runs: its test merge has the candidate as a parent), the `push` to `main` after the merge (when
the owner merges it), and the `Tests` call inside `release.yml` on the version tag (the merge
commit; `reuse-validated-tree: true`) each look that record up and report "Reused result from run
<preflight link>". If `main` moved and the tree changed, they run the suite in full.

The weekly CodeQL and daily Container scan schedules always run in full, so new
vulnerabilities are caught; a reused `main` push leaves code-scanning results for `main` to
those schedules. The `image` job and the Container scan build the image from one shared
layer cache (`type=gha`, scope `app-image`), so the same tree is not built from scratch twice.

### Path-filtered jobs

A pull request runs only the heavy jobs its changed paths can affect. The `changes` job in
`Tests` and `CodeQL` lists the pull request's files and applies `.github/scripts/changed-paths.mjs`
(unit-tested by `test-changed-paths.mjs`, with a table of example path sets):

| Job | Runs when the pull request changes |
| --- | --- |
| `backend` | `backend/`, `VERSION`, or the scripts it runs |
| `frontend` | `frontend/`, `qa/`, `VERSION`, or the scripts it runs |
| `windows`, `image` | `backend/`, `frontend/`, `VERSION`, and `windows/` (`windows`) or `Dockerfile` / `.dockerignore` (`image`) |
| CodeQL `Analyze (<language>)` | `backend/` (python); `frontend/`, `qa/`, `.github/scripts/` (javascript-typescript); `.github/workflows/` (actions) |

The version-bump, changelog and every other cheap job always run. The full set runs, whatever
the paths, for a change to `.github/workflows/`, a pull request from `integration/*` or
`release/*`, and any event but a pull request (push to `main`, schedules, the release
preflight, `release.yml`'s call). If the file list cannot be read, everything runs.

A job skipped by the filter reports as skipped, which counts as passing for a required check
(the `qa` job relies on the same rule). CodeQL's language jobs always run and report success,
with their scan steps skipped for an untouched language, because a matrix job cannot be
skipped by its own `if`. Add a new heavy job to `changes` and to the table, or
it is never filtered. The Container scan (`trivy.yml`) is not filtered.

## Repository configuration

### Keeping CodeRabbit reviews timely

Each push can trigger another review, and large generated files can add substantial
diff context without useful findings. `.coderabbit.yaml` excludes generated artifacts and
lockfiles and keeps incremental reviews enabled. It also uses CodeRabbit's balanced
`chill` profile, which is expected to reduce low-signal, style-level feedback and the time
people spend assessing it. The tradeoff is fewer nitpicky comments. No before-and-after
review timing is available; changed source and configuration files remain in scope, and
no required check depends on it.

The reviewed set is selective (see above), so the notes about each push apply only to pull requests
CodeRabbit reviews.

CodeRabbit is selected because its Open Source plan is free for public repositories.
The checked-in [`.coderabbit.yaml`](.coderabbit.yaml) configures review guidance; a
repository owner must install the CodeRabbit GitHub App for this repository and enable
reviews on pull requests. This app integration cannot be enabled by a repository file.
If the repository becomes private or the free plan changes, disable this integration
and choose a no-cost reviewer before relying on it.

The CodeRabbit status is deliberately not a required check. Install the app so it reviews the pull
requests that opt in; until it is installed, automated review simply does not happen. Automated
findings never count as approval.

### Rulesets as code

The branch rules live in [`.github/rulesets/`](.github/rulesets/), one importable JSON per ruleset:

| Ruleset | Branches | Rules |
| --- | --- | --- |
| [`main.json`](.github/rulesets/main.json) | `main` | A pull request, **no approval required** (the owner is the only developer and agents act under the owner's account, so none could be given), review threads resolved, branch **up to date** before merge, and the checks `backend`, `frontend`, `image`, `qa`, `windows`, `version-bump`, `Analyze (actions)`, `Analyze (javascript-typescript)` and `Analyze (python)`. No force push, no deletion. |
| [`integration.json`](.github/rulesets/integration.json) | `integration/**` | A pull request, no approval, only the fast checks `backend`, `frontend` and `version-bump`, branch **not** required to be up to date (parallel worker pull requests do not keep re-running CI), no force push. Branch deletion stays allowed so a finished integration branch can be cleaned up. All three merge methods are allowed; the [Auto-merge](#auto-merge) workflow squashes by default. |

Both let the `maintain` role bypass on a pull request only (see [Maintainer override](#maintainer-override)).
The heavy checks (`image`, `windows`, CodeQL) are required on `main` only, so they gate
`integration/*` -> `main`. `version-bump` fails a pull request that changes `VERSION` or the package versions synced from
it, unless it is the `release/X.Y.Z` pull request from the Prepare release candidate workflow;
add a fragment under `changelog/unreleased/` instead of editing `CHANGELOG.md`. The same job
refuses non-release edits to `CHANGELOG.md`. A PR that changes product or user-facing files
without a fragment fails the same job (internal-only paths are allowlisted, as are `dependabot/*` branches). `qa` runs only on that
`release/X.Y.Z` pull request and when Tests is dispatched by hand; elsewhere it is skipped,
which GitHub counts as passing, and path filtering skips the heavy jobs the same way (see
[CI](#ci)). These are the exact check names GitHub reports, and `Tests` also runs on pull
requests into `integration/**` so its required checks report there. A test
(`.github/scripts/test-rulesets.mjs`) fails if a required name stops matching a job.

**Applying.** Only the owner changes repository settings. Compare, then apply:

```sh
node .github/scripts/apply-rulesets.mjs             # dry-run (default): prints committed vs live, changes nothing
node .github/scripts/apply-rulesets.mjs --apply     # creates or updates both rulesets by name
```

The dry-run compares only the fields the committed file sets and exits 1 on drift. An agent never runs
`--apply`: it opens the pull request, shows the dry-run diff, and waits for the owner's explicit
approval (the owner runs it, or tells the agent to). Edit the JSON in a pull request first and apply
after it merges, so the committed file and the live rules stay equal. It uses your signed-in `gh`.
GitHub Free supports rulesets for public repositories; private repository availability depends on the repository plan.

Release notes for a feature PR: add a file under `changelog/unreleased/` named
`<unique>.<added|changed|fixed|removed|deprecated|security>.md` with Keep a Changelog
bullets. Do not edit `## Unreleased` in `CHANGELOG.md`. See
[Documentation/agents/changelog.md](Documentation/agents/changelog.md) and the
[release checklist](Documentation/RELEASE_CHECKLIST.md).
