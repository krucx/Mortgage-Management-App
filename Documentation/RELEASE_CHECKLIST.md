# Release checklist

Use this checklist for every release. The **change author** prepares and verifies
release content; the **release owner** decides when to publish, starts the automated
flow, and verifies the published release. Mark steps not relevant to this release as
not applicable and give a short reason.

## Start a release candidate

After the release notes and other applicable release preparation are ready, the
release owner runs **Actions → Prepare release candidate → Run workflow** on `main`
and supplies the requested `major.minor.patch` version. For example, the next version
after the unpublished 3.4.5 bump is 3.4.6. The same entry point is available from GitHub
CLI:

```sh
gh workflow run release-candidate.yml --ref main -f version=3.4.6
```

The workflow refuses an invalid or non-increasing version and stops before opening a
pull request when `CHANGELOG.md` has no authored notes under `Unreleased`. It promotes
those notes, synchronizes the shared version references, then runs the `Tests` workflow
on the candidate branch. That preflight includes tests, type checks, lint, build,
coverage reports, Windows setup checks and an isolated Docker image smoke test. A
passing run opens a pull request with its result and the pending release checklist.
Failures report the candidate branch and preflight run so the owner can supply missing
information or safely rerun the same version. A maintainer may need to approve the
workflow run for the release pull request's checks in GitHub Actions before they start.

The workflow token can write repository contents and pull requests and dispatch the
preflight workflow. It does not publish a release or Docker image; only the tag-driven
release flow in the Publish section does that.

## Prepare — change author

- [ ] Review merged changes since the last release and update `CHANGELOG.md` under
  `Unreleased`, preserving older entries and examples.
- [ ] Review user documentation for changed behavior, setup, upgrade, migration,
  recovery, and screenshots; update applicable pages.
- [ ] Review developer documentation and agent instructions for changed workflows,
  commands, interfaces, and operational requirements.
- [ ] Update applicable onboarding lessons, exercises, references, and notes when the
  release changes what those lessons teach. Mark not applicable if none are affected.
- [ ] Set the intended semantic version in root `VERSION`.
- [ ] Move the finalized release notes from `Unreleased` into a `## [<version>]`
  section in `CHANGELOG.md` before the release commit is merged and the tag is pushed.
  The release workflow extracts its GitHub Release notes from this versioned section.
- [ ] Run `node .github/scripts/sync-version.mjs`, then `cd backend && uv lock`, then
  `cd .. && node .github/scripts/check-version.mjs`. Confirm the root, backend and
  frontend package versions, lock metadata, generated API schema, and maintained
  current-version labels agree. Update Docker/container version references if any are
  versioned outside the shared `VERSION` source.
- [ ] Run the full applicable verification: backend tests and type check, frontend tests,
  type check and lint, container build/start check, Windows setup checks, and relevant
  docs/onboarding build or checks. Review coverage reports and explain material
  regressions. Mark genuinely inapplicable checks with a reason.
- [ ] Confirm the release commit is merged to `main`, the worktree is clean, and the
  intended version tag does not already exist on the local or remote repository; verify
  the tag will point at that merged release commit.

## Publish — release owner

- [ ] Review the completed preparation checklist, diff since the previous release,
  changelog entry, CI results, version consistency, and any skipped check explanations.
- [ ] Confirm GitHub Actions has the required `DOCKERHUB_USERNAME` and
  `DOCKERHUB_TOKEN` secrets and Docker Hub access is available. If unavailable, stop
  before tagging and resolve access.
- [ ] Before pushing the tag, supply/verify the exact semantic version, merged commit,
  matching `VERSION`, completed changelog section, and configured Docker Hub credentials.
  These are the inputs the flow needs; it derives image tags and GitHub Release notes and
  artifacts from the tag and changelog.
- [ ] Start the automated release flow from the clean, verified release commit by
  creating and pushing a version tag matching root `VERSION` (for example,
  `git tag 3.5.0` followed by `git push origin 3.5.0`). This starts
  `.github/workflows/release.yml`; do not manually publish an image or GitHub Release.
- [ ] Watch the release workflow through tests, version/tag validation, image publication,
  ready-built archive creation, and GitHub Release creation. Stop and recover if any job
  fails; do not announce a partial release.
- [ ] Verify the GitHub Release has the intended notes and downloadable
  `mortgage-management-<version>.zip`; verify Docker Hub has the version image and that
  `latest` points to this release only when it is the highest version.
- [ ] Verify the published install/download and a clean startup using the release's
  documented path. Confirm the app reports the expected version and the key changed
  behavior works.
- [ ] Announce the release through the project's normal channel and link the GitHub
  Release. Record any follow-up issue.

## Recovery — release owner

- [ ] If the workflow fails before publication, fix the cause on `main`, rerun the
  relevant checks, and push the corrected tag only after verifying tag/version rules.
  If the tag already points at the failed commit, remove or move it only when no release
  artifact was published and repository policy permits it; otherwise cut a new patch
  version and tag.
- [ ] If only some artifacts were published, pause announcements and inspect workflow
  logs, Docker Hub tags, and the GitHub Release. Re-run the failed safe/idempotent jobs
  or publish a corrected patch release; never move `latest` back to an older version.
- [ ] If users may have installed a broken release, publish a corrected release, explain
  the affected version and recovery steps in its notes, and use the pre-update Backup
  guidance when a database migration is involved.
- [ ] Verify the recovery release and update the changelog/docs if the failure changed
  user instructions.
