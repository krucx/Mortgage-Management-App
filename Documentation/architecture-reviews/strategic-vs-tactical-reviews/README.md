# Strategic vs. Tactical Architecture Reviews (November 2026)

In November 2026, a comprehensive, multi-dimensional architectural review pass was conducted across the entire `Mortgage-Management-App` repository (`v3.5.2`).

The review evaluated the codebase along the spectrum of:
- **STRATEGIC**: Well-thought-out, coherent design adhering to deep module principles, strong domain modeling, robust invariants, and long-term maintainability.
- **MIXED**: Sound core patterns but with localized inconsistencies, technical debt, or opportunities for better separation of concerns.
- **TACTICAL**: Ad-hoc, bolted-on, or short-term workarounds that introduce fragility or architectural drift.

The review is divided into three focused documents covering 21 total architectural dimensions across the backend, frontend, testing infrastructure, and cross-cutting project coherence.

> **Recheck, 27 November 2026:** after the refactor run (#500 to #511) the totals are **19 Strategic, 2 Mixed, 0 Tactical**. See [recheck-2026-11-27.md](./recheck-2026-11-27.md).

---

## Overall Scorecard

| Review Document | Focus Scope | Strategic | Mixed | Tactical | Total Dimensions |
| :--- | :--- | :---: | :---: | :---: | :---: |
| [Backend Architecture Review](./backend-review.md) | Data model, API design, business logic, state flow, config, dependencies | 5 | 1 | 0 | 6 |
| [Frontend Architecture Review](./frontend-review.md) | Component architecture, state management, routing, forms, styling, DRY, TypeScript | 4 | 3 | 0 | 7 |
| [Testing, QA, CI/CD & Coherence Review](./testing-and-coherence-review.md) | Testing pyramid, QA stack, CI/CD, project conventions, observability, security, coherence | 6 | 2 | 0 | 8 |
| **Total** | | **15** | **6** | **0** | **21** |

**Key Finding**: With **15 Strategic (71.4%)**, **6 Mixed (28.6%)**, and **0 Tactical (0.0%)** ratings, the repository demonstrates a remarkably high standard of architectural intentionality and engineering discipline. Foundational decisions (such as the derived ledger, hand-written transactional preview routes, zero-`any` TypeScript contracts, containerized QA stack, and strict coverage gates) provide rock-solid guarantees against financial calculation bugs and state divergence. The areas rated Mixed identify natural evolution and refactoring opportunities rather than architectural compromise.

---

## Document Summaries

### 1. [Backend Architecture Review](./backend-review.md)
*Scope: Backend architecture, data model, API design, state management, configuration, and dependencies*
*Scorecard: **5 Strategic, 1 Mixed, 0 Tactical***

- **Data Model & Schema Design (STRATEGIC)**: Anchored by the derived-not-stored ledger invariant ([ADR 0001](../../../Documentation/adr/0001-ledger-is-derived-not-stored.md)). Balances and interest are never stored as mutable columns, but dynamically derived by replaying immutable events. Strict integer units (paise, milligrams, basis points). Automated pre-migration backups before forward schema migrations.
- **API Layer (STRATEGIC)**: Clean domain organization, 100% typed OpenAPI contract generation, and the transactional before/after preview pattern ([ADR 0007](../../../Documentation/adr/0007-preview-routes-written-out-by-hand.md)) providing rollback-based simulation without duplicated logic.
- **Business Logic Organization (STRATEGIC)**: Classic deep modules (`ledger.py`, `replay.py`), ultra-thin controllers, clean domain orchestration layer (`recording.py`, `closing.py`), and systematic structured diff audit logging (`audit.py`).
- **State Management & Data Flow (MIXED)**: Explicit transaction scoping (`engine.begin()`, passing `conn: Connection`) eliminates hidden ORM state; however, raw SQLAlchemy Core SQL queries are co-located directly within route and service controllers without an isolated query seam.
- **Configuration & Environment (STRATEGIC)**: Clean two-tier configuration: 7 environment variables for process bootstrapping, database-backed `ConfigGroup[M]` for runtime domain settings, secret isolation, and full dependency injection in the composition root.
- **Dependencies & Tech Debt (STRATEGIC)**: Exceptionally lean footprint (only 9 production dependencies), modern Python 3.13 features (PEP 695 generics), and zero lint/type errors.

### 2. [Frontend Architecture Review](./frontend-review.md)
*Scope: Frontend architecture, component design, state management, forms, styling, and UI patterns*
*Scorecard: **4 Strategic, 3 Mixed, 0 Tactical***

- **Component Architecture (MIXED)**: Excellent modular decomposition in newer feature folders (`newPayment/`, `settings/`), but core legacy pages (`CustomerFormPage`, `MortgagePage`, `ClosuresPage`, `NewMortgagePage`, `CallListPage`) remain sprawling monoliths exceeding 400 lines mixing UI layout, form state, and inline domain logic.
- **State Management (STRATEGIC)**: Strict `@tanstack/react-query` + `openapi-fetch` pipeline with a centralized query key factory. Single global `ClientContext` for active customer context. URL search params act as the single source of truth for filters, sorting, and pagination.
- **Routing & Navigation (STRATEGIC)**: Logical domain routing in `App.tsx`, and a custom `<StartGate>` handling offline detection, backend polling, and Windows protocol integration (`mortgage-management://start`).
- **Form Handling & Validation (MIXED)**: Strategic "Server-as-Validator" preview workflow (`useProposedChange`, `usePreview`), but form editing state relies on hand-rolled `useState` boilerplate with variable error presentation across forms.
- **Styling Approach (MIXED)**: Thoughtful design token system (`:root` CSS variables) with WCAG 4.5:1 contrast compliance and dark mode support, but trapped in an unmodularized 1,786-line global stylesheet with high selector coupling.
- **Code Reuse & DRY (STRATEGIC)**: High-leverage abstractions (`useListPage`, `useProposedChange`, `useSaveWithPhotos`, `useUrlSort`, `MortgageTable`, `Summary`). Financial integer math is centralized and reused cleanly.
- **TypeScript Usage (STRATEGIC)**: Exemplary. Literally zero `any` across the entire frontend codebase. End-to-end typed contract generation via OpenAPI (`api.gen.ts`), compiler-checked table sort columns (`columnsOf`), and strict compiler options.

### 3. [Testing Strategy, QA Infrastructure, CI/CD & Project Coherence Review](./testing-and-coherence-review.md)
*Scope: Testing pyramid, QA infrastructure, CI/CD pipelines, conventions, security, cross-cutting concerns, and overall coherence*
*Scorecard: **6 Strategic, 2 Mixed, 0 Tactical***

- **Testing Strategy (STRATEGIC)**: Well-constructed testing pyramid: pure calculation unit tests with zero I/O (`ledger.py`, `money.ts`), database-backed API integration tests on fresh SQLite instances, component tests, and full-stack BDD. Strictly enforced CI coverage gates (90% backend, 80% frontend) and a mechanical gate checking 100% router screen coverage.
- **QA Infrastructure (STRATEGIC)**: 3-tier containerized QA stack (`qa-golden`, `qa-fresh`, `qa-work`), scratch volume safety guards, Playwright-BDD scenarios using domain-rich Gherkin language, and seamless time-travel clock synchronization via `X-QA-Clock`.
- **CI/CD Pipeline (STRATEGIC)**: Staged multi-platform GitHub Actions workflows (Ubuntu, Windows Pester), commit-pinned actions, automated changelog collation, and automated security/secret scanning alerting to GitHub Issues.
- **Project Structure & Conventions (STRATEGIC)**: 1:1 mirrored backend and frontend domain structures, authoritative domain `GLOSSARY.md` with forbidden synonyms, clear dual-documentation hierarchy (`docs/` vs `Documentation/`), and `AGENTS.md` steering.
- **Error Handling & Observability (MIXED)**: Structured domain audit logging with field diffs (`audit.py`) and typed 422 refusals; however, minimal application request logging in routes, no global 500 handler, and no React `ErrorBoundary` wrappers in the UI.
- **Security Patterns (STRATEGIC)**: Pragmatic local-first threat model: DNS rebinding protection (`LocalOnly`), CSRF origin checks, 20 MB streaming upload limits, strict photo sanitization, Aadhaar PII masking, and AES-256-GCM encrypted backups.
- **Cross-Cutting Concerns (MIXED)**: Unified patterns for database transactions, schema migrations, paging, sorting, clock pinning, and OpenAPI typing; logging and UI crash boundaries require standardization.
- **Overall Coherence (STRATEGIC)**: Textbook domain-driven design, living ADR catalog (21 ADRs), and an established culture of iterative architectural reviews.

---

## Action Plan & Roadmap

Across the three reviews, several high-leverage refactorings were identified to address the 6 Mixed areas:

1. **Frontend Component Modularization**: Break down monolithic page components (`CustomerFormPage`, `MortgagePage`, `ClosuresPage`) into dedicated feature directories with focused sub-components.
2. **Modularize Frontend Styles**: Adopt CSS Modules or domain-sliced stylesheets to relieve pressure on the 1,786-line global `index.css`.
3. **Frontend Error Boundaries**: Add a top-level React `ErrorBoundary` around `<AppRoutes />` to prevent unexpected render crashes from showing a blank screen.
4. **Backend Query Separation**: Extract inline SQL queries from controllers into dedicated query modules (e.g., `lending/queries.py`, `payments/queries.py`) separating SQL generation from HTTP request handling.
5. **Structured Request Logging**: Introduce lightweight Starlette middleware for request/response structured logging and an explicit `/api/health` diagnostic endpoint.
6. **Standardize Form Pipelines**: Unify form state handling across all complex forms using `useProposedChange` and standardized `<FieldProblem>` error presentations.
