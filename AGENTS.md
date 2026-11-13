# Repository guidance for coding agents

- Follow [CONTRIBUTING.md](CONTRIBUTING.md) for branch, pull request, automated review,
  human approval, and merge requirements.
- Use [Documentation/RELEASE_CHECKLIST.md](Documentation/RELEASE_CHECKLIST.md) for every
  release. A release owner must verify the version, release PR, changelog, and required
  credentials before merging the PR that starts the tag-driven publish workflow.
- Read [Documentation/GLOSSARY.md](Documentation/GLOSSARY.md) and relevant decisions in
  [Documentation/adr](Documentation/adr) when changing domain behavior.
- QA the real stack only with `scripts/qa-stack.sh up --data DIR --backups DIR` (scratch
  folders, built from source, own project and port) and `down`; never `docker compose` directly.
