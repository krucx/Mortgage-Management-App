# SYLLABUS.md Format

`SYLLABUS.md` lives at the course root. It is the ordered plan of chapters that takes a new developer from "never seen this repo" to "can safely make a change". Each run of `/teach` writes the next unwritten chapter in it, unless the user names another.

## Template

```md
# Syllabus

Each chapter assumes only the chapters before it.

| # | Chapter | Folder | The reader will be able to | Status |
| --- | --- | --- | --- | --- |
| 001 | The big picture | `001-the-big-picture/` | say what the app does for whom, run it locally, and name its main parts | written (abc1234) |
| 002 | The domain in plain words | `002-the-domain-in-plain-words/` | explain a Mortgage, a Payment and a Closure to a non-developer | written (def5678) |
| 003 | The Ledger engine | `003-the-ledger-engine/` | trace any Mortgage's money figures by hand | planned |

## Planned lessons

### 003 The Ledger engine
1. Why the Ledger is replayed, not stored
2. One day inside the replay
3. …
```

## Rules

- **Order by dependency.** A chapter may only rely on chapters above it. Big picture and domain come first; the core engine before the layers that call it; the frontend after the API it talks to; operations (install, Backups, releases) last.
- **One area per chapter.** A chapter covers one area of the codebase a developer would work in. If you can't state what the reader will be able to do in one line, the chapter is too broad.
- **Status** is `planned`, `written (<short commit>)`, or `stale (<reason>)` when a later change to the code made the chapter wrong. The commit is the code commit the chapter was written against (`git rev-parse --short HEAD` before you commit the chapter), the same one its overview page records. Its snippets' line numbers are true at that commit. It is not the commit that adds the chapter.
- **Plan lessons only for the next chapter or two.** Further chapters need only their row. Plans made too early go stale.
- **Confirm changes with the owner.** Show the syllabus to the owner when you first draft it and when you reorder or split chapters.
