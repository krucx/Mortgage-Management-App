# Release checklist

A release is automated after one action: the release owner triggers **Prepare release
candidate**. The workflows do the rest and open a `release-blocked` issue if anything
fails (decision: [ADR 0023](adr/0023-releases-are-fully-automated-after-the-trigger.md)).
What a change must settle (release note, user docs, onboarding lessons, agent
instructions) is ticked on each pull request's
[template](../.github/pull_request_template.md), not here.

## Trigger — release owner

- [ ] Run **Actions → Prepare release candidate → Run workflow** on `main` with the next
  `major.minor.patch` version after the latest published release, or from GitHub CLI:

  ```sh
  gh workflow run release-candidate.yml --ref main -f version=3.4.8
  ```

That is the whole release. The workflow refuses a version that is not higher than the latest
release and `main`'s `VERSION`, and stops when `changelog/unreleased/` has no authored
fragment. Otherwise it prepares the candidate, runs the full `Tests` suite once, merges the
release pull request itself when only machine-checked conditions hold, tags the merge commit
and publishes the image and the GitHub Release. The GitHub Release and the in-app update
banner announce it; there is no manual announcement. Never push a version tag or publish an
image by hand.

## If something fails — release owner

Any failure or timeout opens (or comments on) one GitHub issue labelled `release-blocked`,
titled `Release X.Y.Z blocked`. It names the failed stage, the run and the safe rerun
command; GitHub's failed-run email reaches you too. Nothing retries, rolls back, or removes a
tag or image by itself, and a later successful publish of that version closes the issue.

- [ ] Read the issue, then the failed run's logs, and fix the cause. If no issue appears, the
  release is not blocked.
- [ ] Rerun with the command in the issue, which is safe to repeat:

  | Stage | Rerun |
  | --- | --- |
  | preparation, preflight, merge | `gh workflow run release-candidate.yml --ref main -f version=X.Y.Z` (reuses the candidate branch and pull request) |
  | validate, tag, publish | `gh workflow run publish-release.yml --ref main -f pull_request=N` |

- [ ] The publisher reuses the version tag only when it still points at the merged release
  commit. If the tag must point elsewhere, or anything was already published from a bad
  commit, cut a new patch version: never move a tag after a release artifact exists.
- [ ] If only some artifacts were published, the rerun replaces that version's image, notes
  and ZIP. Never move `latest` back to an older version.
- [ ] If users may have installed a broken release, publish a corrected release, explain the
  affected version and recovery steps in its notes, and point to the pre-update Backup
  guidance when a database migration is involved.
- [ ] A missing `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN` or `RELEASE_WORKFLOW_TOKEN` secret
  (Contents and Workflows write) stops the release and raises the issue; the owner restores
  it in repository settings, then reruns.
