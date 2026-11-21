# Architecture Review: Testing Strategy, QA Infrastructure, CI/CD, and Overall Coherence

**Repository:** `krucx/Mortgage-Management-App`  
**Date:** November 2026  
**Target:** Architecture Review (Focus on Testing, QA, CI/CD, Conventions, Security, Cross-Cutting Concerns, and Overall Coherence)

---

## Executive Summary & Scorecard

Mortgage Management is an offline-first, single-tenant desktop web application built specifically for a single jewellery lender operating on their own laptop. The system architecture pairs a FastAPI backend serving both API and static assets with a React SPA (PWA), backed by SQLite, integrated with a custom Windows OS protocol handler (`mortgage-management://`), and deployable either natively on bare metal or via Docker.

This evaluation reviews eight key architectural dimensions. Overall, the repository demonstrates a remarkably high standard of architectural discipline, domain modeling, and engineering craftsmanship. It is governed by 21 Architectural Decision Records (ADRs), an authoritative domain glossary, strict contribution gates, and an advanced testing pyramid.

| # | Evaluation Dimension | Rating | Key Highlights & Architectural Strengths | Key Gaps & Vulnerabilities |
|---|----------------------|--------|------------------------------------------|----------------------------|
| 1 | **Testing Strategy** | **STRATEGIC** | Coherent multi-tiered pyramid; pure calculation isolation (`ledger.py`); strict CI coverage gates (90% backend, 80% frontend); mechanical screen coverage check. | Heavy reliance on mock fetch (`fakeServer.ts`) for frontend page tests rather than contract integration mocks. |
| 2 | **QA Infrastructure** | **STRATEGIC** | 3-tier containerized stack (`qa-golden`, `qa-fresh`, `qa-work`); scratch volume safety guards; Playwright-BDD with rich domain language; time travel clock synchronization. | Long test execution time for full Gherkin suite; local execution requires developer discipline. |
| 3 | **CI/CD Pipeline** | **STRATEGIC** | Multi-platform staged workflows (Ubuntu, Windows Pester); commit-pinned actions; automated changelog collation; automated CVE/Secret scanning to GitHub Issues. | E2E QA job skipped on regular PRs to save runner minutes, relying on developer local execution. |
| 4 | **Project Structure & Conventions** | **STRATEGIC** | 1:1 mirrored domain package structure; rigorous GLOSSARY with forbidden synonyms; dual doc hierarchy (`docs/` vs `Documentation/`); AGENTS steering. | Large single-file models in certain domain areas (e.g., `lending/mortgages.py`). |
| 5 | **Error Handling & Observability** | **MIXED** | Detailed domain audit logging with field diffs (`audit.py`); typed 422 unprocessable refusals; structured client-side error parsing (`serverState.ts`). | Near-total absence of application logging across routes; no global 500 handler; no React ErrorBoundary in frontend. |
| 6 | **Security Patterns** | **STRATEGIC** | Pragmatic local-first threat model; DNS rebinding defense (`LocalOnly`); CSRF origin validation; 20 MB streaming cap (`UploadLimit`); strict photo sanitization; Aadhaar PII masking; AES-encrypted backups. | No rate limiting on local endpoints (low risk for single-tenant local app). |
| 7 | **Cross-Cutting Concerns** | **MIXED** | Exemplary unified patterns for transactions, migrations, paging, sorting, clock pinning, and OpenAPI code generation. | Logging and render error boundary patterns are omitted or ad-hoc. |
| 8 | **Overall Coherence** | **STRATEGIC** | Textbook domain-driven design; pure functional calculation engine (ADR 0001); 21 living ADRs; iterative architectural review culture (7 passes). | Minor drift potential in error boundaries and diagnostic telemetry. |

---

## 1. Testing Strategy

### Rating: STRATEGIC

The testing strategy is intentionally constructed as a robust pyramid spanning pure unit logic, database-backed integration, component-level UI interaction, full-stack browser end-to-end BDD, and Windows host automation.

```
                  ▲
                 / \
                /   \     E2E / QA (Playwright-BDD on Docker QA Stack)
               / E2E \    + Windows Native Pester Setup/Upgrade Tests
              /-------\
             /         \
            /  INTEGR.  \   Backend Route Tests (FastAPI TestClient + SQLite)
           /             \  Frontend Page Tests (Vitest + React Testing Library)
          /---------------\
         /                 \
        /    UNIT / LOGIC   \  Pure domain algorithms (ledger, money, format, allocate)
       /_____________________\ Zero I/O, deterministic, exhaustive edge cases
```

### Key Strengths & Architecture References

1. **Pure Domain Logic Isolation (Base of Pyramid):**
   - The financial core of the app—calculating interest, handling part-month rules (pro-rata, full month, none), annual/monthly compounding, and advance allocations—is decoupled from database transactions and framework dependencies.
   - [backend/src/mortgage_backend/lending/ledger.py](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/backend/src/mortgage_backend/lending/ledger.py#L1-L150) defines `compute_ledger()`, `accrual_date()`, and `months_unpaid()`.
   - [backend/tests/lending/test_ledger.py](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/backend/tests/lending/test_ledger.py#L30-L55) rigorously tests leap year day-clamping (e.g., Jan 31 -> Feb 29 -> Mar 31), interest capitalisation, and allocation cascades without spinning up SQLite or FastAPI.
   - Frontend unit tests mirror this: [frontend/tests/allocate.test.ts](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/frontend/tests/allocate.test.ts), [money.test.ts](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/frontend/tests/money.test.ts), and [terms.ts](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/frontend/src/terms.ts).

2. **Database & API Integration Tests:**
   - In [backend/tests/conftest.py](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/backend/tests/conftest.py#L15-L35), every test runs against a clean SQLite database generated on a fresh `tmp_path`, initialized via Alembic `migrate()`.
   - Tests execute real SQL queries against SQLite, ensuring unique constraints, foreign keys (`PRAGMA foreign_keys = ON`), indices, and transaction rollbacks function properly.
   - Fast execution using `pytest-xdist` (`-n auto`).

3. **Strict, Mechanically Enforced Coverage Thresholds:**
   - CI enforces strict line coverage gates:
     - Backend: **90% line coverage** minimum ([.github/workflows/test.yml](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/.github/workflows/test.yml#L125-L135)).
     - Frontend: **80% line coverage** minimum ([.github/workflows/test.yml](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/.github/workflows/test.yml#L160-L168)).
   - Evaluated by a custom script [.github/scripts/coverage-summary.mjs](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/.github/scripts/coverage-summary.mjs) that outputs GitHub job step summaries.

4. **100% Router Screen Coverage Gate:**
   - [.github/scripts/check-screen-coverage.mjs](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/.github/scripts/check-screen-coverage.mjs#L1-L60) scans all `<Route>` declarations in [frontend/src/App.tsx](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/frontend/src/App.tsx#L45-L75) and verifies that every single route is tagged with `@screen:<route>` in at least one Gherkin feature file in `qa/features/` or explicitly listed in a tracking file under `qa/screens-to-cover/<issue>.txt`.
   - This ensures that UI routes cannot be created or modified without corresponding E2E user flow tests.

---

## 2. QA Infrastructure

### Rating: STRATEGIC

The QA infrastructure is a showcase of strategic engineering designed to test the real application in production-identical conditions while strictly safeguarding developer worktrees and production data.

```
                           +----------------------------------------+
                           |             scripts/qa-stack.sh         |
                           +-------------------+--------------------+
                                               |
                                     spawns docker-compose.qa.yml
                                               |
         +-------------------------------------+-------------------------------------+
         |                                     |                                     |
         v                                     v                                     v
+------------------+                  +------------------+                  +------------------+
|    qa-golden     |                  |     qa-fresh     |                  |     qa-work      |
| (golden_book.py) |                  |   (empty data)   |                  |  (test-mutated)  |
| Read-only book   |                  | Zero-state & 1st |                  | Scenarios seed   |
| Last day: Nov 15 |                  | run verification |                  | own customers    |
+--------+---------+                  +--------+---------+                  +--------+---------+
         ^                                     ^                                     ^
         |                                     |                                     |
         +-------------------------------------+-------------------------------------+
                                               |
                                      driven via Playwright
                                               |
                                     +---------+---------+
                                     |     qa-runner     |
                                     |  (playwright-bdd) |
                                     +-------------------+
```

### Key Strengths & Architecture References

1. **Three-Tier Container Isolation ([docker-compose.qa.yml](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/docker-compose.qa.yml#L1-L85)):**
   - **`qa-golden`**: Pre-seeded with a comprehensive historical book ([qa/fixtures/golden_book.py](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/qa/fixtures/golden_book.py)). Used exclusively by `@golden` scenarios to verify complex reports, filtering, and summaries without modifying data.
   - **`qa-fresh`**: Started completely empty to verify zero-state screens, initial database migrations, and first-run backup creation.
   - **`qa-work`**: Starts empty; scenarios that create, edit, or void records seed their own records on this instance, preventing test cross-talk.
   - **Safety Guard:** [scripts/qa-stack.sh](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/scripts/qa-stack.sh#L45-L55) strictly validates that mounted directories do not point to the real lender directories declared in `.env`:
     ```sh
     [ "$dir" != "$real" ] || die "$dir is a folder .env uses for the Lender's real data"
     ```
   - **Network Alias / Chromium HSTS Preload Handling:** `docker-compose.qa.yml` notes that `app` is a TLD on Chromium's HSTS preload list (forcing HTTPS on `http://app`), so instances are aliased to `qa-golden`, `qa-fresh`, and `qa-work`.

2. **Domain-Driven Test Fixtures & Time Travel:**
   - In [qa/steps/lender.ts](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/qa/steps/lender.ts#L30-L75), the `Lender` class synchronizes time travel across both the browser and backend:
     ```ts
     await this.page.clock.setFixedTime(new Date(`${day}T10:30:00`));
     await this.page.setExtraHTTPHeaders({ 'X-QA-Clock': day });
     ```
   - When the backend receives `X-QA-Clock` in `QA_MODE=true` ([backend/src/mortgage_backend/main.py](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/backend/src/mortgage_backend/main.py#L90-L98)), it sets the request date and automatically executes daily jobs (e.g., reminders, backups) for that virtual date.
   - Strict read-only enforcement: `Lender.post()` and `Lender.put()` throw an exception if called during a `@golden` scenario, preventing pollution of the golden book.

3. **Scenario Depth & Real User Flows:**
   - Across 2,464 lines of Gherkin ([qa/features/](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/qa/features/)), tests cover nuanced real-world business flows:
     - [qa/features/advances.feature](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/qa/features/advances.feature#L25-L65): Advance instalments maturing over months, partial cancellation, separate receipts.
     - [qa/features/closures.feature](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/qa/features/closures.feature#L5-L45): Redemption taking off advance held, reopen restoring held advances, waiver refusing unallocated advances.
     - [qa/features/payments.feature](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/qa/features/payments.feature#L45-L75): Voiding payments with mandatory reason kept in audit history.
   - Step definitions follow strict deduplication enforced by `npm run check-steps` ([qa/README.md](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/qa/README.md#L10-L20)).

---

## 3. CI/CD Pipeline

### Rating: STRATEGIC

The GitHub Actions workflows are structured, staged, and security-hardened. Rather than an ad-hoc collection of scripts, the pipeline implements a rigorous release lifecycle governed by ADR 0018 and ADR 0019.

### Key Strengths & Architecture References

1. **Workflow Architecture & Governance:**
   - **`test.yml`** ([.github/workflows/test.yml](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/.github/workflows/test.yml)): Main CI gate. Runs on every push and PR.
     - Concurrency groups with `cancel-in-progress: true` for PRs.
     - Unit test suites for internal CI automation scripts (`test-release-candidate.mjs`, `test-check-version-unchanged.mjs`, `test-coverage-summary.mjs`).
     - Mechanical verification that non-release PRs do not edit `VERSION` and supply changelog fragments under `changelog/unreleased/`.
     - Static checks: `ruff check`, `ruff format --check`, `mypy --strict`, ESLint/oxlint, Prettier.
     - Image smoke test: Builds the production container, spins it up on scratch volumes, tests non-root execution (`id -u != 0`), checks cache headers (HTML `no-cache`, assets `public, max-age=31536000, immutable`), and triggers backup generation via API.
   - **`windows` Matrix Job** ([.github/workflows/test.yml](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/.github/workflows/test.yml#L240-L315)): Runs on `windows-latest`. Executes PowerShell Pester tests ([windows/tests/Launcher.Tests.ps1](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/windows/tests/Launcher.Tests.ps1)), tests host-mode setup (`windows/setup.ps1 -Mode local`), verifies directory junction switching on upgrades, and tests clean uninstallation while retaining the latest backup zip.

2. **Release Lifecycle & Automation (ADR 0018):**
   - Release tags are **never** pushed manually.
   - Release owner triggers [.github/workflows/release-candidate.yml](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/.github/workflows/release-candidate.yml) via `workflow_dispatch`.
   - The workflow consolidates `changelog/unreleased/*.md` into `CHANGELOG.md`, bumps `VERSION`, runs tests, and opens a `release/X.Y.Z` pull request.
   - When merged by a human (agents are strictly forbidden from approving or merging per [AGENTS.md](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/AGENTS.md#L12-L17)), [.github/workflows/publish-release.yml](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/.github/workflows/publish-release.yml) creates the version tag and dispatches [.github/workflows/release.yml](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/.github/workflows/release.yml), publishing Docker Hub images and creating GitHub Releases with Windows installation archives.

3. **Security Automation & Alert Reconciliation:**
   - All third-party GitHub Actions are pinned to full commit SHAs with semantic version comments (e.g., `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`). Top-level permissions default to `permissions: {}`.
   - Security scanning via CodeQL ([.github/workflows/codeql.yml](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/.github/workflows/codeql.yml)) and Trivy container vulnerability scanning ([.github/workflows/trivy.yml](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/.github/workflows/trivy.yml)).
   - In accordance with ADR 0016, automated reconcilers ([.github/workflows/critical-findings.yml](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/.github/workflows/critical-findings.yml) and [secret-scanning-alerts.yml](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/.github/workflows/secret-scanning-alerts.yml)) parse findings and open/close tracking GitHub issues automatically.

---

## 4. Project Structure & Conventions

### Rating: STRATEGIC

The project structure is organized by business subdomain rather than technical layers, creating deep modules and strong conceptual boundaries.

### Key Strengths & Architecture References

1. **Domain-Centric Package Organization:**
   - Both backend and backend tests mirror the core domain structure:
     - `collateral`: Pledged jewelry, photos, manual valuation.
     - `follow_up`: Call lists, reminders, notes, click-to-send messages.
     - `lending`: Mortgages, terms, rate changes, closures, projections, derived ledger calculation.
     - `payments`: Cash receipts, allocations, advances, grace periods, cash limits.
     - `people`: Customers, referrers, identity photos (PAN/Aadhaar).
     - `platform`: Database, clock, paging, upload limits, screen serving, host checks.
     - `safekeeping`: Backups, encryption, audit log.
   - Frontend components and pages map directly to these concepts (`MortgagesPage`, `PaymentPage`, `CustomerFormPage`, `ClosuresPage`, `RemindersPage`).

2. **Domain Glossary & Ubiquitous Language:**
   - [Documentation/GLOSSARY.md](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/Documentation/GLOSSARY.md) defines canonical terms and explicitly lists forbidden synonyms:
     - *Lender* (avoid: loaner, loanee, user, admin)
     - *Customer* (avoid: borrower, loanee, client)
     - *Mortgage* (avoid: loan, pledge, item)
     - *Primary Number* (avoid: customer ID, main phone)
     - *Accrual Date* (avoid: due date, interest date)
   - [CODING_STANDARDS.md](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/CODING_STANDARDS.md#L8-L15) establishes that user-visible copy must use glossary terms and that the module owning a concept decides its rules.

3. **Strict Documentation Hierarchy:**
   - Clean separation enforced by [AGENTS.md](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/AGENTS.md#L45-L53):
     - `docs/`: User-facing documentation published to GitHub Pages for the Lender (install guides, walkthroughs, screenshots). No internal design material allowed.
     - `Documentation/`: Internal developer engineering docs (`adr/`, `agents/`, `architecture-reviews/`, `proposals/`).

---

## 5. Error Handling & Observability

### Rating: MIXED

While domain error handling and audit logging are implemented thoughtfully, application observability, structured operational logging, and frontend crash containment exhibit noticeable gaps.

### Detailed Findings & References

1. **Audit Logging vs Application Logging:**
   - **Strength:** [backend/src/mortgage_backend/safekeeping/audit.py](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/backend/src/mortgage_backend/safekeeping/audit.py#L50-L100) records every create, edit, void, and closure for customers, mortgages, and payments. Each record logs the exact field diff (old value, new value), timestamp, and note.
   - **Gap:** Python `logging` is almost nonexistent. Only `daily_run.py` and `backups.py` import `logging`. There is no request logging middleware, no structured JSON logging, and no correlation IDs. Route handlers execute completely silently. If an unexpected 500 occurs, Starlette writes a raw Python traceback to stderr, but no contextual operational logs exist.

2. **HTTP Error Formulation:**
   - **Strength:** In [backend/src/mortgage_backend/platform/errors.py](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/backend/src/mortgage_backend/platform/errors.py#L6-L10), `unprocessable(message: str)` standardizes 422 errors for business rule refusals.
   - **Strength:** In [frontend/src/serverState.ts](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/frontend/src/serverState.ts#L10-L45), `errorMessage()` cleanly translates FastAPI/Pydantic validation errors (`loc`, `msg`) and custom detail dictionaries into human-readable strings for the Lender.
   - **Gap:** There is no global `@app.exception_handler(Exception)` registered in [main.py](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/backend/src/mortgage_backend/main.py). Unexpected server exceptions leak default Starlette internal server error structures.

3. **Frontend Crash Containment:**
   - **Strength:** [frontend/src/components/NotLoaded.tsx](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/frontend/src/components/NotLoaded.tsx#L5-L12) handles loading states, 404s (`NotFound`), and query errors.
   - **Gap:** There is **no React ErrorBoundary** anywhere in `frontend/src/`. If a runtime JavaScript exception is thrown during rendering inside any component or chart, the entire React application tree unmounts, presenting the user with an unresponsive blank screen.

4. **Health & Observability Endpoints:**
   - There is no dedicated `/health` or `/metrics` endpoint. Health checks in Docker Compose and startup scripts probe `/api/customers` or `/api/payment-methods`.
   - *Contextual Mitigation:* For a single-tenant local desktop app, heavyweight Prometheus metrics or distributed tracing would be YAGNI over-engineering. However, a lightweight `/api/health` providing database and backup status would improve operational clarity.

---

## 6. Security Patterns

### Rating: STRATEGIC

The security architecture is thoughtfully tailored to the reality of an offline-first, single-tenant local desktop application. Rather than mindlessly implementing web-scale tropes (such as OAuth or JWT login, which would add friction without benefit), the codebase addresses the specific threat vectors relevant to a local web server running on `127.0.0.1:8000`.

### Key Strengths & Architecture References

1. **DNS Rebinding & Host Validation:**
   - [backend/src/mortgage_backend/platform/local_only.py](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/backend/src/mortgage_backend/platform/local_only.py#L20-L45) implements ASGI middleware that inspects the HTTP `Host` header.
   - Any request addressed to a host other than `localhost`, `127.0.0.1`, or `[::1]` is immediately rejected with `400 Bad Request`. This directly stops malicious external websites from rebinding DNS to 127.0.0.1 to access the lender's local API.

2. **CSRF & Origin Validation:**
   - `LocalOnly` inspects the `Origin` header for all state-changing HTTP methods (`POST`, `PUT`, `DELETE`, `PATCH`).
   - If `Origin` is present and its `netloc` does not match the `Host` header, the request is rejected with `403 Forbidden` (`"Requests from other sites are refused."`). This prevents drive-by cross-origin attacks from malicious browser tabs.

3. **Memory Exhaustion & Request Bomb Protection:**
   - [backend/src/mortgage_backend/platform/upload_limit.py](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/backend/src/mortgage_backend/platform/upload_limit.py#L12-L45) enforces a strict 20 MB ceiling (`MAX_BODY_BYTES = 20 * 1024 * 1024`).
   - It checks `Content-Length` upfront and dynamically counts incoming stream bytes for chunked transfers, aborting with `413 Content Too Large` before memory is exhausted.

4. **Safe Photo Processing & Path Traversal Prevention:**
   - [backend/src/mortgage_backend/platform/photos.py](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/backend/src/mortgage_backend/platform/photos.py#L25-L95):
     - Files are saved with random UUID names (`f"{owner}-{owner_id}-{uuid.uuid4().hex}.jpg"`).
     - Static file reads enforce a strict regex: `re.compile(r"^[a-z]+-\d+-[0-9a-f]{32}\.jpg$")`, making directory traversal attacks (`../`) impossible.
     - Images are opened via Pillow, rotated according to EXIF data, resized to at most 1600px, and re-encoded to JPEG. Pillow's `Image.DecompressionBombError` is caught and converted to 422 unprocessable, mitigating decompression bombs.
     - Transactions use `photo_change()` context manager: if the database transaction fails, newly written images are automatically deleted from disk.

5. **PII Masking & Encrypted Backups:**
   - In accordance with Indian privacy considerations, Aadhaar numbers are never stored in full. Only the last 4 digits are kept in `customer.aadhaar_last4` ([backend/src/mortgage_backend/platform/db.py](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/backend/src/mortgage_backend/platform/db.py#L65-L75)).
   - Backups destined for synced folders (OneDrive, Google Drive) are written as AES-encrypted zip files when `BACKUP_PASSWORD` is configured (ADR 0003, [safekeeping/backups.py](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/backend/src/mortgage_backend/safekeeping/backups.py#L30-L50)).
   - Production Docker container runs as non-root user `1000:1000`, verified in CI.

---

## 7. Cross-Cutting Concerns

### Rating: MIXED

Cross-cutting concerns related to data consistency, schema evolution, pagination, and time travel are handled exceptionally well. However, cross-cutting concerns related to operational logging and UI error boundaries show uneven adoption.

### Analysis of Cross-Cutting Concerns

| Concern | Implementation Mechanism | Architectural Assessment |
|---------|--------------------------|---------------------------|
| **Validation** | Pydantic v2 schemas on backend; `api.gen.ts` via OpenAPI generation; `openapi-fetch` on frontend; UI constraints for currencies and weights. | **STRATEGIC:** End-to-end type safety from database column to React component. |
| **Transactions & DB** | Context-managed transactions (`with engine.begin() as conn:`); SQLite foreign key enforcement; Alembic migrations run automatically on app start with pre-migration backups. | **STRATEGIC:** Consistent transaction boundaries; zero orphaned records. |
| **Time Travel / Clock** | Centralized `get_today()` and `get_now()` in `platform/clock.py`; `X-QA-Clock` header injection in QA mode; Playwright clock freezing (`page.clock.setFixedTime`). | **STRATEGIC:** Flawless time synchronization across backend business logic and frontend views. |
| **Paging & Sorting** | Reusable `query_page()` in `platform/paging.py`; frontend `useListPage` and `useUrlSort` hooks synchronizing URL query parameters with table views. | **STRATEGIC:** Zero boilerplate; uniform list behaviors across all domain pages. |
| **Host Protocol Bridge** | `mortgage-management://start` custom Windows protocol; `StartGate` polling and launching host server. | **STRATEGIC:** Elegant bridge between sandboxed browser and local operating system. |
| **Logging** | Python standard library `logging` used only in `daily_run.py` and `backups.py`. No request logging middleware or audit log output to stdout. | **TACTICAL:** Under-developed; difficult to diagnose unexpected errors in customer deployments. |
| **Error Boundaries** | React query error state handling via `NotLoaded.tsx`. Zero React `ErrorBoundary` wrappers in component hierarchy. | **TACTICAL:** A single rendering crash brings down the entire application window. |

---

## 8. Overall Coherence & Architectural Integrity

### Rating: STRATEGIC

Stepping back, the Mortgage-Management-App codebase is an exceptional example of purposeful software architecture. It exhibits clear design vision, deep domain modeling, and continuous architectural refinement.

```
                    +------------------------------------+
                    |        Architectural Seams         |
                    +-----------------+------------------+
                                      |
         +----------------------------+----------------------------+
         |                                                         |
         v                                                         v
+-------------------------------+                         +-------------------------------+
|     ADR 0001: Derived Ledger  |                         |  Dual Deployment Architecture |
|  - All balances recomputed    |                         |  - Docker Container (Prod)    |
|  - Pure calculation engine    |                         |  - Native Windows Host (Prod) |
|  - Zero ledger state drift    |                         |  - Vite Dev Proxy (Dev)       |
+-------------------------------+                         +-------------------------------+
```

### Architectural Highlights

1. **The Derived Ledger Seam (ADR 0001):**
   - The decision recorded in [Documentation/adr/0001-ledger-is-derived-not-stored.md](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/Documentation/adr/0001-ledger-is-derived-not-stored.md) is the cornerstone of the system's financial integrity.
   - Instead of storing mutating account balances, outstanding interest, and capitalisation rows in database tables, the ledger is computed purely and deterministically on demand from core transaction events (loan creation, rate changes, payments, discounts).
   - This eliminates an entire class of distributed ledger drift, synchronization anomalies, and retroactive adjustment bugs.

2. **Living ADR History & Architectural Introspection:**
   - 21 ADRs document every non-obvious engineering choice:
     - ADR 0002: WhatsApp click-to-send rather than automated API integration.
     - ADR 0004 / 0010 / 0013: Evolution from Docker to host-mode and eventual consolidation into a unified single container serving both API and static assets.
     - ADR 0008 / 0009: PWA protocol launch and side-by-side folder versioning with Windows directory junctions (`app` junction pointing to active version).
     - ADR 0018 / 0019: Strict release candidate pull request merge model.
   - Seven historical architecture review passes in `Documentation/architecture-reviews/` demonstrate an ongoing commitment to eliminating technical debt and architectural drift.

3. **Strict Domain Language Alignment:**
   - There is no conceptual dissonance between documentation, database schemas, API contracts, frontend components, and QA scenarios. A term like `Accrual Date` or `Lent Through` is used consistently across SQL tables, Pydantic models, TypeScript interfaces, and Gherkin step definitions.

---

## Actionable Recommendations

To elevate this codebase from strong to exemplary, the following improvements are recommended:

### 1. Introduce React Error Boundaries
- **Issue:** Absence of React `ErrorBoundary` components means an uncaught render error in a child component (e.g., in a chart, table formatter, or preview card) causes the entire page to crash to a white screen.
- **Remedy:** Implement an `ErrorBoundary` wrapping `<AppRoutes />` in [frontend/src/App.tsx](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/frontend/src/App.tsx#L40-L45) with a fallback screen offering to reload the page or navigate to the Dashboard.

### 2. Implement Lightweight Structured Request & Error Logging
- **Issue:** Route handlers execute without logging. Server-side exceptions (500) lack structured context.
- **Remedy:** Add a lightweight Starlette middleware in [backend/src/mortgage_backend/main.py](file:///Users/kritarthjain/Desktop/Kritarth/dev/worktree/Mortgage-Management-App/arch-testing/backend/src/mortgage_backend/main.py) that logs non-200 responses and uncaught exceptions with HTTP method, path, status, and duration to standard output. Register a global `@app.exception_handler(Exception)` that sanitizes internal error details while recording the traceback.

### 3. Add a Lightweight `/api/health` Diagnostic Endpoint
- **Issue:** Health checks currently scrape `/api/customers` or `/api/payment-methods`.
- **Remedy:** Provide an explicit `GET /api/health` returning database connectivity, schema migration status, and backup engine status. Use this in `docker-compose.qa.yml` and `Dockerfile`.

### 4. Adopt Mock Service Worker (MSW) or Typed API Mocks for Frontend Tests
- **Issue:** Frontend tests rely heavily on an ad-hoc `fakeServer.ts` mock fetch implementation. If backend API schemas change, frontend tests might pass against outdated mock structures unless caught by TypeScript type generation.
- **Remedy:** Integrate typed contract validation into frontend test harnesses to ensure fake responses conform strictly to generated OpenAPI schemas.
