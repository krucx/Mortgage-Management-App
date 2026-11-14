# Repository guidance for coding agents

This is the one authoritative steering file. `CLAUDE.md` only points here.

## Engineering principles

Follow the YAGNI principle, but do not compromise on good UI/UX, performance, and
maintainability. Don't obsess over fewer lines of code, but do obsess over simplicity,
simplifying, reusing, and eventually creating a cleaner, maintainable system.

## Contribution and release workflow

- Before changing code, follow [CONTRIBUTING.md](CONTRIBUTING.md): work on a branch,
  open a pull request targeting `main`, respond to automated findings, and leave the merge
  decision and approval to a human. The human records the approving review and merges; you
  open the pull request and stop. Never submit an approving review or merge, even if told to.
- For release work, follow the canonical
  [release checklist](Documentation/RELEASE_CHECKLIST.md). A release owner must supply and
  verify the version, release PR, changelog, and required credentials before any version tag
  is pushed or the PR that starts the tag-driven publish workflow is merged.

## Pointers

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
- Agent skills live in `.claude/skills`; `.agents/skills` is a symlink to it. Edit skills
  only under `.claude/skills` so Claude Code and other agents read the same copy.
