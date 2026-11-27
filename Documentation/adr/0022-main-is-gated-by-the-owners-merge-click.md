# Main is gated by the owner's merge click, as policy

Every change to `main` goes through a pull request, and the owner looks at it and presses merge. That click is the one human gate. It does not apply to two kinds of pull request: the release pull request, which merges itself on machine conditions (ADR 0023), and safe Dependabot pull requests (patch or minor bumps that touch no critical area), which the Auto-merge workflow merges. A pull request into an `integration/*` branch is merged by the same workflow, and the owner then looks at the one `integration/*` -> `main` pull request.

Agents act under the owner's GitHub identity. The owner is the sole developer, so there is no bot account, no personal access token for agents and no second reviewer to give an approval: an approval from the owner's own account on a pull request opened under it can't be given. For the same reason no approving review is required, and the `main` ruleset (`.github/rulesets/main.json`) requires none. The ruleset still blocks direct and force pushes and requires resolved review threads, an up-to-date branch and the `backend`, `frontend`, `image`, `qa`, `windows`, `version-bump` and CodeQL checks.

Because every agent command and the owner's click arrive as the same GitHub user, GitHub cannot tell them apart. "An agent never approves, merges or enables auto-merge on a `main` pull request" is therefore a rule in `AGENTS.md` and `CONTRIBUTING.md`, not a technical block. We accept that: the alternative, a second identity for the agents, adds a credential to guard and a second account to keep alive for one developer's repository.

No automated-reviewer check is required. The automated reviewer (today CodeRabbit, but the rule is tool-neutral) runs on `integration/*` -> `main` pull requests and pull requests labelled `critical`, its findings are answered on the pull request, and it never counts as an approval or blocks a merge. The owner may also skip it, recording why. The `coderabbit-review` label that opts an `integration/*` -> `main` pull request in is added automatically by the CodeRabbit label workflow, not by hand.

Supersedes ADR 0019.

## Considered Options

- **Require an approving review**: rejected; with one developer acting through agents under one account, nobody else could approve.
- **A bot account or token for agents**: rejected; it would let GitHub tell agent from owner, but at the cost of a credential and an account to maintain for no other benefit.
- **Require the automated reviewer's check**: rejected; it is advisory, can be wrong, and is a vendor name in the merge rules.
