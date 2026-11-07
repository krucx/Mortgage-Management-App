---
name: teach
description: Write onboarding chapters that teach this codebase to new developers. Each run delivers one whole chapter (a numbered folder of short HTML lessons) with problem statements, flow diagrams, line-numbered code walk-throughs, run-throughs on scratch data, and quizzes, then commits and pushes it to main.
---

The user has asked you to teach. In this project, teaching mainly means **onboarding new developers**. You are writing a course that people who have never seen this codebase will read on their first days. They are not in the room. The page has to do all the explaining that you would do if you were sitting next to them.

## Who the reader is

Write for a developer who:

- **Can program well.** They know what a function, a class, a database query, an HTTP request and a test are. Don't explain basic programming.
- **Knows nothing about this codebase.** They don't know where anything lives, why it was built this way, or what its names mean.
- **Knows nothing about the business.** Mortgages, Lenders, interest, Capitalisation and Redemption are new words to them. Every domain idea needs a plain-language explanation the first time it appears.
- **May be junior.** The chapter should still work for someone in their first job. When the code uses an idiom that isn't obvious (a Python walrus operator, a generator, a React hook, a SQL window function), explain it in one sentence where it appears.

The test for every paragraph: *could a smart newcomer follow this without asking anyone?* If they would have to ask "what does that mean?" or "why?", the paragraph isn't finished.

## The course workspace

The course lives in `Documentation/onboarding/` and is committed to the repo, so every developer gets it with their clone. Paths below are relative to that folder. Only the `*-FORMAT.md` links and `./assets/`, `./scripts/` resolve from this skill's own folder.

```
Documentation/onboarding/
├── index.html                  course home: what the app is, chapter map, how to use the course
├── MISSION.md                  why the course exists and what "onboarded" means
├── SYLLABUS.md                 the ordered chapter plan, with status
├── RESOURCES.md                trusted sources (this repo's docs first)
├── NOTES.md                    your working notes and the owner's preferences
├── assets/                     shared CSS/JS components (copied from this skill on first run)
├── reference/                  cheat sheets that outlive the lessons
│   └── glossary.html
├── 001-the-big-picture/        one folder per chapter
│   ├── index.html              chapter overview
│   ├── 01-<lesson-name>.html
│   ├── 02-<lesson-name>.html
│   └── 99-check-yourself.html  end-of-chapter quiz and hands-on exercise
└── 002-<chapter-name>/
```

- Chapters are numbered with three digits: `001-`, `002-`, ... followed by the chapter name in dash-case. That folder name is the chapter's identity; never renumber a published chapter.
- Lessons inside a chapter are numbered with two digits, `01-`, `02-`, ... in reading order. The last file is always `99-check-yourself.html`.
- To find the next chapter number, list the folders and add one to the highest.

Formats for the root files: [MISSION-FORMAT.md](./MISSION-FORMAT.md), [SYLLABUS-FORMAT.md](./SYLLABUS-FORMAT.md), [RESOURCES-FORMAT.md](./RESOURCES-FORMAT.md). The anatomy of a chapter and of a lesson is in [CHAPTER-FORMAT.md](./CHAPTER-FORMAT.md). Read it before writing any chapter.

## What one run produces

**One run delivers one complete chapter**, not one lesson. A chapter is a coherent area of the codebase (for example "The Ledger engine" or "How a request reaches the database") taught in roughly 3 to 6 lessons, plus an overview page and a check-yourself page. A reader should be able to finish a chapter in about an hour and come away able to work in that area.

Deliver the whole chapter in one go because onboarding readers move through material on their own schedule. A chapter with only its first lesson written leaves them stranded halfway through a topic.

## Workflow

### First run: set up the course

If `Documentation/onboarding/` doesn't exist yet:

1. **Mission.** Write `MISSION.md`. The default mission is "a new developer can find their way around, explain how money figures are produced, and safely make a change". Ask the owner (the person running `/teach`) whether anything should be emphasised or left out, then write it down.
2. **Survey the codebase.** Read `README.md`, `Documentation/GLOSSARY.md`, `Documentation/adr/`, `CHANGELOG.md`, and the top-level layout of `backend/` and `frontend/`. Read the code itself; it is the source of truth.
3. **Syllabus.** Draft `SYLLABUS.md`: the ordered list of chapters that would take a newcomer from zero to productive. Start with the big picture (what the app does for whom, how the pieces fit, how to run it), then the domain, then the core engine, then the surrounding layers. Show the syllabus to the owner and confirm it before writing chapter 001.
4. **Assets.** Copy this skill's `./assets/` folder into `Documentation/onboarding/assets/`. These are the starting components (stylesheet, quiz and reveal widgets, the code-snippet renderer, the bundled Mermaid and its loader). Extend them in the workspace from then on.
5. **Course home.** Write `index.html`: one paragraph on what the app is, a diagram of the chapters, and a list linking every chapter.

### Every run: write the next chapter

1. **Pick the chapter.** Use the user's argument if they gave one; otherwise take the next unwritten chapter in `SYLLABUS.md`. Read `NOTES.md` and the chapters before it, so you build on what the reader already knows and don't re-teach it.
   - If the user names a chapter whose earlier chapters aren't written yet, write it anyway, under its syllabus number. Don't renumber it to come first, and don't write the earlier chapters unasked. Its overview's "Before you start" then gives a short primer covering what those chapters would have taught (enough of the domain and layout to follow this chapter), and links the syllabus rows for them. When the earlier chapters are written later, replace the primer with links.
2. **Research the area.** Read every file the chapter covers, the ADRs that explain its decisions, its tests, and the glossary terms it uses. Note the line numbers of the parts you will show (`grep -n`, `sed -n 'A,Bp'`).
3. **Plan the chapter.** Write down the chapter's problem statement and the lesson list, each lesson with the one thing the reader will be able to do afterwards. Order lessons so each one needs only what came before.
4. **Build the scratch-data examples** (see [Run-throughs](#run-throughs-on-scratch-data)). Run the real code to get every number.
5. **Write the pages:** the chapter `index.html`, each lesson, and `99-check-yourself.html`, following [CHAPTER-FORMAT.md](./CHAPTER-FORMAT.md).
6. **Update the shared pages:** add new terms to `reference/glossary.html`, add or extend a cheat sheet in `reference/`, link the chapter from the course `index.html`, and mark it written in `SYLLABUS.md`.
7. **Check it** (see [Before you commit](#before-you-commit)).
8. **Commit and push to main.** Stage only `Documentation/onboarding/`. Use a message like `Onboarding: chapter 003, the Ledger engine` and push to `main`. This project's owner is the sole developer and commits straight to main; don't create a branch or a PR.
9. **Open it.** Run `open Documentation/onboarding/<chapter>/index.html` and tell the user what the chapter covers and where it starts.

## How to explain

Every lesson follows the same arc, because it mirrors how an experienced developer would explain code to a colleague:

1. **The problem.** Start with the real problem this code solves, in business terms first. "A Customer pays late, then the Lender back-dates a Payment. Every interest figure after that date is now wrong. How do we fix them all?" Make the reader feel the problem before they see the solution. If a simpler, obvious design would fail, show how it fails.
2. **The idea.** The solution in one or two sentences, in plain words, before any code.
3. **The flow.** A diagram of how it works: which pieces are involved and in what order. See [Diagrams](#diagrams).
4. **The code.** Trimmed, line-numbered snippets of the real code. See [Code snippets](#code-snippets).
5. **A run-through.** Real scratch data pushed through the real code, step by step. See [Run-throughs](#run-throughs-on-scratch-data).
6. **The nuances.** The edge cases and the "why is it like this?" rules, each with its own small example and a link to the ADR that decided it.
7. **Check yourself.** A prediction or quiz before revealing the answer.

Some more guidelines:

- **Define every term the first time it is used,** in plain words, and link it to the glossary. This project's root `Documentation/GLOSSARY.md` is canonical: use its terms exactly, with its capitalisation, and never invent a synonym for something it already names.
- **Use analogies for domain ideas** a newcomer has never met. Then come back to the exact meaning. An analogy is a ramp onto the idea, not a substitute for it.
- **Say why, not just what.** For every design decision the reader will notice, give the reason. Usually there is an ADR; link it and give its argument in one or two sentences.
- **Short sentences, active voice.** One idea per paragraph. Prefer a table or a diagram to a long paragraph of comparisons.
- **Point to the real files.** Every lesson should leave the reader knowing which files to open, and in what order, to see it for themselves.

### Code snippets

Developers learn a codebase by reading its code, so lessons are full of it. Show it the way a good reviewer would walk you through it: the parts that matter, nothing else.

- **Use the real code, trimmed to pseudocode.** Keep the real names of functions and variables, so the reader can search for them. Cut logging, error handling, type annotations and boilerplate that don't help the point. Collapse a boring block into a one-line description such as `… validate the input …`. Rewrite a dense expression into a clearer one if that keeps its meaning.
- **Keep the real line numbers.** Every line shown carries the line number it has in the source file, so the reader can jump to it. Where you skip lines, show a `⋮` line. Caption every snippet with the file path (as a link), the function name, the line range, and whether it is trimmed.
- **Annotate.** Add short comments on the lines that matter, or number them ①②③ and explain each below the snippet. Highlight the one or two lines the lesson is about.
- **Keep snippets short.** About 25 lines at most. Split a long function into several snippets, each with its own explanation.
- **Pin the version.** Line numbers drift as the code changes. Each chapter's `index.html` records the commit the chapter was written against (`git rev-parse --short HEAD`).

The snippet markup and its renderer (`assets/snippet.js`) are described in [CHAPTER-FORMAT.md](./CHAPTER-FORMAT.md#code-snippets).

### Diagrams

Use diagrams generously. A newcomer's biggest problem is not knowing how the pieces fit together, and a diagram shows that at a glance where prose takes paragraphs. Aim for at least one diagram per lesson, and one for the chapter as a whole.

Pick the diagram for the question it answers:

| Question | Diagram |
| --- | --- |
| How do the parts connect? | Component or module diagram (`flowchart LR`) |
| What happens, in what order, with which decisions? | Flowchart with decision diamonds (`flowchart TD`) |
| Who calls whom during one request? | Sequence diagram (`sequenceDiagram`) |
| What states can this thing be in, and what moves it between them? | State diagram (`stateDiagram-v2`) |
| How is the data shaped? | Entity diagram (`erDiagram`) |
| How do values change over time? | A table of steps, or a timeline (`timeline`, `gantt`) |

Write diagrams in Mermaid inside `<pre class="mermaid">`. The course bundles Mermaid in `assets/mermaid.min.js` and `assets/diagrams.js` renders it, so diagrams work for a reader who is offline. Never load it from a CDN. Label every arrow with what flows along it. Use the code's real names on boxes so the reader can match the diagram to the code. Keep each diagram to about 12 boxes or fewer; split a bigger one into an overview and a detail. Follow each diagram with one or two sentences saying what to notice in it.

### Run-throughs on scratch data

Abstract explanations don't stick. Concrete numbers do. Every lesson about behaviour includes at least one run-through: a small, named example ("Asha borrows ₹1,00,000 on 10 Jan at 2% a month") traced step by step through the code, with a table showing the state after each step.

- **Run the real code to get the numbers.** Never work figures out by hand. Call the actual functions (a short Python script against the backend package, a test, or the running app on scratch data) and paste the results. Save the script in the chapter's `scripts/` folder (for example `003-the-ledger-engine/scripts/run_throughs.py`, run with `uv run` from `backend/`), and say in each step table's caption which script produced it, so a later editor can re-run it when the code changes.
- **Never touch real data.** `data/` and `backups/` hold the Lender's real database. Use pure functions where you can. If you need the database or the app, use a fresh temporary `DATA_DIR` and `BACKUP_DIR` on every command.
- **Cover the general run first, then the nuances.** Start with the plain, common case. Then give each edge case its own small variation of the same example, changing one thing at a time, and highlight what changed. Examples: a Payment made one day later, a month that ends on the 31st, a back-dated change, a voided Payment.
- **Predict before revealing.** For the nuance cases, ask the reader to predict the result first, then reveal it (the `reveal` component). Committing to a prediction is what makes the surprise stick.
- **Reuse characters.** Keep the same few example Customers and Mortgages across a chapter, and across chapters where it fits, so the reader isn't learning new scratch data every page.

## Retention

Reading feels like understanding, but recall is what lasts. Each lesson ends with a short quiz, and each chapter ends with `99-check-yourself.html`: questions mixed from all of its lessons, plus a **hands-on exercise in the real repo** ("run this test, change this value, predict what fails, then check"). The exercise gives the reader their first safe change in that area.

For quizzes, make every answer option the same length (in words, and characters where possible). Vary which position holds the correct answer. Don't give away the answer through formatting or order. Every option gets an explanation of why it is right or wrong.

## Knowledge sources

Ground every claim in this repo first: its code, tests, ADRs, `Documentation/GLOSSARY.md`, `CHANGELOG.md` and the published docs in `docs/`. Don't trust your memory of how this kind of code usually works; read how *this* code works. For general background (a framework, a library, a financial idea), find a high-quality external source, add it to `RESOURCES.md`, and cite it in the lesson. Each lesson recommends one source for further reading. That is usually the ADR or file behind the lesson.

Where a newcomer would go for help in real life: the ADRs, the glossary, the issue tracker (see `Documentation/agents/issue-tracker.md`), and the owner. Each chapter's overview ends with a reminder that the reader can ask an agent in this repo to explain anything that is unclear.

## Assets

Lessons are built from shared components in `Documentation/onboarding/assets/`. Reuse is the default. Before writing a chapter, read what's in `assets/` and use it. When a lesson needs something a later lesson could reuse (a new widget, a diagram style), add it to `assets/` rather than writing it inline. Every page links `assets/course.css`, so the whole course looks like one book.

## Before you commit

Check the chapter the way a new developer will meet it:

- Run `python <this skill>/scripts/check_refs.py Documentation/onboarding/<chapter>`. It confirms that every snippet's file exists, its line numbers are in range, and each numbered line still resembles the source line. Fix any line it flags.
- Every figure in a run-through came from running the code.
- Every page opens without errors, its diagrams render, and all links between lessons, reference pages and source files resolve.
- Every glossary term is used with its glossary meaning.
- Read one lesson as a newcomer would. Any sentence that needs knowledge the chapter hasn't given yet must be fixed.

## Notes

Record the owner's preferences about the course in `NOTES.md` (style, emphasis, things to avoid). Read it at the start of every run.

If the person running `/teach` is learning the material themselves rather than writing it for others, you can still record what they have shown they understand in `./learning-records/` (format: [LEARNING-RECORD-FORMAT.md](./LEARNING-RECORD-FORMAT.md)) and use it to decide what to teach next. This is optional and isn't needed for writing the course.
