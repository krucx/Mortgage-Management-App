# MISSION.md Format

`MISSION.md` lives at the course root. It captures why the onboarding course exists: what a new developer should be able to do once they have worked through it. Every teaching decision (which chapters to write, what to put in them, which exercises to design) should trace back to this document.

## Template

```md
# Mission: Onboarding to {project}

## Why
{1-3 sentences. Who the course is for and what changes once they've done it. For example: "New developers join knowing how to program but not this app or its business. After the course they can find their way around, explain how every money figure is produced, and make a change without breaking the numbers."}

## Success looks like
- {A specific, observable thing a new developer will be able to do}
- {Another specific thing}
- {…}

## Constraints
- {Reader's assumed background, time per chapter, the owner's preferences, anything that bounds the approach}

## Out of scope
- {Areas the owner does not want covered yet, or general skills the reader is assumed to have}
```

## Rules

- **One mission per course.** If the owner wants a course for a different audience (for example the Lender, not developers), that is a separate course.
- **Concrete over abstract.** "Can add a new Closure type with tests" beats "understands the backend."
- **Push back on vagueness.** If the owner's goals are unclear, ask before writing anything. A bad mission is worse than no mission.
- **Revise when reality shifts.** When the app or the audience changes, update this file and confirm with the owner: don't leave a stale mission steering future chapters.
- **Keep it short.** If `MISSION.md` runs past a screen, it has stopped being a compass and started being a plan.
