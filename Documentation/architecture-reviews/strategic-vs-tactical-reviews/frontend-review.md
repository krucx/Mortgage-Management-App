# Architecture Review: Frontend Architecture, Component Design & UI Patterns

**Repository:** `krucx/Mortgage-Management-App`  
**Scope:** `frontend/` (React 19 SPA, TypeScript, TanStack Query, React Router v8, openapi-fetch)  
**Date:** November 2026  
**Target:** Local-first jewellery mortgage management desktop web application / PWA  

---

## Executive Summary & Scorecard

The frontend of Mortgage-Management-App is a remarkably disciplined, high-fidelity single-page application built for a single-tenant jewellery lending workstation. It demonstrates world-class rigor in several key areas—most notably **Type Safety** (literally zero instances of `any`), **Server-State Management** (centralized query key hierarchy, automatic cache invalidation, and strict ban on raw `fetch`), and **Domain Mathematics & Code Reuse** (integer paise, milligrams, and basis points encapsulated into pure functions with custom hooks).

However, structural debt is visible in **Component Architecture** (several monolithic pages exceeding 400 lines mixing UI layout, form state, and domain formatting), **Form Handling Plumbing** (hand-rolled `useState` structures with slight fragmentation across pages), and **Styling** (a monolithic 1,786-line global CSS file lacking modular encapsulation).

### Architecture Scorecard

| Area | Rating | Key Finding |
| :--- | :---: | :--- |
| **1. Component Architecture** | **MIXED** | Excellent decomposition in `newPayment/` and `settings/`, but sprawling monolithic pages in `CustomerFormPage`, `MortgagePage`, `ClosuresPage`, `NewMortgagePage`, and `CallListPage`. |
| **2. State Management** | **STRATEGIC** | Strict `@tanstack/react-query` + `openapi-fetch` pipeline; single global `ClientContext`; URL search params as single source of truth for filters, sorting, and pagination. Zero Redux/Zustand clutter. |
| **3. Routing & Navigation** | **STRATEGIC** | Logical domain routes in `App.tsx`; purpose-built `<StartGate>` handling offline detection and Windows protocol integration (`mortgage-management://start`); dynamic badge updates in `Nav`. |
| **4. Form Handling & Validation** | **MIXED** | Strategic "Server-as-Validator" / "Live Preview" pattern (`useProposedChange`, `usePreview`), but form state management relies on hand-rolled `useState` boilerplate with variable error presentation. |
| **5. Styling Approach** | **MIXED** | Coherent design token system (`:root` CSS variables) with WCAG 4.5:1 contrast and dark mode support, but trapped in an unmodularized 1,786-line global stylesheet with high selector coupling. |
| **6. Code Reuse & DRY** | **STRATEGIC** | High-leverage abstractions (`useListPage`, `useProposedChange`, `useSaveWithPhotos`, `useUrlSort`, `MortgageTable`, `Summary`). Integer domain math centralized and reused cleanly. |
| **7. TypeScript Usage** | **STRATEGIC** | Exemplary. 0 `any` across the entire codebase. End-to-end type generation from OpenAPI (`api.gen.ts`), compiler-checked sort columns (`columnsOf`), and strict TypeScript options. |

---

## 1. Component Architecture: MIXED

### Clear Hierarchy vs Sprawling Components
The component architecture exhibits a dual nature: modern, well-decomposed feature folders on one side, and sprawling, monolithic page components on the other.

#### The Exemplars: Feature Subdirectories
In recent refactorings, complex pages were broken down into clean subdirectories:
- **`src/pages/newPayment/`**:
  - `PaymentForm.tsx` (381 lines) orchestrates the form.
  - Sub-views and specialized logic are separated into `AllocationFieldset.tsx` (320 lines), `AmountReceivedField.tsx` (53 lines), `DateReceivedField.tsx` (56 lines), `AdvanceSchedules.tsx` (92 lines), `GraceTip.tsx` (95 lines), and `RedeemedInFull.tsx` (12 lines).
  - Business calculations and validation are decoupled into pure modules: `allocation.ts`, `accrual.ts`, `confirmation.tsx`, and `useSelection.ts`.
- **`src/pages/settings/`**:
  - `SettingsPage.tsx` (25 lines) is a clean coordinator rendering independent card components: `<DefaultTermsSettings />`, `<GoldRateSettings />`, `<CallListThresholds />`, `<CashLimitSettings />`, `<DiscountConfirmationSettings />`, `<GracePeriodSettings />`, `<MessageSettingsForm />`, and `<BackupSettings />`.
  - Each settings card encapsulates its own query, draft editing via `useDraft`, confirmation, and mutation.

#### The Monoliths: Mixed Concerns & Sprawling Code
In contrast, several core pages remain dense monoliths combining orchestration, state management, complex DOM trees, and inline domain logic:
1. **`CustomerFormPage.tsx` (472 lines)**:
   - Houses `CustomerFormPage` and `CustomerForm`.
   - Manages personal details, phone number ownership checks (`useNumberOwner`), live backend preview validation (`usePreview`), Aadhaar and PAN OCR scanning (`readNumber` via Tesseract OCR in `src/ocr.ts`), duplicate phone warning searches (`checkPhone2`), referrer picker interactions, multi-photo file management, confirmation modals, and two-phase mutations (`useSaveWithPhotos`).
   - Line 121–280 mixes business rules, OCR state, and UI layout into a single function.
2. **`ClosuresPage.tsx` (482 lines)**:
   - Manages two separate server-paginated tables: Dormant Mortgages and Forfeitable Active Mortgages.
   - Embeds multi-selection tracking (`selected`), tab switching between Forfeit and Waive, confirmation dialog preparation, and table rendering.
3. **`MortgagePage.tsx` (396 lines)**:
   - Combines mortgage overview details, photo upload/deletion (`useSaveWithPhotos`), reopening dialog (`ReasonDialog`), 8-step preview ledger table, and the full ledger modal (`ScrollPopup`).
   - Inlines helper functions that format and describe ledger calculations (`describe()`, `dateOf()`, `paidAhead()`, `instalmentName()`) on lines 310–396.
4. **`NewMortgagePage.tsx` (399 lines)**:
   - Combines customer selection summary, active mortgages overview subtable, name suggestion queries (`suggestedNameQuery`), real-time preview check, cash warning dialog, modal confirmation creation, photo capture, and form rendering.
5. **`CallListPage.tsx` (448 lines)**:
   - Combines call list table rendering, threshold editing modals, manual call note logging (`CallNotes`), WhatsApp link triggers, import CSV file reading and preview validation.
6. **`components/CloseMortgage.tsx` (426 lines)**:
   - Resides in `components/`, but is effectively a heavyweight sub-application handling redemption, waiving, and forfeiting with complex internal state and previews.

### Scoping & Shared Component Discipline
Shared components in `src/components/` generally follow single-responsibility principles:
- **Generic UI Primitives**: `Modal.tsx`, `ConfirmDialog.tsx`, `Pager.tsx`, `SortHeading.tsx`, `RupeeInput.tsx`, `WeightFields.tsx`, `TermsFields.tsx`, `FieldProblem.tsx`.
- **Domain-Specific Widgets**: `CustomerChooser.tsx`, `PersonLink.tsx`, `WhatsApp.tsx`, `PhotoPicker.tsx`, `PhotoSource.tsx`, `MortgageTable.tsx`.
- **Seam Issues**: A few components placed in `src/components/` (such as `CloseMortgage.tsx`, `AdvancePanel.tsx`, `CollateralPanel.tsx`, `PlannedPayments.tsx`, and `SimulationResults.tsx`) are page-specific components that belong in page feature folders rather than the shared component directory.

---

## 2. State Management: STRATEGIC

State management in this application is exceptionally clean, disciplined, and free of unnecessary dependencies or random state containers.

### Three-Tier State Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ 1. SERVER STATE (TanStack Query + openapi-fetch)            │
│    - Single QueryClient in ServerStateProvider               │
│    - Typed API client (Client<paths>) via ClientContext     │
│    - Deterministic query key factory (keys.*)               │
│    - Centralized mutation invalidations (STALE_AFTER)       │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│ 2. URL STATE (React Router v8 useSearchParams)              │
│    - List filters & pagination (useListPage, useUrlFilters) │
│    - Column sorting (useUrlSort)                            │
│    - Calculator inputs (useInputs)                          │
│    - Multi-step flow handoffs (?customer=1&mortgage=2)       │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│ 3. LOCAL / DRAFT STATE (React useState, useDraft)            │
│    - Form inputs while typing                               │
│    - Modal & popup visibility                               │
│    - Ephemeral selection sets (Set<number>)                 │
└─────────────────────────────────────────────────────────────┘
```

### Server State (`src/serverState.ts`)
- **Single Source of Truth**: All network interactions pass through `openapi-fetch` and are cached via `@tanstack/react-query`.
- **Query Key Architecture**:
  ```typescript
  // src/serverState.ts:70-98
  export const keys = {
    mortgage: (id: number) => ['mortgage', id] as const,
    mortgageHistory: (id: number) => ['mortgage', id, 'history'] as const,
    customer: (id: number) => ['customer', id] as const,
    allCustomers: ['customer'] as const,
    payment: (id: number) => ['payment', id] as const,
    allPayments: ['payment'] as const,
    // ...
  }
  ```
  This hierarchical key design ensures prefix invalidation works predictably (e.g., invalidating `['mortgage', id]` automatically invalidates `['mortgage', id, 'history']`).
- **Mutation & Invalidation Seams**:
  `staleOnMortgageChange`, `staleOnPaymentChange`, and `staleOnCustomerChange` declare what becomes stale after any database mutation. Specialized hooks (`useChange`, `useMortgageChange`, `useLedgerChange`) wrap queries and invalidate stale keys consistently.
- **Enforced Client Boundary**:
  Raw `fetch` is strictly forbidden. This is enforced mechanically via `.oxlintrc.json` rules (`no-restricted-globals` and `no-restricted-properties` targeting `fetch`, `window.fetch`, `globalThis.fetch`, `self.fetch`) and tested in `frontend/tests/showPage.tsx` where global `fetch` throws if invoked.

### URL State as First-Class State
Instead of storing table filters, sorting, and pagination in React component state or global stores, they are maintained in URL search params:
- `useUrlFilters` (`src/components/useUrlFilters.ts`): Updates URL query params using `{ replace: true }` to avoid cluttering browser history.
- `useUrlSort` (`src/components/useUrlSort.ts`): Keeps sorting state in `?sort=-amount`, syncing bidirectional updates with header clicks.
- `useListPage` (`src/components/useListPage.tsx`): Integrates TanStack Query with URL filters and pagination, retaining previous data (`placeholderData: keepPreviousData`) to eliminate layout jump.
- `CalculatorPage.tsx` (`useInputs`): Serializes loan simulation inputs (amount, dates, lump sums, gold weight, compared terms) into the URL query parameters, making simulation scenarios instantly bookmarkable and shareable.

### Global vs Local State Discipline
- **Zero Store Bloat**: There is NO Redux, NO Zustand, NO MobX, and NO Recoil.
- **Single Context**: There is exactly ONE React context in the entire codebase: `ClientContext` in `src/serverState.ts` used to distribute the typed API client.
- **Local State**: Forms and dialogs use standard React `useState`. Draft synchronization is handled cleanly by `useDraft` (`src/components/useDraft.ts`), resetting drafts only when server data identity changes.

---

## 3. Routing & Navigation: STRATEGIC

### Routing Topology (`src/App.tsx`)
Routing is powered by `react-router` v8 and organized clearly by domain:

```typescript
// src/App.tsx:50-78
<Routes>
  {/* Dashboard */}
  <Route path="/" element={<DashboardPage />} />

  {/* Payments Domain */}
  <Route path="/payments" element={<PaymentsPage />} />
  <Route path="/payments/new" element={<NewPaymentPage />} />
  <Route path="/payments/:id" element={<PaymentPage />} />
  <Route path="/payments/:id/receipt" element={<ReceiptPage />} />
  <Route path="/payments/:id/advance-instalments/:instalment/receipt" element={<ReceiptPage />} />

  {/* Customers Domain */}
  <Route path="/customers" element={<CustomersPage />} />
  <Route path="/customers/new" element={<CustomerFormPage />} />
  <Route path="/customers/:id" element={<CustomerPage />} />
  <Route path="/customers/:id/edit" element={<CustomerFormPage />} />

  {/* Mortgages Domain */}
  <Route path="/mortgages" element={<MortgagesPage />} />
  <Route path="/mortgages/new" element={<NewMortgagePage />} />
  <Route path="/mortgages/:id" element={<MortgagePage />} />
  <Route path="/mortgages/:id/redeem" element={<RedeemPage />} />
  <Route path="/mortgages/:id/edit" element={<EditMortgagePage />} />
  <Route path="/mortgages/:id/terms" element={<ChangeTermsPage />} />

  {/* Auxiliary Tools & Settings */}
  <Route path="/calculator" element={<CalculatorPage />} />
  <Route path="/call-list" element={<CallListPage />} />
  <Route path="/reminders" element={<RemindersPage />} />
  <Route path="/closures" element={<ClosuresPage />} />
  <Route path="/referrers/:id" element={<ReferrerPage />} />
  <Route path="/settings" element={<SettingsPage />} />

  {/* Fallback */}
  <Route path="*" element={<NotFoundPage />} />
</Routes>
```

### Application Shell & Offline/Local Lifecycle
The shell layout wrap in `App.tsx` is tailored to the desktop PWA environment:
1. **`<StartGate>` (`src/components/StartGate.tsx`)**:
   - Because the PWA launches from local browser cache even when the backend is stopped, `StartGate` intercepts rendering before any route loads.
   - Pings `client.GET('/api/payment-methods')`. If offline or starting, it renders a startup screen with a trigger for `mortgage-management://start` (Windows custom protocol, ADR 0008) and polls every 2 seconds until the backend is healthy.
2. **`<Nav>` (`src/components/Nav.tsx`)**:
   - Clean top navigation using `<NavLink>`.
   - Incorporates real-time server-state indicators: Closures tab displays a live notification dot when `dormantCountQuery` > 0 (`aria-label="${dormant} Dormant, to Redeem"`).
3. **`<UpdateBanner>` (`src/components/UpdateBanner.tsx`)**:
   - Polling banner for GitHub releases with in-browser Markdown release note parsing, "Later" dismissal (persisted in localStorage), and one-click update trigger (`mortgage-management://update`).

### Absence of Authentication Guards (By Design)
There are no protected route guards or auth middleware. As documented in ADR 0004, ADR 0010, and ADR 0013, the application is single-tenant and runs locally on the Lender's laptop. Enforcing auth tokens or login routes would violate YAGNI.

### Minor Routing Seams
- Parameter extraction (`Number(useParams().id)`) is repeated in nearly every page component without a dedicated typed hook (`useNumericId()`), occasionally requiring defensive fallback code.
- Routes are defined as flat siblings under `<Routes>` rather than nested layout routes with `<Outlet />`. While acceptable for the current single persistent shell, nested routes would allow per-subsystem layouts if sub-navigation grows.

---

## 4. Form Handling & Validation: MIXED

### The Strategic Pattern: Server-As-Validator & Live Previews
The crowning architectural achievement of the frontend is the **"Live Preview" pattern**. In financial lending, domain calculations (interest compounding, part-month pro-rata, ledger replay, allocation cascades, cash limits) are notoriously complex and error-prone to duplicate on the client.

Instead of writing parallel client-side calculation engines:
1. **Forms construct prospective request bodies** as the user types (e.g., `asked: CustomerIn`, `asked: MortgageIn`, `edit: MortgageEdit`).
2. **Backend Preview Endpoints** (`/api/previews/...`, `/api/customers/preview`, etc.) simulate the change without persisting it, returning the exact ledger impact, cash movement, or validation error details.
3. **`usePreview` (`src/components/usePreview.ts`)** queries the preview endpoint in the background with debouncing and caching.
4. **`useProposedChange` (`src/components/useProposedChange.tsx`)** unifies this lifecycle:
   ```typescript
   // src/components/useProposedChange.tsx
   const { preview, submit, saving, canSave, error, confirmDialog } = useProposedChange({
     change: changed && after ? { effective_on: effectiveOn, ...after } : null,
     preview: (change) => previews.termChange(id, change),
     confirm: (change) => ({
       title: 'Change the Terms?',
       body: <Summary rows={[...]} />
     }),
     save: (change) => changeMortgage(c => changes.addTermChange(c, id, change)),
     saved: () => navigate(`/mortgages/${id}`),
   })
   ```
5. **Confirmation Guards**: Every critical transaction presents a `<Summary>` table in a confirmation modal before the mutation executes, guaranteeing user review of before/after figures.
6. **Robust Multi-Step Photo Uploads (`useSaveWithPhotos.ts`)**:
   - Solves the problem where a record is created but subsequent multipart image uploads fail.
   - Saves the database record first, locks the form, uploads photos sequentially, and on failure allows re-trying remaining photos without recreating the base entity.

### The Tactical Flaws: Hand-Rolled Form Plumbing
Despite the brilliant preview architecture, the lower-level form state plumbing suffers from inconsistencies:
- **Scattered `useState` vs Form Libraries**:
  Forms do not use standard form libraries (such as React Hook Form). Instead, each page manages raw strings via `useState`:
  - `CustomerFormPage.tsx` manages 8 individual string fields, plus 3 separate photo state records, and an OCR reading state object.
  - `PaymentForm.tsx` manages `mode`, `totalText`, `amountText`, `discountText`, `percentText`, `advanceText`, `monthsText`, `method`, and `reference` across separate `useState` hooks.
- **Inconsistent Adoption of `useProposedChange`**:
  While `ChangeTermsPage.tsx`, `EditMortgagePage.tsx`, `newPayment/PaymentForm.tsx`, and `useClosing.tsx` use `useProposedChange`, `NewMortgagePage.tsx` and `CustomerFormPage.tsx` hand-wire their own preview querying, cash warnings, and confirmation modal handling.
- **Divergent Error Presentation**:
  - `FieldProblem.tsx` (`<FieldProblem problem={...} />`) is used in `CalculatorPage.tsx`.
  - `CustomerFormPage.tsx` and `NewMortgagePage.tsx` use inline conditional status spans (`<span className="status error">`).
  - `CustomersPage.tsx` and `ClosuresPage.tsx` use a top-level paragraph error banner (`{error && <p className="status error">{error}</p>}`).

---

## 5. Styling Approach: MIXED

### Semantic Token System
At the top of `src/index.css` (lines 1–85), a well-structured set of design tokens is established using CSS custom properties:
- **Core UI Tokens**: `--text`, `--muted`, `--bg`, `--surface`, `--border`, `--accent`, `--ok`, `--error`, `--warning`.
- **Domain Finance Tones**: `--tone-owed` (#8a5a00), `--tone-money-in` (#008ba8), `--tone-collateral` (#5a4fcf), `--tone-closed` (#b3368c) (explicitly verified for color-blind separation and contrast).
- **Data Viz Semantic Labels**: `--exact` vs `--estimate`.
- **Third-Party Messaging Tokens**: `--wa-chat`, `--wa-bubble`, `--wa-text`, `--wa-green` for WhatsApp message previews.
- **Dark Mode Support**: Comprehensive dark mode palette implemented via `@media (prefers-color-scheme: dark)` and explicit overrides via `:root[data-theme='dark']` and `:root[data-theme='light']`.
- **Print Optimization**: Dedicated `@media print` rules for generating clean, black-on-white receipts (`.receipt` styles).

### Architectural Liability: Monolithic Global CSS
Despite the token foundation, the implementation architecture is an unmodularized monolith:
- **1,786 Lines in a Single File**: Every CSS rule for the entire application resides in `src/index.css`. There are no CSS Modules, no Tailwind CSS, and no component-scoped stylesheets.
- **Global Namespace Collision Risk**: Utility classes (`.card`, `.wide`, `.row`, `.spread`, `.stack`, `.hint`, `.button`, `.badge`, `.thumb`, `.field`) are global and lack namespacing.
- **High Specificity & DOM Coupling**:
  Specific pages and subcomponents leak into the global stylesheet with deeply nested or tag-coupled selectors:
  - Line 190: `.layout:has(.card.wide) .update-banner`
  - Line 486: `.advance-schedules`
  - Line 953: `.call-list`
  - Line 1186: `.projections`
  - Line 1632: `.calculator-inputs > fieldset > label`
- **Maintainability Hazard**: Adding or adjusting a layout on one page requires editing a massive global file and risks unintended visual regressions on unrelated screens. There is no automated tooling (like PurgeCSS or Stylelint) to detect unused CSS classes.

---

## 6. Code Reuse & DRY: STRATEGIC

The application demonstrates an unusually high degree of DRY discipline and domain utility reuse.

### Shared Domain Utilities
Core domain logic is centralized into pure, highly tested utility modules:
- **`src/money.ts`**:
  - Encapsulates integer paise conversions (`rupeesToPaise`, `paiseToRupees`).
  - Formats Indian currency using `Intl.NumberFormat('en-IN')` (`formatINR(13600000)` → `"₹1,36,000"`).
- **`src/weight.ts`**:
  - Encapsulates integer milligram conversions (`gramsToMg`, `mgToGrams`).
- **`src/terms.ts`**:
  - Centralizes interest modes (`simple`, `compounded_yearly`, `compounded_monthly`), part-month rules (`full_month`, `pro_rata`, `nothing`), basis point rates, and draft conversion (`toDraft`, `fromDraft`, `sameTerms`).
- **`src/format.ts`**:
  - Shared date formatters (`formatDate`, `formatDateTime`, `formatDays`, `formatGraceDate`), Aadhaar masking (`maskedAadhaar`), and month parsers.
- **`src/sort.ts`**:
  - Reusable generic sorting logic (`nextSort`, `sortFromParam`, `sortToParam`, `tickedFirst`).
- **`src/allocate.ts`**:
  - Allocation and percentage distribution algorithms across multiple mortgages.
- **`src/messaging.ts`**:
  - WhatsApp click-to-send URI generator with automatic phone number internationalization.

### High-Leverage Custom Hooks
Cross-cutting UI behaviors are packaged into clean hooks:
- **`useListPage`**: Used across `CustomersPage`, `MortgagesPage`, `PaymentsPage`, `RemindersPage`, `CallListPage`, and `ClosuresPage`. Eliminates ~50 lines of pagination, sorting, query caching, and empty-page rollback logic per page.
- **`useConfirm`**: Declarative async modal confirmation (`const confirmed = await confirm({...})`), eliminating modal state boilerplate.
- **`useCashWarning`**: Warns when transactions breach the configured cash limit.
- **`useSaveWithPhotos`**: Standardizes the two-phase save/retry pattern for customer and mortgage photos.
- **`usePaymentMethods`**: Resolves cached payment method labels across all ledger views.
- **`useUrlSort` & `useUrlFilters`**: URL parameter synchronization.

### Reusable UI Components
- Shared data tables: `<MortgageTable>` is reused across `MortgagesPage`, `CustomerPage`, `NewMortgagePage`, and customer summaries.
- Shared form inputs: `<RupeeInput>`, `<WeightFields>`, `<TermsFields>`, `<PaymentMethodSelect>`, `<PhotoPicker>`, and `<PhotoSource>`.
- Shared presentation panels: `<ConfirmDialog>`, `<Summary>`, `<Modal>`, `<Pager>`, `<SortHeading>`, `<PersonLink>`, `<WhatsApp>`, and `<ChartFrame>`.

---

## 7. TypeScript Usage: STRATEGIC

TypeScript usage across the codebase is nothing short of exemplary. It sets an industry benchmark for strictness and end-to-end type safety.

### Quantitative Assessment: Zero `any`
A comprehensive codebase grep for `any` reveals:
- **Zero** instances of `: any`.
- **Zero** instances of `as any`.
- Every match of the string "any" in `src/` is either within English documentation comments, the HTML attribute `step="any"` on numeric inputs, or the union literal `{ kind: 'any' }` in `PaymentsPage.tsx`.

### End-to-End Schema Typing (`src/api.gen.ts` & `src/api.ts`)
- **Automated Generation**: `npm run gen:types` runs `openapi-typescript` against FastAPI's `openapi.json`, generating `src/api.gen.ts`.
- **Strict Typed Client**: Requests are dispatched through `openapi-fetch` (`Client<paths>`), providing full compile-time validation of path parameters, query parameters, request bodies, and responses. If an API endpoint or parameter changes on the backend, the frontend fails to compile (`tsc -b`).
- **Type-Level Sort Verification**:
  ```typescript
  // src/api.ts:10-18
  type SortOf<Operation extends keyof operations> = NonNullable<
    NonNullable<operations[Operation]['parameters']['query']> extends { sort?: infer S } ? S : never
  >

  function columnsOf<Sort extends string>(columns: Record<Sort, true>): readonly Sort[] {
    return Object.keys(columns) as Sort[]
  }

  export type CustomerSort = SortOf<'list_customers_api_customers_get'>
  export const CUSTOMER_SORTS = columnsOf<CustomerSort>({
    name: true,
    phone: true,
    address: true,
    referrer: true,
  })
  ```
  If the backend adds or removes a sort column in FastAPI, `columnsOf` fails type-checking unless the column is explicitly defined in `CUSTOMER_SORTS`.

### Compiler Configuration & Linting
- **`tsconfig.app.json`**:
  Configured with `"erasableSyntaxOnly": true`, `"verbatimModuleSyntax": true`, `"noUnusedLocals": true`, `"noUnusedParameters": true`, and `"noFallthroughCasesInSwitch": true`.
- **Domain Discriminated Unions**:
  Extensive use of tagged unions prevents invalid states:
  - `PersonSummary`: `{ kind: 'customer', id: number } | { kind: 'referrer', id: number }`
  - `Period`: `{ kind: 'any' } | { kind: 'month'; month: string } | { kind: 'year'; year: string }`
  - `IdPhotoChange`: `{ kind: 'keep' } | { kind: 'new'; photo: Blob } | { kind: 'remove' }`

---

## Key Recommendations & Architectural Roadmap

### 1. Decompose Monolithic Pages into Domain Subdirectories
- **Action**: Follow the precedent established by `src/pages/newPayment/` and `src/pages/settings/`.
- **Target Pages**:
  - Refactor `CustomerFormPage.tsx` into `src/pages/customerForm/` (splitting OCR reading, ID photo management, phone validation, and the form layout).
  - Refactor `MortgagePage.tsx` into `src/pages/mortgage/` (moving the ledger display, calculation descriptions, and reopen modals into focused components).
  - Refactor `ClosuresPage.tsx` into `src/pages/closures/` (separating Dormant table, Active table, and batch action dialogs).
  - Move page-specific components in `src/components/` (`CloseMortgage.tsx`, `AdvancePanel.tsx`, `CollateralPanel.tsx`) into their respective page directories.

### 2. Modularize the 1,786-Line Global Stylesheet
- **Action**: Adopt CSS Modules (natively supported by Vite) or split `index.css` by domain.
- **Plan**:
  - Keep design tokens (`:root`), base resets, and shared utility classes (`.card`, `.row`, `.stack`) in `src/index.css` (~250 lines).
  - Extract page/component styles into co-located CSS modules (e.g., `PaymentForm.module.css`, `StartGate.module.css`, `Projections.module.css`).
  - This eliminates global selector collisions, reduces specificity wars, and allows dead CSS to be identified automatically when components are removed.

### 3. Standardize Form Architecture on `useProposedChange`
- **Action**: Standardize `NewMortgagePage.tsx` and `CustomerFormPage.tsx` to leverage `useProposedChange`.
- **Plan**:
  - Extract a composable extension (or adapter) that bridges `useProposedChange` and `useSaveWithPhotos` so multi-step photo uploads don't require rewriting preview and confirmation logic from scratch.
  - Standardize error display across all forms using `<FieldProblem>` for field-level errors and a unified banner for request-level refusals.

### 4. Create a Typed Route Parameter Hook
- **Action**: Introduce `useNumericId(paramName: string = 'id')` helper hook.
- **Plan**:
  - Encapsulate `Number(useParams()[paramName])` with automatic NaN and missing ID detection, eliminating defensive parameter boilerplate in 8+ page components.

---

## Conclusion
The frontend of Mortgage-Management-App is an exceptionally robust, production-grade system. Its strategic decisions—particularly the **zero-`any` OpenAPI-driven TypeScript integration**, **server-as-validator preview workflow**, and **strict query-caching discipline**—provide rock-solid guarantees against financial calculation errors and state divergence. Addressing component monoliths and global CSS sprawl will elevate the codebase from a strong architecture to a truly maintainable, modular system.
