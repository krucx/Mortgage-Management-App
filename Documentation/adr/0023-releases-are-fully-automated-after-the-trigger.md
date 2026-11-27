# Releases are fully automated after the trigger

The owner's only action in a release is to run **Prepare release candidate** with a version. The workflow collates the changelog fragments, syncs the version, runs the full `Tests` workflow on the `release/<version>` branch (the preflight) and opens the release pull request. It then merges that pull request itself, and starts **Publish merged release candidate**, which tags the merge commit and dispatches `release.yml` to publish the image and the GitHub Release. Nobody approves or merges anything.

The merge happens only when every machine condition in `.github/scripts/lib/release-conditions.mjs` holds: the branch is `release/X.Y.Z` and `VERSION` becomes X.Y.Z; the head is exactly the commit the workflow pushed, and its preflight run passed; every required check of `main` is reported for that commit and green; and the diff holds only files the workflow writes (the file allowlist in `release-candidate-files.mjs`: version-only edits, the new dated `CHANGELOG.md` section, deleted fragments). If any condition fails, the pull request is left for the owner and nothing is published. The publisher checks the same conditions again after the merge instead of looking for an approval.

The full suite, QA and Windows included, runs once per release, in the preflight. The release pull request, the push to `main` and the `Tests` call inside `release.yml` reuse that result for the same tree and run in full only if the tree changed (see CONTRIBUTING.md, *Reusing validated results by tree*).

A failure at any stage (preparation, preflight, merge, validate, tag, publish), or a timeout, opens or updates one `release-blocked` issue for the version. It names the stage, the run and the safe rerun command, and a later successful publish closes it. Nothing retries and nothing rolls back: a published image or GitHub Release may already be installed on a Lender's laptop and cannot be recalled, so a second automatic attempt could make a partial release worse. A person reads the issue and reruns, or cuts a new patch version.

This replaces the approval the old flow required (ADR 0018), which the owner could not give under their own identity (ADR 0022). The repository variable `RELEASE_REQUIRE_APPROVAL=true` restores that approve-and-merge path; it is a temporary rollout fallback that is removed after one release has auto-merged and published cleanly while the owner watched.

Supersedes ADR 0018.

## Consequences

- Tags never move once anything may have been published; a fix that needs another commit is a new patch version.
- The workflows open and merge the release pull request with `GITHUB_TOKEN`, which starts no `pull_request` runs, so the workflows dispatch the preflight, CodeQL and the publish flow themselves.
- Creating the tag still needs the `RELEASE_WORKFLOW_TOKEN` secret (Contents and Workflows write); without it the publisher stops before tagging and raises the issue.
