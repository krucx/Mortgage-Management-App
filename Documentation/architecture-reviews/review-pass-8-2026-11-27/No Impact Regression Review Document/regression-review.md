# Architecture Pass 8 — No-Regression Review

**Verdict: No Impact Found.**

The pass-8 refactors (released in 3.6.2) cause no negative impact on the app and no
change in functionality users see. All test suites pass on current `main` (`bdea521`),
test coverage increased (not decreased), and the HTTP behaviour, money math, data model,
and user-facing flows are all preserved.

**Reviewed:** PRs #628, #629, #630, #631 (integration PRs) and their ticket PRs #615-#627
(tickets #602-#614), assessed against the review in PR #600.

**Method:** read-only code inspection, `gh pr diff`, `git diff`, `grep`, and test execution.
No code changes, no pushes, no PR comments.

---

## 1. HTTP Behaviour Unchanged

**Severity: None — No impact.**

The Refusal conversion (#603-#606) changed domain modules from raising
`HTTPException(status_code, detail)` to raising `Refusal(message, kind)`, with a single
exception handler in [`main.py:120-126`](../../../../backend/src/mortgage_backend/main.py#L120-L126) mapping:

| `Refusal.kind` | HTTP status | Before |
|:--|:-:|:--|
| `"unprocessable"` | 422 | `HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, …)` |
| `"conflict"` | 409 | `HTTPException(status.HTTP_409_CONFLICT, …)` |
| `"not_found"` | 404 | `HTTPException(status.HTTP_404_NOT_FOUND, …)` |

**Response shape is identical:** `{"detail": "<message>"}` with the same status code.

Evidence:
- [`test_refusal.py`](../../../../backend/tests/platform/test_refusal.py) asserts each kind produces the exact byte response (`b'{"detail":"<message>"}'`) at the correct status code.
- All 14 converted domain modules have zero remaining `HTTPException` references.
- The `unprocessable()` helper is fully removed — not imported or called anywhere.
- The [`test_http_boundary.py`](../../../../backend/tests/platform/test_http_boundary.py) guard test enforces that domain modules don't import FastAPI/Starlette.

**Remaining `HTTPException` sites** (15 total) are all at the HTTP boundary: route
handlers, FastAPI dependencies (`clock.py`), middleware (`upload_limit.py`), screen serving,
audit trails, backups, and read-only query modules (`dashboard`, `favours`, `projections`,
`simulation`, `customers`). These were not converted by design and remain unchanged.

**QA-Clock error message:** format is preserved as `"bad X-QA-Clock"` / `"bad X-QA-Clock-Now"`.
The internal refactor from `_parse_date`/`_parse_datetime` to `_qa_clock` + `_BadHeader`
produces the same `HTTPException(400, "bad <header>")`.

**Reminders:** `ReminderNotFound` and `ReminderRefused` custom exceptions are replaced by
`Refusal("…", "not_found")` and `Refusal("…", "conflict")`, matching the prior mapping in
`_answer()` which caught them and re-raised as `HTTP 404` and `HTTP 409` respectively. The
`_answer` wrapper's try/except is correctly removed. User notices nothing.

## 2. Write Lock — No Deadlocks, No Lost Writes, Uploads Still Work

**Severity: None — No impact.**

[`write_transaction()`](../../../../backend/src/mortgage_backend/platform/db.py#L302-L312) wraps `engine.begin()` + `BEGIN IMMEDIATE`. All 30 prior `engine.begin()` write sites
in domain code are replaced with `write_transaction(engine)`.

Evidence:
- [`test_write_transaction.py`](../../../../backend/tests/platform/test_write_transaction.py):
  - `test_two_writers_that_read_then_write…lose_no_update`: Two concurrent writers both read "0" and write +1; result is "2" (not "1"), proving no lost update.
  - `test_only_the_database_module_opens_a_transaction`: AST scan of all source files; no `.begin()` or `.commit()` outside `platform/db.py`.
- **Upload routes** (#630): The four async upload routes (`POST /mortgages/{id}/photos`, `PUT /customers/{id}/photo`, `PUT /customers/{id}/id-photos/{card}`, `POST /call-list/import`) changed from `async def` to `def` (run in worker thread pool). `await file.read()` → `file.file.read()`. This prevents event-loop stalling during contended waits.
  - `test_an_upload_waiting_for_the_write_lock_does_not_stall_other_requests` (4 routes parametrized): holds the lock, fires an upload, verifies the event loop wakes within 2s.
- The `make_engine` busy timeout is 30s (`connect_args={"timeout": 30}`), sufficient for SQLite single-writer queuing.
- No nested `write_transaction` calls within a single request path (verified by code inspection of all routes).

## 3. Closing Draft / CloseMortgage Move — Identical Behaviour

**Severity: None — No impact.**

**What moved:**
- `CloseMortgage.tsx` moved from `components/` to `pages/mortgage/CloseMortgage.tsx`.
- New [`useClosingDraft.tsx`](../../../../frontend/src/pages/mortgage/useClosingDraft.tsx) extracts the shared Closing-draft state (date, note, method, reference, amounts per Mortgage, the `Closing` body shape, and the confirmation dialog).
- [`WaiveChosen.tsx`](../../../../frontend/src/pages/closures/WaiveChosen.tsx) and [`ForfeitChosen.tsx`](../../../../frontend/src/pages/closures/ForfeitChosen.tsx) now call `useClosingDraft` instead of duplicating the logic.

**What stays the same:**
- All three closing kinds (redeem, waive, forfeit) build the same `Closing` request body shapes.
- The `rupeesToPaise` conversion, the `useClosing` hook, and the `confirmation` dialog with its `Summary` rows produce the same UI.
- The same fields (date, note, method, reference, amounts), the same validation (`entered` = all amounts filled), the same button labels, the same CSS classes.
- New tests: `closingDraft.test.tsx` and `ChosenClosures.test.tsx` cover the extracted logic.

**No routes changed:** The backend Closing endpoints were not touched at all.

## 4. `/api/health` and StartGate — App Starts Normally

**Severity: None — No impact.**

[`health.py`](../../../../backend/src/mortgage_backend/platform/health.py): The endpoint is unchanged from 3.6.1 (no diff). It returns `{"status": "ok", ...}` (200) or `{"status": "unavailable", ...}` (503).

[`StartGate.tsx`](../../../../frontend/src/components/StartGate.tsx#L12-L19): Now probes `/api/health` instead of `/api/payment-methods`. The `backendAnswers` function:
- Calls `client.GET('/api/health')`.
- Considers the backend up if the response body has both `status` and `database` fields (whether 200 or 503).
- A 503 Health (database unreachable, schema behind) counts as "running" — the app opens and shows what fails.
- A refused connection or proxy error page (no Health body) counts as "stopped".

**Windows scripts:** `Wait-Url` → `Wait-Health` in [`common.ps1`](../../../../windows/common.ps1). `install.ps1` and `run.ps1` now wait on `/api/health` instead of `/api/backups`. A 503 Health prints one yellow warning line but still counts as started.

**Tests added:** 4 new StartGate tests covering 503-Health scenarios (backend answers with a problem, bare 503 from proxy, JSON error from proxy).

## 5. Money Math and Data — Completely Unchanged

**Severity: None — No impact.**

- `git diff 97ad9b2..bdea521 -- backend/src/mortgage_backend/platform/money.py frontend/src/money.ts`: **empty** (zero changes).
- `git diff 97ad9b2..bdea521 -- backend/src/mortgage_backend/lending/ledger.py`: **empty** (zero changes).
- `git diff 97ad9b2..bdea521 -- backend/src/mortgage_backend/lending/replay.py`: only the `HTTPException` → `Refusal` change at line 502 (`Mortgage not found`); no calculation changes.
- `git diff 97ad9b2..bdea521 -- backend/src/mortgage_backend/payments/recording.py`: only `unprocessable()` → `Refusal(…, "unprocessable")` and `engine.begin()` → `write_transaction(engine)`.
- **No new migrations**: `git diff 97ad9b2..bdea521 -- backend/src/mortgage_backend/migrations/`: empty.
- **No schema changes**: no Column, Table, or Index additions or removals in `db.py`.

## 6. CI/Test Coverage — Increased, Not Decreased

**Severity: None — No impact.**

| Metric | 3.6.1 (`97ad9b2`) | 3.6.2 (`bdea521`) | Change |
|:--|:-:|:-:|:--|
| Backend test files | 68 | 72 | +4 added |
| Frontend test files | 49 | 52 | +3 added |
| Backend tests collected | (not measured) | 1169 | — |
| Frontend tests collected | (not measured) | 504 | — |
| Test files deleted | — | 0 | None removed |
| Test files renamed | — | 0 | None renamed |

**New test files (backend):**
- `test_write_transaction.py` — write lock seam, guard, upload stalling
- `test_http_boundary.py` — AST guard: domain modules don't use HTTPException
- `test_refusal.py` — Refusal → HTTP response shape
- `test_refusals.py` (lending) — domain refusal kinds and messages

**New test files (frontend):**
- `typedFakeServer.ts` + `typedFakeServer.test.ts` — typed fake backend (from api.gen.ts paths)
- `closingDraft.test.tsx` — the extracted Closing draft logic
- `ChosenClosures.test.tsx` — multi-Mortgage Waive and Forfeit flows

**Test changes in existing files:** Existing tests were updated to use `Refusal` instead of
`HTTPException` where they test domain logic directly (e.g. `test_photo_lifecycle.py` catching
`Refusal` instead of `HTTPException`). Some page tests switched from `fakeServer` to
`typedFakeServer`, changing route keys from `'GET /api/mortgages/7'` to
`'GET /api/mortgages/{mortgage_id}'`. No test assertions were weakened; several tests added
stricter byte-exact response body assertions.

**CI changes (#611, #612):**
- `classify.mjs` unifies the five path classifiers into one module; existing test coverage
  covers the new module (`test-critical-paths.mjs` expanded from 10 to ~25 test cases).
- Node test jobs folded into one job; the same test scripts still run.

## 7. Test Suite Results

```
Backend (pytest):  1169 passed, 0 failed, 859 warnings in 84.80s
Frontend (vitest): 504 passed (52 test files) in 17.20s
```

All warnings are the existing `SAWarning: Skipped unsupported reflection of expression-based index uq_mortgage_name` from SQLAlchemy, unchanged from before.

---

## Summary of Findings

| # | Area | Verdict | Severity | User Notices? |
|:-:|:--|:--|:-:|:-:|
| 1 | HTTP behaviour (Refusal conversion) | **No change** — identical status codes, response bodies | None | No |
| 2 | Write lock (BEGIN IMMEDIATE) | **No regression** — prevents lost updates, uploads off event loop | None | No |
| 3 | Closing draft / CloseMortgage move | **No change** — same forms, same fields, same flows | None | No |
| 4 | `/api/health` and StartGate | **No regression** — app starts normally, 503 handled correctly | None | No |
| 5 | Money math and data | **Zero changes** — no diff in money, ledger, replay, or schema | None | No |
| 6 | CI/test coverage | **Increased** — 7 new test files, 0 removed | None | No |
| 7 | Test suites | **All pass** — 1169 backend + 504 frontend | None | No |

No uncertain findings. The refactors are purely structural (internal module boundaries, shared
abstractions, and guard tests), with no change to the application's external behaviour.
