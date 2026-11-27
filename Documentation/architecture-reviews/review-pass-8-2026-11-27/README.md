# Architecture review, pass 8 (27 November 2026)

Mortgage-Management-App on `main` at `521c389` (`v3.6.1`). This pass comes after the refactor run
(issues #500 to #511), the bug run (#528) and the CI overhaul (#566 to #573). It was written with
the `improve-codebase-architecture` skill and the `codebase-design` vocabulary (module, interface,
depth, seam, adapter, leverage, locality). The skill's question and ticket steps were skipped, so
this is the report only. The visual version, with before and after diagrams, is
[Architecture review_ Mortgage-Management-App.html](./Architecture%20review_%20Mortgage-Management-App.html).

## Summary: top 5 findings

1. **The Closing draft is written three times (Strong, M).** `CloseMortgage.tsx` (426 lines),
   `closures/WaiveChosen.tsx` and `closures/ForfeitChosen.tsx` each turn their own fields into a
   `Closing`, each with its own "ready to Preview" rule and confirmation `Summary`. `useClosing`
   is deep, but its input is not. One Closing-draft module would make `CloseMortgage` the
   one-Mortgage case of the Closures page's form.
2. **Refusals are HTTP errors all the way down (Strong, M).** 30 backend modules raise FastAPI
   `HTTPException`, including `lending/replay.py` and `lending/refusals.py`. So the interface of
   the Ledger and change functions includes status codes, and `refusal_names_mortgage` rewrites
   `HTTPException.detail`. A domain `Refusal`, turned into HTTP by one handler in `create_app`,
   takes FastAPI out of the domain. The new `queries.py` modules already work this way.
3. **The repository's path rules are kept in five places (Strong, S).** `lib/critical-paths.mjs`,
   `changed-paths.mjs`, `check-changelog.mjs`, `lib/auto-merge-allowlist.mjs` and `CONTRIBUTING.md`
   each list paths. One of them has already drifted: `CONTRIBUTING.md:162` names
   `integration-summary.mjs`, which no longer holds the list. `test.yml`, the most-edited file
   since October apart from generated code, starts its runs on these lists. One path-classifier
   module, with the doc table checked against it, would fix that.
4. **Choosing a write transaction is every route's job (Worth exploring, S-M).** After #515, a
   read-then-write needs `write_transaction` (`BEGIN IMMEDIATE`, `platform/db.py:302`). Only 6 sites
   use it; 30 use `engine.begin()`, including `payments/recording.py:135`, which replays and then
   writes. Making the safe kind the only way to write moves that rule out of a docstring and into
   the interface.
5. **The page tests' fake backend is untyped (Worth exploring, S-M).** `frontend/tests/fakeServer.ts`
   keys answers by free strings and types them `unknown`. A renamed route or a changed response
   shape still passes all 33 page tests that use it. Keyed by `api.gen.ts` paths, the fake becomes a second
   adapter at the typed client's seam, so the seam is a real one.

Further candidates, ranked below them: (6) the Call Sheet import as its own module, out of
`CallListPage`; (7) a People query module, so `lending/queries.py` stops importing from a route
module.

## Scope and hot spots

From `git log --since=2026-10-01 --name-only`, leaving out generated `api.gen.ts`:

| Area | Touches | Notes |
| :--- | :-: | :--- |
| `frontend/src/index.css` | 65 | Now 715 lines, down from 1,786, after #502 and #506 |
| `frontend/src/api.ts`, `requests*` | 87 | Split by concept under `src/requests/` |
| `.github/workflows/test.yml` | 47 | 498 lines, 20 jobs |
| `backend/.../main.py` | 41 | Composition root; the router mounting is done (#508) |
| `NewPaymentPage` / `newPayment/` | 41 | Split in an earlier pass |
| `MortgagePage.tsx` | 33 | Split (#505); now 79 lines |
| `lending/replay.py`, `lending/changes.py` | 26 each | Deep; no candidate |
| `ClosuresPage.tsx`, `CloseMortgage.tsx` | 23, 20 | Candidate 1 |

## Settled since pass 7 (not reopened here)

- ADR 0022: the owner merges every `main` PR. ADR 0023: releases are fully automated after the
  trigger.
- Pass 7's top candidate landed: release logic lives in `release.mjs`, behind
  `github-adapter.mjs` and `fake-github-adapter.mjs`, which are two adapters, so the seam is real.
- From the strategic-vs-tactical review: one `/api` router (#508), `lending/queries.py` and
  `payments/queries.py` (#507), the request log (#501), `/api/health` (#509), `PageErrorBoundary`
  (#500), CSS modules (#502, #506), `useNumericId` (#510), and forms on `useProposedChange` (#511).
- ADR 0007: Preview routes stay hand-written. None of the candidates below generates them.

---

## Candidates

### 1. One Closing-draft module (Strong · in-process · M)

**Files**
- `frontend/src/components/CloseMortgage.tsx` (426 lines, 8 `useState`): the `closing` ternary is at
  `:73-111`, and the confirmations follow it
- `frontend/src/pages/closures/WaiveChosen.tsx` (161 lines) and `ForfeitChosen.tsx`
- `frontend/src/components/useClosing.tsx`, which is deep: it owns the Preview, confirm and save
  steps for each kind
- Used by `pages/RedeemPage.tsx` and `pages/mortgage/MortgageClosure.tsx`

**Problem.** `useClosing` takes a finished `Closing`, but building one is copied into each caller.
Each caller has its own `on` date, `note`, `method`, `reference` and amount fields. Each has its
own "ready" rule (for example, a Waive needs `received` to be filled in), its own date field
name (`redeemed_on`, `waived_on` or `forfeited_on`), its own rupees-to-paise conversion and its own
confirmation `Summary` rows. `CloseMortgage` is the one-Mortgage case of what the Closures page
does for many, yet it shares none of the draft code. It also sits in `components/` although only
two pages use it. A fix to how a Waive's Final Payment is described must be made in two places,
and its tests are spread across `closing.test.tsx`, `ClosuresPage.test.tsx` and `MortgagePage.test.tsx`.

**Deepening.** Add a Closing-draft module (`useClosingDraft(kind, mortgages)`, or a draft input
to `useClosing`). It owns the fields, the ready rule, the request body for each kind and the
confirmation rows, and gives back the field bindings plus what `useClosing` gives today.
`CloseMortgage` becomes a one-Mortgage render of it and moves to `pages/mortgage/`.
`WaiveChosen` and `ForfeitChosen` become renders of the many-Mortgage case.

**Benefits.** Locality: the Closing rules for each kind live in one place, beside `useClosing`.
Leverage: three callers, and a fourth when Redeem comes to the Closures page. Tests move to the
draft's interface ("a Waive with no amount gives no Closing", "a Forfeit body carries each
Mortgage's Recovered Amount"), and the page tests only check rendering.

**Size.** M: about 1 to 2 days, a net 200 to 250 fewer lines. Frontend only. No money-math paths.

### 2. Refusals as domain errors, mapped to HTTP once (Strong · in-process · M)

**Files**
- `backend/src/mortgage_backend/platform/errors.py` (`unprocessable` returns an `HTTPException`)
- `lending/refusals.py:19` (`refuse_unless_active` raises a 409) and `:43`
  (`refusal_names_mortgage` catches `HTTPException` and rewrites `.detail`)
- `lending/replay.py`, `lending/changes.py`, `lending/closing.py`, `payments/writes.py`,
  `payments/recording.py` and 23 more: 30 modules import `HTTPException` or `unprocessable`
  (42 `raise HTTPException`, 35 `unprocessable(`)
- `lending/previews.py:180-195`: a Preview is refused exactly when saving would be, because the
  same `HTTPException` propagates through `_preview`

**Problem.** The interface of the change functions (`record_payment`, `redeem_all`,
`edit_mortgage` and the rest) includes FastAPI status codes. Anything that calls them outside a
route has to know HTTP: the daily jobs, `reminders.sync`, the Simulation and future imports. The
backend tests assert `status_code == 422` on domain calls. `refusal_names_mortgage` changes a
framework object's field in place. The newest modules follow the opposite rule: `lending/queries.py`
says "No HTTP in here: a missing row is `None` … and the caller decides".

**Deepening.** Add a `Refusal(message, kind)` to `platform/errors.py`, where `kind` is
`unprocessable`, `conflict` or `not_found`. The domain raises it, and one
`app.exception_handler(Refusal)` in `create_app` turns it into the same JSON the frontend's
`errorMessage()` already reads. `refusal_names_mortgage` then works on `Refusal`. The change is
mechanical, file by file, because each `HTTPException` becomes a `Refusal` with the same message.

**Benefits.** Locality: one place decides how a refusal becomes HTTP. Leverage: the Ledger and
change functions can be used from jobs and scripts without FastAPI. Tests of the domain assert on
`Refusal`, and only the route tests see status codes. ADR 0007 is untouched, because Previews
still run the real change.

**Size.** M: mechanical across about 30 files, and the API's responses stay the same. Label it
`critical`, because it touches `lending/` and `payments/`.

### 3. One path classifier for CI and review rules (Strong · in-process · S)

**Files**
- `.github/scripts/lib/critical-paths.mjs`, whose header says "mirrored from CONTRIBUTING.md …
  Keep the two in step"
- `.github/scripts/changed-paths.mjs:19-32` (`BACKEND`, `FRONTEND`, `QA`, `IMAGE` and the script
  lists)
- `.github/scripts/check-changelog.mjs:6-22` (the paths that need no changelog fragment)
- `.github/scripts/lib/auto-merge-allowlist.mjs`
- `CONTRIBUTING.md:141-162`; line 162 says the paths are "mirrored in
  `.github/scripts/integration-summary.mjs`", but they moved to `lib/critical-paths.mjs` in #587
- `.github/workflows/test.yml` (498 lines, 20 jobs; the `version-bump` required check runs five
  unrelated script tests)

**Problem.** Five lists each answer a question about a changed path: is it product code, which
critical area is it in, which CI job groups does it start, may Dependabot merge it, does it need a
changelog fragment? Each list is shallow and lives beside its one caller. The docs copy is
already wrong. A new top-level folder means editing three of the lists and remembering the
fourth and fifth.

**Deepening.** Add one `lib/paths.mjs` with `classify(path)`, which returns
`{ product, criticalAreas, jobGroups }`. The current scripts become callers of it.
`test-paths.mjs` checks every row of the CONTRIBUTING critical-areas table against `classify`,
so the docs can't drift silently. While in there, replace the hand-listed `node --test` jobs
with one job that runs `.github/scripts/test-*.mjs`. Keep the required check names
(`version-bump` and the others in `.github/rulesets/main.json`) or change them in the same PR.

**Benefits.** Locality: one table of paths. Leverage: every CI rule asks the same question the
same way. Tests: one table-driven test replaces the path cases in four separate tests.

**Size.** S: about half a day. Not `critical`, since only `.github/scripts` and docs change,
unless the ruleset's check names change.

### 4. The safe write transaction as the only write (Worth exploring · local-substitutable · S-M)

**Files**
- `backend/src/mortgage_backend/platform/db.py:302` (`write_transaction`: `BEGIN IMMEDIATE`, added
  for #515 in #528)
- 6 `write_transaction` sites (reminders, message settings, `changes.py:338`, `dashboard.py:284`,
  `main.py:84`) against 30 `engine.begin()` sites in 17 files, for example
  `payments/recording.py:135` (replays, refuses, then writes) and `follow_up/call_list.py:227`
- 54 `engine.connect()` read sites

**Problem.** #515 showed that a read-then-write in an ordinary deferred transaction can lose a
concurrent write or fail with a 500 under parallel load. The fix is a docstring rule ("for one
that reads and then writes on what it read"), so every route author must classify their own
transaction. Most `engine.begin()` sites do read then write: recording a Payment replays the
Mortgage before it writes. A single Lender rarely runs two writers at once, but the QA suite
does, and the rule is invisible at the call site.

**Deepening.** Make `write_transaction` the only way to write: either an `EngineDep` wrapper whose
`write()` always takes the write lock, or a test that fails on `engine.begin()` outside
`platform/db.py`. Reads stay on `engine.connect()`.

**Benefits.** Locality: the concurrency rule lives in `db.py`. A parallel-writers test at that
seam (two writers reading and then writing) covers every route once. Cost: writers queue
behind each other, which on a one-Lender SQLite book is free.

**Size.** S-M: mostly mechanical. `critical` (`platform/db.py`). First check that no route relies
on `engine.begin()` committing a read-only path cheaply.

### 5. A typed fake backend for page tests (Worth exploring · in-process · S-M)

**Files**
- `frontend/tests/fakeServer.ts` (33 lines): `fakeServer(routes: Record<string, unknown>)`, keyed
  by `"METHOD /api/path"`
- The 33 page tests that use it, for example `NewPaymentPage.test.tsx` (40 KB) and
  `MortgagePage.test.tsx` (33 KB)
- `frontend/src/api.gen.ts` (the generated `paths`)

**Problem.** The typed client is the frontend's seam with the backend, and the fake is its test
adapter. But the fake checks nothing at that seam. A route renamed in `api.gen.ts`, or a response
field dropped, still passes the page tests, because the fake answers whatever string it was
given, with whatever shape. The strategic-vs-tactical testing review asked for this (its
recommendation 4), and it has not been started.

**Deepening.** Type `fakeServer`'s routes from `paths`: the key is a method plus a path template,
and the answer is that operation's 200 response, or a function of the request that returns one.
The production client and the typed fake are then two real adapters at one seam. Move the tests
over one at a time, since the untyped form can stay during the move.

**Benefits.** API drift fails `tsc` in the tests, not in QA. The fixtures document the contract.

**Size.** S-M: the types take about a day, and moving the tests can be gradual.

### 6. The Call Sheet import, out of `CallListPage` (Worth exploring · in-process · S)

**Files**
- `frontend/src/pages/CallListPage.tsx` (456 lines): `CallSheet`, `ImportPreview` and
  `NotImportedRows` at `:168-370`, with 5 `useState` hooks of their own
- `backend/.../follow_up/call_sheets.py:422` (`preview_import`)

**Problem.** The page holds two concepts: the Call List table, and the Call Sheet export and import
(choose a file, preview it, confirm, list what was not imported). The import flow is its own
state machine, but it can only be tested by rendering the whole Call List.

**Deepening.** Move it to `pages/callList/CallSheet.tsx` with a `useCallSheetImport` behind it,
following the `pages/closures/` pattern. The page renders `<CallSheet />`.

**Size.** S. This is the next monolith in the frontend review's list. `NewMortgagePage` (404 lines)
is the other one, but it is already on `useProposedChange`, and its remaining size is mostly form
markup.

### 7. A People query module (Speculative · local-substitutable · S)

**Files**
- `people/customers.py` (14 query builders, routes in the same file) and
  `people/customer_changes.py` (16)
- `lending/queries.py:16`, which imports `phone_fragment` from `people/customers.py`, a route module

**Problem.** #507 gave Lending and Payments their query modules, but People's shared queries
(search by name or phone, `owner_of`, Customers sharing a phone) stayed in the route module, and
Lending reaches into it. Most of People's other SQL is single-use, so moving it all would fail
the deletion test.

**Deepening.** Only the shared part: `people/queries.py`, holding `phone_fragment`,
`_customer_matches`, `owner_of` and `_customers_sharing_a_phone`. Leave single-use SQL where it is.

**Size.** S. Low value on its own. Do it the next time Customer search changes.

---

## Smaller leftovers (not candidates)

- The health probe isn't used by every starter: `windows/run.ps1:57` and `windows/install.ps1:179`
  wait on `/api/backups`, and `StartGate.tsx:13` probes `/api/payment-methods`. Point them at
  `/api/health`.
- Lending and Payments still import each other (`payments/recording.py:11` →
  `lending.closing.close_redeemed`, and `lending/closing.py:36` → `payments.writes`). The import
  order is safe, and the coupling is real in the domain: a Final Payment closes a Mortgage. No
  candidate until a third caller appears.
- `backend/pyproject.toml:22` still pins `uv_build` to `<0.13.0`.

## Top recommendation

Start with **candidate 1, the Closing draft**. It is in one of the most-changed parts of the
frontend (`ClosuresPage` and `CloseMortgage`, 43 touches since October), touches no money-math
path, and finishes the forms work that #511 started. It also clears the last page-specific
component out of `components/`. **Candidate 3** is the cheapest next step, and it removes a doc
drift that already exists. **Candidate 2** has the most leverage in the backend, but it is
`critical` and wide, so give it its own PR.
