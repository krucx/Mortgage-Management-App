# Changes reach main only through reviewed pull requests

Every change to `main`, including documentation, onboarding chapters and emergencies, goes through a pull request. The ruleset in `.github/rulesets/main.json` blocks direct pushes and force pushes, and requires one human approval of the last push, resolved review threads, and the `backend`, `frontend`, `image`, `windows`, CodeQL and `CodeRabbit` checks. CodeRabbit is the automated reviewer: its findings are answered on the pull request, but it never counts as an approval. The `maintain` role may bypass the rules on a pull request, recording why; never by pushing to `main`.

Until November 2026 the one developer committed straight to `main`, so a red check meant `main`, and the next release, was already broken, and nobody but the author read a change before the Lender could install it. Requiring review costs a round trip per change; we accept that because the app holds the Lender's money records and a release reaches their laptop through an update banner.

## Considered Options

- **Keep committing to main, with CI after the fact**: rejected, as a broken `main` can be released before anyone looks.
- **Automated review alone**: rejected; an automated reviewer is advisory and can be wrong, so a human decides.
