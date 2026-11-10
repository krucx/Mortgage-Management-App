# Releases are published by merging an approved candidate

A release is never started by pushing a version tag by hand. The release owner runs the **Prepare release candidate** workflow with a version; it refuses one that isn't higher than both the latest published release and `main`'s `VERSION`, promotes the `Unreleased` notes in `CHANGELOG.md` to a dated section, syncs every copy of the version from the one `VERSION` file, runs the full Tests workflow on the `release/<version>` branch, and only then opens the release pull request. Merging that pull request, after a human other than its author has approved its last push and its checks have passed, publishes it: `publish-release.yml` creates the tag at the merge commit (or reuses it if it is already there, and refuses if it points anywhere else) and dispatches `release.yml`, which checks the approval again before publishing the image, then the GitHub Release, then verifying both.

We chose this because a hand-pushed tag could publish code nobody reviewed, with notes nobody approved, and because the release rules were shell copied between three workflows, where every fix was proven only by shipping a real release. The rules now live in one module, `.github/scripts/release.mjs`, behind a GitHub adapter with a fake for tests, so a moved tag, a stale approval or a run that never appears is tested without releasing anything.

## Consequences

- Pull requests that prepare a release write notes under `Unreleased` and leave `VERSION` alone; a hand bump on `main` makes the candidate workflow refuse the same version.
- Tags never move once anything may have been published: a fix that needs another commit is a new patch version.
- `latest` on Docker Hub moves only for the highest version tagged, so an older patch release can't take it back.
- Creating the tag needs the `RELEASE_WORKFLOW_TOKEN` secret (Contents and Workflows write); without it the publisher stops before tagging.
