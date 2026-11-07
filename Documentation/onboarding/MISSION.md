# Mission: Onboarding to Mortgage Management

## Why
New developers join knowing how to program, but not this app or the business it serves: one Lender lending against pledged jewellery. After the course they can find their way around the repo, explain how every money figure is produced, and make a change without breaking the numbers.

## Success looks like
- Explain a Mortgage, a Payment, a Closure and the Lender's day to a non-developer, using the glossary's words.
- Serve the sample book on scratch data, and find any glossary term or ADR behind a screen.
- Hand-trace a Mortgage's interest, Capitalisation, Payments and Outstanding, then check it against the app.
- Add a change route that refuses, writes, checks and records History, with its Preview.
- Make one small change test-first through every layer, and ship it the way this repo does.

## Constraints
- The reader programs well but may be junior, and knows nothing of this codebase or of pledge lending.
- About an hour per chapter, 16 chapters, in the order agreed in [Map: Plan the onboarding course (#92)](https://github.com/krucx/Mortgage-Management-App/issues/92).
- One example cast across the course: the sample book of The Gold Chain Story (`docs/sample-book/book.py`), as it stood on 19 Oct 2026.
- The course teaches the current code on `main`. `Documentation/GLOSSARY.md` terms are used exactly.
- Never touch the Lender's real `data/` or `backups/`: every run-through uses a scratch folder.

## Out of scope
- The public docs site in `docs/`: used as a resource, not taught.
- General Python, React or TypeScript tutorials.
