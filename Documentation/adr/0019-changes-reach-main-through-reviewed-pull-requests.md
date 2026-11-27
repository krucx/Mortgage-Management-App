# Changes reach main only through reviewed pull requests

> **Superseded by [ADR 0022](0022-main-is-gated-by-the-owners-merge-click.md):** the human gate is the owner viewing and merging each `main` pull request, as policy, not an approving review. The text below is the original decision.

Every change to `main`, including documentation, onboarding chapters and emergencies, goes through a pull request. The ruleset in `.github/rulesets/main.json` blocks direct pushes and force pushes, and requires resolved review threads, an up-to-date branch, and the `backend`, `frontend`, `image`, `qa`, `windows`, `version-bump` and CodeQL checks. It requires no approval (the owner is the only developer and agents act under the owner's account, so none could be given; amended by #569) and no `CodeRabbit` check. CodeRabbit is the advisory automated reviewer for `integration/*` pull requests and pull requests labelled `critical` (selective, to save quota; see CONTRIBUTING.md): its findings are answered on the pull request, and it never counts as an approval. The `maintain` role may bypass the rules on a pull request, recording why; never by pushing to `main`.

Until November 2026 the one developer committed straight to `main`, so a red check meant `main`, and the next release, was already broken, and nobody but the author read a change before the Lender could install it. Requiring review costs a round trip per change; we accept that because the app holds the Lender's money records and a release reaches their laptop through an update banner.

## Considered Options

- **Keep committing to main, with CI after the fact**: rejected, as a broken `main` can be released before anyone looks.
- **Automated review alone**: rejected; an automated reviewer is advisory and can be wrong, so a human decides.
