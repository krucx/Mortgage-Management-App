# Chapter and Lesson Format

How to lay out the pages of one chapter. Read this before writing a chapter.

## Contents

- [Chapter folder](#chapter-folder)
- [Chapter overview page](#chapter-overview-page-indexhtml)
- [Lesson page](#lesson-page)
- [Check-yourself page](#check-yourself-page-99-check-yourselfhtml)
- [Components](#components): page shell, code snippets, diagrams, step tables, quizzes, reveals, callouts
- [Length](#length)

## Chapter folder

```
003-the-ledger-engine/
├── index.html               overview: problem, map, lessons, prerequisites
├── 01-why-replay.html
├── 02-one-day-in-the-replay.html
├── 03-interest-to-date.html
├── 04-closing-a-mortgage.html
├── 99-check-yourself.html
└── scripts/                 the scratch-data scripts that produced every figure
    └── run_throughs.py
```

Pages link to the shared assets with `../assets/...` and to the source with a relative path from the page to the repo file, for example `../../../backend/src/mortgage_backend/lending/ledger.py` (the course sits at `Documentation/onboarding/`, three levels below the repo root).

## Chapter overview page (`index.html`)

In this order:

1. **Kicker and title.** `Chapter 003` and the chapter name.
2. **The problem this part of the app solves.** One or two paragraphs in business terms, then what goes wrong without it.
3. **What you'll be able to do.** Three to five concrete abilities ("trace a Mortgage's Ledger by hand", "say which file to change to add a new Closure").
4. **Before you start.** The earlier chapters this one builds on, linked.
5. **The map.** One diagram of the whole area: the modules or files, how they connect, and where each lesson sits on it.
6. **Where it lives.** A table of the files this chapter covers: path (linked), what it's responsible for, which lesson covers it.
7. **Lessons.** Numbered list linking each lesson, each with a one-line summary.
8. **Footer.** "Written against commit `abc1234`", a reminder to ask an agent in the repo about anything unclear, and links back to the course home and the next chapter.

## Lesson page

In this order, following the arc in SKILL.md:

1. **Kicker and title.** `Chapter 003 · Lesson 2` and a title that says what the lesson is about.
2. **Lede.** One or two sentences that frame the question this lesson answers.
3. **By the end** callout. The single thing the reader will be able to do.
4. **The problem.** The concrete situation that makes this code necessary. Show the naive approach and why it fails when that helps.
5. **The idea.** The solution in plain words, before any code.
6. **The flow.** A diagram, followed by one or two sentences on what to notice.
7. **The code.** One or more line-numbered snippets, each followed by an explanation of the marked lines.
8. **Run-through.** The general case on scratch data, as a step table.
9. **Nuances.** Each edge case as a variation of the same example: predict, then reveal. Link the ADR for each rule.
10. **Quiz.** Two to four questions.
11. **Go deeper.** The one file or ADR to read next, and which lines to start at.
12. **Nav.** Previous / chapter overview / next.

Not every lesson needs every section. A lesson about project layout may have no run-through, but it will have a diagram and code. Leave a section out only when it truly has nothing to say.

## Check-yourself page (`99-check-yourself.html`)

1. Six to ten quiz questions mixed from every lesson in the chapter (interleaved, not in lesson order), including at least two that need a small trace on scratch data.
2. One **hands-on exercise** in the real repo, with exact commands: run a specific test, make a small change, predict the result, run it again. Say how to undo the change (`git checkout -- <file>`).
3. A short **recap**: the chapter's key ideas as a bullet list, each linked to its lesson.
4. A link to the chapter's cheat sheet in `../reference/`.

## Components

All of these come from `assets/`. Read `assets/` before writing; it may have grown since this file was written.

### Page shell

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>3.2 · One day in the replay</title>
<link rel="stylesheet" href="../assets/course.css">
</head>
<body>
<p class="kicker">Chapter 003 · Lesson 2</p>
<h1>One day in the replay</h1>
<p class="lede">…</p>
…
<script src="../assets/quiz.js"></script>
<script src="../assets/snippet.js"></script>
<script src="../assets/mermaid.min.js"></script>
<script src="../assets/diagrams.js"></script>
</body>
</html>
```

### Code snippets

Write the snippet with the real source line number at the start of each line, then two spaces, then the code. A line that is just `⋮` (optionally followed by a short note) marks skipped lines. `snippet.js` turns the numbers into a gutter that can't be selected, so the reader can copy the code cleanly.

```html
<figure class="snippet">
<figcaption>
  <a href="../../../backend/src/mortgage_backend/lending/ledger.py">lending/ledger.py</a>
  · <code>accrue_through()</code> · lines 260–301, trimmed
</figcaption>
<pre data-file="backend/src/mortgage_backend/lending/ledger.py"><code>260  while (on := accrual_date(start, n)) &lt;= day:   # one pass per Accrual Date
261      month_terms = terms_from(previous_accrual_date)
⋮    … skip dates before the Mortgage started …
268      pay_through(on - 1 day)                    ①
270      interest = monthly_interest(month_start_principal, month_terms)   ②
271      unpaid += interest
274      month_start_principal = principal          ③
276      pay_through(on)                            ④
</code></pre>
</figure>
<ol class="marks">
  <li>Payments made before today are applied first.</li>
  <li>…</li>
</ol>
```

Rules:

- `data-file` is the path from the repo root. `scripts/check_refs.py` reads it to check the line numbers. Every numbered line must exist in that file, and should share at least one name with the real line. A line you paraphrased heavily still needs its real line number, but keep its key names so the check passes.
- Line numbers must go up within a snippet: show the lines in source order. To show code from two places in a file, or out of order, use two snippets.
- Annotations go after the code: a comment in the file's own language (`# …` in Python, `// …` in TypeScript, preceded by a space), a circled number ①, or the `◀` marker. The checker ignores them when comparing to the source.
- Escape `<`, `>` and `&` in the code (`&lt;`, `&gt;`, `&amp;`).
- To highlight a line, end it with `  ◀`. `snippet.js` strips the marker and highlights the line.
- For a snippet that is pure illustration and not real code (for example, a naive design that the app rejected), leave out `data-file` and the line numbers, and caption it "Illustration, not from the codebase".

### Diagrams

```html
<figure class="diagram">
<pre class="mermaid">
flowchart LR
  UI[frontend page] -->|HTTP JSON| API[FastAPI route]
  API -->|facts| Replay[replay.py]
  Replay -->|LedgerStep list| API
</pre>
<figcaption>Every money figure is computed on request, never stored.</figcaption>
</figure>
```

`diagrams.js` renders every `pre.mermaid` with the bundled `assets/mermaid.min.js`, so diagrams work offline and straight from `file://`. Load both as classic scripts (not `type="module"`: browsers block module scripts on `file://` pages). Don't link Mermaid from a CDN. Inside `pre.mermaid`, write `-->` as is; only a literal `<` in a label needs escaping.

### Step tables

The standard way to show a run-through: one row per step, one column per piece of state, and the row where the nuance bites marked `class="changed"`.

```html
<table class="steps">
<tr><th>Date</th><th>Step</th><th>Amount</th><th>Principal</th><th>Unpaid interest</th></tr>
<tr><td>10 Feb</td><td>interest</td><td>2,000</td><td>1,00,000</td><td>2,000</td></tr>
<tr class="changed"><td>10 Mar</td><td>payment</td><td>52,000</td><td>52,000</td><td>0</td></tr>
</table>
<p class="cite">Figures from <code>scripts/run_throughs.py</code>, which runs the real <code>compute_ledger</code>, at commit abc1234.</p>
```

### Quizzes

```html
<div class="quiz" data-answer="2">
  <p class="q">A Payment lands on an Accrual Date. Which Principal is next month charged on?</p>
  <button class="opt">The Principal after that day's Payment</button>
  <button class="opt">The average Principal over the month</button>
  <button class="opt">The Principal before that day's Payment</button>
  <div class="why">…why the right answer is right, and why each wrong one is wrong…</div>
</div>
<p><span class="score"></span></p>
```

`data-answer` is the 0-based index of the right option.

### Reveals

```html
<div class="reveal">
  <p><strong>Predict:</strong> …the question…</p>
  <button class="show">I've made my prediction. Show me.</button>
  <div class="reveal-body">…the answer, usually a step table…</div>
</div>
```

### Callouts

- `<div class="callout win">`: the "By the end" box.
- `<div class="callout">`: a rule worth remembering ("Rule A: …").
- `<div class="callout warn">`: a trap that newcomers fall into.
- `<p class="aside">`: a side note that can be skipped.
- `<dfn class="term" title="definition">Accrual Date</dfn>`: a glossary term at its first use, with a hover definition, linked to `../reference/glossary.html#accrual-date`.

## Length

A lesson should take 10 to 15 minutes to read and work through. If it runs longer, it is probably two lessons. A chapter is 3 to 6 lessons. Anything bigger is two chapters; split it in `SYLLABUS.md`.
