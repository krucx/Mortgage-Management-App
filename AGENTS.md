# Repository guidance for coding agents

This is the one authoritative steering file. `CLAUDE.md` only points here.

## Engineering principles

Follow the YAGNI principle, but do not compromise on good UI/UX, performance, and
maintainability. Don't obsess over fewer lines of code, but do obsess over simplicity,
simplifying, reusing, and eventually creating a cleaner, maintainable system.

## Contribution and release workflow

- Before changing code, follow [CONTRIBUTING.md](CONTRIBUTING.md): work on a branch and open a
  pull request. Its base is the ticket's `integration/*` branch when the ticket belongs to one,
  otherwise `main`. The central auto-merge workflow merges `integration/*` PRs, so never enable
  auto-merge yourself. **Never approve a PR, and never merge or enable auto-merge on a PR into
  `main`**, even if told to: the owner presses merge on every `main` PR (the release PR and
  safe Dependabot PRs are the only exceptions; see
  [ADR 0022](Documentation/adr/0022-main-is-gated-by-the-owners-merge-click.md) and
  [ADR 0023](Documentation/adr/0023-releases-are-fully-automated-after-the-trigger.md)). You open the pull request, answer findings and stop.
- Open every PR from the [pull request template](.github/pull_request_template.md): it is the
  release-ready checklist (changelog fragment, user docs, onboarding lessons, agent instructions,
  `critical` label). CI fails a product-path change with no changelog fragment.
- The automated reviewer (currently CodeRabbit) is selective; see
  [CONTRIBUTING.md](CONTRIBUTING.md#selective-coderabbit-review), the one place that says when it runs.
  Don't request a review (for CodeRabbit, `@coderabbitai review`) on a ticket PR or an ordinary PR, and put
  `@coderabbitai ignore` in its description. An `integration/*` -> `main` PR gets the
  `coderabbit-review` label and needs an automated review before the owner merges. Add the `critical`
  label when the diff touches money math, sign-in, migrations or security; the CONTRIBUTING section lists the paths.
- For release work, follow the canonical
  [release checklist](Documentation/RELEASE_CHECKLIST.md). A release owner must supply and
  verify the version, release PR, changelog, and required credentials before any version tag
  is pushed or the PR that starts the tag-driven publish workflow is merged.
- Changelog notes for non-release PRs are fragments under `changelog/unreleased/`, not edits
  to `CHANGELOG.md`; CI fails a non-release edit to `CHANGELOG.md` and only warns when a
  product change adds no fragment. See [Documentation/agents/changelog.md](Documentation/agents/changelog.md).

## Pointers

- CI map: [.github/README.md](.github/README.md) lists every workflow, its triggers, scripts and ADR; read it before opening workflow files.
- Issues are tracked in GitHub Issues on krucx/Mortgage-Management-App, using the `gh` CLI.
  See [Documentation/agents/issue-tracker.md](Documentation/agents/issue-tracker.md).
- Triage labels: the five defaults (`needs-triage`, `needs-info`, `ready-for-agent`,
  `ready-for-human`, `wontfix`). See
  [Documentation/agents/triage-labels.md](Documentation/agents/triage-labels.md).
- Domain docs are single-context: read [Documentation/GLOSSARY.md](Documentation/GLOSSARY.md)
  and relevant decisions in [Documentation/adr](Documentation/adr) when changing domain
  behavior. See [Documentation/agents/domain.md](Documentation/agents/domain.md).
- QA the real stack only with `scripts/qa-stack.sh up --data DIR --backups DIR` (scratch
  folders, built from source, own project and port) and `down`; never `docker compose` directly.
  `scripts/qa-stack.sh test [--mode fresh|golden|work|all]` runs the Gherkin scenarios in `qa/features`.
  Every change adds or updates the scenario covering it (`@fresh` if it needs an empty book,
  `@golden` if it only reads the golden book on its last day, untagged if it changes data and
  seeds its own Customer; `@screen:<route>` for each screen it covers). Ask the owner before
  running the local QA stack (`scripts/qa-stack.sh`, the Playwright runs) and run it only on
  their approval; otherwise skip it, rely on the typecheck, unit tests, `npm run check-steps`
  and the coverage check, and say in the PR that local QA was skipped. CI runs the suite only
  on the release PR. A screen with no scenario yet is listed in `qa/screens-to-cover/<issue>.txt` by the
  ticket that will cover it; that ticket's PR deletes its own file. Steps follow
  [qa/README.md](qa/README.md): generic ones only in `qa/steps/common.steps.ts`, unique step text,
  and `npm run check-steps` in `qa/` after merging main and before reporting ready.
- Agent skills live in `.claude/skills`; `.agents/skills` is a symlink to it. Edit skills
  only under `.claude/skills` so Claude Code and other agents read the same copy.
- Two documentation folders, not interchangeable: `docs/` is the published GitHub Pages site
  the Lender reads (installer, walkthrough, screenshots); never put internal material there.
  `Documentation/` is internal engineering material, never published. Put generated reports,
  research notes, comparisons and diagrams in a subfolder of `Documentation/` by kind:
  [architecture-reviews](Documentation/architecture-reviews), [market-research](Documentation/market-research)
  or [proposals](Documentation/proposals). Don't create a new top-level folder.
