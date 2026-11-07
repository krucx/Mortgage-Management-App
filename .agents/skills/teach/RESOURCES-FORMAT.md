# RESOURCES.md Format

`RESOURCES.md` is the curated set of trusted sources for the course. This repo's own documents come first, because the code and its decisions are the source of truth. External sources cover general background (frameworks, libraries, financial ideas). Lessons should draw from here, not from guesses.

## Structure

```md
# Onboarding Resources

## In this repo

- [GLOSSARY.md](../../GLOSSARY.md)
  The canonical domain language. Use for: every term a lesson uses.
- [ADR 0006: Interest on start-of-month Principal](../adr/0006-interest-on-start-of-month-principal.md)
  Why a month's interest ignores Payments made during it. Use for: the Ledger chapter.

## External

- [FastAPI tutorial](https://fastapi.tiangolo.com/tutorial/)
  Official guide to the backend framework. Use for: the request-handling chapter.

## Where to get help

- The issue tracker (see `Documentation/agents/issue-tracker.md`). Use for: reporting something in the course or the code that looks wrong.
- The owner. Use for: questions the documents don't answer.
```

## Rules

- **High-trust only.** For this codebase, the code, tests and ADRs outrank everything else. For external topics, prefer official documentation and recognised experts. If a resource is marketing dressed as education, leave it out.
- **Annotate every entry.** A bare link is useless in three months. Add one line: what it covers and when to reach for it.
- **Group by In this repo / External / Where to get help.**
- **Surface gaps explicitly.** If an area has no ADR or good source, write a `## Gaps` section listing what is missing. A gap in the repo's own docs is worth raising with the owner.
- **Prune ruthlessly.** A resource that turned out to be wrong, shallow, or off-mission should be removed, not buried. Better five sharp sources than thirty mediocre ones.
